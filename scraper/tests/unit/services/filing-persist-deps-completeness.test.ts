/**
 * F-101 root cause: `buildFilingPersistDeps` is THE one dependency builder for
 * `persistFilingExtraction`, and nothing tested its OUTPUT. So when item 1's
 * `childRowConsolidator` was added to `FilingPersisterDeps` as OPTIONAL and the
 * builder was never updated, thirty slices of consolidation code were wired to
 * nothing, type-checked cleanly, and every cycle in staging logged
 * `no childRowConsolidator injected` while writing child rows with no
 * provenance (`field_sources.row_key = ''` on all 8,076 staging rows).
 *
 * This test ENUMERATES the members of `FilingPersisterDeps` from the source of
 * truth — the interface declaration itself, read through the TypeScript compiler
 * API, never a hand-typed list — and asserts the builder supplies every one.
 * A dependency added to the persister and forgotten in the builder fails HERE,
 * at build time, instead of degrading silently in production.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Any repository class the builder constructs becomes a no-op class; any other
 * import becomes a callable returning an empty object. A Proxy rather than a
 * named list so a NEW import in the builder does not need this mock edited —
 * the point of the test is that new dependencies are not silently dropped.
 */
vi.mock('@ipodhan/shared', () => {
  class StubRepo {}
  return {
    db: {},
    getRedisClient: () => ({}),
    filterProtectedFields: async () => ({ filtered: {} }),
    IPORepository: StubRepo,
    FinancialStatementsRepository: StubRepo,
    IpoValuationRepository: StubRepo,
    PromotersRepository: StubRepo,
    IpoIntermediariesRepository: StubRepo,
    BrlmTrackRecordRepository: StubRepo,
    FinancialDataRepository: StubRepo,
    FieldSourcesRepository: StubRepo,
    DataConflictsRepository: StubRepo,
    ListingPerformanceRepository: StubRepo,
    IpoRiskFactorsRepository: StubRepo,
    DocumentRepository: StubRepo,
  };
});
vi.mock('../../../src/repositories/peer-company-repository.js', () => ({
  PeerCompanyRepository: class {},
}));

/** Member names declared on `interface FilingPersisterDeps`, from the AST. */
function declaredDepNames(): string[] {
  const file = join(__dirname, '../../../src/services/filing-persister.ts');
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'FilingPersisterDeps') {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          names.push(member.name.text);
        }
      }
    }
  });
  return names;
}

describe('buildFilingPersistDeps supplies every declared dependency', () => {
  it('finds the interface and its members (positive control for the AST read)', () => {
    const names = declaredDepNames();
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain('ipoRepository');
    expect(names).toContain('childRowConsolidator');
  });

  it('leaves no member of FilingPersisterDeps undefined', async () => {
    const { buildFilingPersistDeps } = await import('../../../src/services/filing-persist-deps.js');
    const deps = buildFilingPersistDeps({} as never) as unknown as Record<string, unknown>;
    const missing = declaredDepNames().filter((name) => deps[name] === undefined);
    expect(missing, `buildFilingPersistDeps omits: ${missing.join(', ')}`).toEqual([]);
  });

  it('supplies a callable child-row consolidator, not a placeholder', async () => {
    const { buildFilingPersistDeps } = await import('../../../src/services/filing-persist-deps.js');
    const deps = buildFilingPersistDeps({} as never);
    expect(typeof deps.childRowConsolidator?.consolidatedUpsertChildRows).toBe('function');
  });
});
