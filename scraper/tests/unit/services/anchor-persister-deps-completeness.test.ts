/**
 * #631: `AnchorPersisterDeps` has 4 optional members. Its only production
 * caller is `runAnchorAutoPersist`, which builds the deps object inline and
 * passes it to `persistAnchorReport` — captured here by mocking
 * `persistAnchorReport`, same shape as the issue-type-fill capture test.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { declaredInterfaceMembers, unexplainedUnwiredOptionals } from '../../lib/deps-completeness.js';

const { persistAnchorReportMock } = vi.hoisted(() => ({
  persistAnchorReportMock: vi.fn(async () => ({
    written: 0, investorsWritten: 0, totals: null, checks: [], refusedReason: null,
  })),
}));

vi.mock('../../../src/services/anchor-persister.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, persistAnchorReport: persistAnchorReportMock };
});
vi.mock('../../../src/scrapers/anchor-investors-scraper.js', () => ({
  scrapeAnchorInvestorsDetailed: vi.fn(async () => ({ data: null, failure: undefined })),
  ANCHOR_EMPTY_PAGES_REASON: 'no readable pages',
  ANCHOR_PASSWORD_PROTECTED_REASON: 'password protected',
}));
vi.mock('../../../src/repositories/anchor-investor-repository.js', () => ({
  AnchorInvestorRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: vi.fn(() => ({})),
  filterProtectedFields: vi.fn(async () => ({ filtered: {} })),
}));

/**
 * `persist` is not on this list because `persistAnchorReport` itself defaults
 * it (`deps.persist ?? createAnchorInvestors`, anchor-persister.ts) — a real
 * production write path, not a test-only seam, so `runAnchorAutoPersist`
 * correctly never sets it.
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  persist: 'persistAnchorReport defaults via `deps.persist ?? createAnchorInvestors`, the real writer',
};

describe('runAnchorAutoPersist wires every declared AnchorPersisterDeps member (or the gap is reviewed)', () => {
  const filePath = join(__dirname, '../../../src/services/anchor-persister.ts');

  it('finds the interface and its members (positive control for the AST read)', () => {
    const members = declaredInterfaceMembers(filePath, 'AnchorPersisterDeps');
    expect(members.length).toBeGreaterThan(3);
    expect(members.map((m) => m.name)).toContain('childRowConsolidator');
  });

  it('leaves no member silently unwired — wired, or on the reviewed allow-list', async () => {
    const { runAnchorAutoPersist } = await import('../../../src/services/anchor-auto-persist.js');
    persistAnchorReportMock.mockClear();
    const persisterDeps = {
      ipoRepository: { findById: async () => null },
      childRowConsolidator: { consolidatedUpsertChildRows: async () => ({ resolved: [], unresolved: [] }) },
      fieldSources: {},
      protectionFilter: async () => ({ filtered: {} }),
    } as never;

    await runAnchorAutoPersist(
      { ipoId: 'ipo-1', companyName: 'Test Co', document: { documentId: 'doc-1', pdfPath: '/tmp/x.pdf' } as never },
      persisterDeps,
      {} as never
    );

    expect(persistAnchorReportMock).toHaveBeenCalledTimes(1);
    const deps = persistAnchorReportMock.mock.calls[0]![2] as unknown as Record<string, unknown>;
    const members = declaredInterfaceMembers(filePath, 'AnchorPersisterDeps');
    const gaps = unexplainedUnwiredOptionals(deps, members, ALLOWLIST);
    expect(gaps, `runAnchorAutoPersist leaves these unwired with no reviewed reason: ${gaps.join(', ')}`).toEqual([]);
  });
});
