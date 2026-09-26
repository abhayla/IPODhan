/**
 * #631 (generalising #625): `AutoPersistDeps` is the largest surface the audit
 * found — 31 optional members. This test enumerates them from the interface
 * declaration in `filing-auto-persist.ts` (through the TypeScript compiler
 * API, never a hand-typed list) and asserts `buildAutoPersistDeps()` — the ONE
 * production builder `document-cycle.ts` calls — either supplies each one or
 * names it in `ALLOWLIST` with the reason it is safe to leave unset (the
 * fallback the consuming code applies). A member that is neither wired nor
 * allow-listed fails here, at build time, instead of degrading silently.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { declaredInterfaceMembers, unexplainedUnwiredOptionals } from '../../lib/deps-completeness.js';

const {
  invalidateForIpoMock,
  findByIPOMock,
  returningMock,
  whereMock,
  setMock,
  updateMock,
} = vi.hoisted(() => {
  const invalidateForIpoMock = vi.fn(async () => undefined);
  const findByIPOMock = vi.fn(async () => [] as unknown[]);
  const returningMock = vi.fn(async () => [{ ipoId: 'ipo-1' }]);
  const whereMock = vi.fn(() => ({ returning: returningMock }));
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  return { invalidateForIpoMock, findByIPOMock, returningMock, whereMock, setMock, updateMock };
});

// Same mocking shape as filing-auto-persist-cache-invalidation.test.ts and
// filing-persist-deps-completeness.test.ts — a Proxy-free, named-stub mock of
// `@ipodhan/shared` so `buildAutoPersistDeps`'s REAL production wiring runs,
// not a test double of the function under test.
vi.mock('@ipodhan/shared', () => ({
  db: { update: updateMock, insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn() })) })) },
  getRedisClient: vi.fn(() => ({})),
  DocumentRepository: vi.fn().mockImplementation(() => ({
    findByIPO: findByIPOMock,
    invalidateForIpo: invalidateForIpoMock,
  })),
  filterProtectedFields: vi.fn(),
  IPORepository: vi.fn().mockImplementation(() => ({ findById: vi.fn(async () => null) })),
  FinancialStatementsRepository: vi.fn(),
  IpoValuationRepository: vi.fn(),
  PromotersRepository: vi.fn(),
  IpoIntermediariesRepository: vi.fn(),
  BrlmTrackRecordRepository: vi.fn(),
  FinancialDataRepository: vi.fn(),
  FieldSourcesRepository: vi.fn(),
  DataConflictsRepository: vi.fn(),
  IpoRiskFactorsRepository: vi.fn(),
  DocumentRepository_: undefined,
  recordCorrigendumSuggestions: vi.fn(),
}));
vi.mock('@ipodhan/shared/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn(),
}));
vi.mock('@ipodhan/shared/db/schema', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, documents: { id: 'id-col', ipoId: 'ipo-id-col' } };
});
vi.mock('../../../src/repositories/peer-company-repository.js', () => ({
  PeerCompanyRepository: vi.fn(),
}));
vi.mock('../../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({ invalidateAfterScrape: vi.fn(async () => undefined) })),
}));

/**
 * These four members have NO internal fallback inside the functions that
 * consume them (`processPendingFilings` etc. simply read `deps.spawnBudget`,
 * `deps.deadlineMs`, `deps.now` and treat `undefined` as "unbounded / no
 * deadline / use `Date.now`" — per this interface's own doc comments,
 * "existing callers/tests are unaffected"). `buildAutoPersistDeps` correctly
 * leaves them unset: the caller (`document-cycle.ts`) supplies its own
 * per-cycle budget/deadline objects to `processPendingFilings` directly,
 * never through this builder. `fileExists`, `storeDir` and `version` are
 * likewise real-default seams (`existsSync`, `getStoreDir()`, package
 * version) documented at their declaration as test-only overrides.
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  spawnBudget: 'undefined = unbounded by design; document-cycle.ts passes its own SpawnBudget to processPendingFilings directly, not through this builder',
  anchorSpawnBudget: 'undefined = unbounded by design; same shape as spawnBudget (W-168)',
  deadlineMs: 'undefined = no deadline by design (F3); document-cycle.ts threads its own per the 25-minute extraction cap',
  now: 'AutoPersistDeps.now is a test-only override for the deadlineMs clock; production code path calls Date.now() when absent',
  fileExists: 'test-only seam; production code calls existsSync directly when this is unset',
  storeDir: 'test-only seam; production code calls getStoreDir() when this is unset',
  version: 'test-only seam for the extractor version string; no production default needed here',
};

describe('buildAutoPersistDeps supplies every declared dependency (or the gap is reviewed)', () => {
  const filePath = join(__dirname, '../../../src/services/filing-auto-persist.ts');

  it('finds the interface and its members (positive control for the AST read)', () => {
    const members = declaredInterfaceMembers(filePath, 'AutoPersistDeps');
    expect(members.length).toBeGreaterThan(10);
    expect(members.map((m) => m.name)).toContain('loadDocuments');
    expect(members.map((m) => m.name)).toContain('runAnchorPersist');
  });

  it('leaves no member silently unwired — wired, or on the reviewed allow-list', async () => {
    const { buildAutoPersistDeps } = await import('../../../src/services/filing-auto-persist.js');
    const deps = buildAutoPersistDeps({} as never) as unknown as Record<string, unknown>;
    const members = declaredInterfaceMembers(filePath, 'AutoPersistDeps');
    const gaps = unexplainedUnwiredOptionals(deps, members, ALLOWLIST);
    expect(gaps, `buildAutoPersistDeps leaves these unwired with no reviewed reason: ${gaps.join(', ')}`).toEqual([]);
  });

  it('supplies a callable anchor route and corrigendum runner, not placeholders', async () => {
    const { buildAutoPersistDeps } = await import('../../../src/services/filing-auto-persist.js');
    const deps = buildAutoPersistDeps({} as never);
    expect(typeof deps.runAnchorPersist).toBe('function');
    expect(typeof deps.runCorrigendumSuggestions).toBe('function');
    expect(typeof deps.loadIssueSizeRupees).toBe('function');
  });
});
