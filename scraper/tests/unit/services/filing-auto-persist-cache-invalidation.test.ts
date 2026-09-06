import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Staging incident (2026-09-06, ESDS Software RHP): `setDocumentExtractionState`
 * — the ONE writer every extraction-status transition goes through — does a
 * RAW `db.update(documentsTable)`, bypassing every `DocumentRepository` write
 * method that already invalidates the cache-aside `documents:<ipoId>` key
 * (`findByIPO`, `CacheTTL.DOCUMENTS` = 1h). Without an explicit invalidation
 * here, the NEXT cycle's `documentRepository.findByIPO(ipoId)` kept serving
 * the pre-write row (stale retryCount/status), so the backoff gate evaluated
 * stale data and re-spawned a document that should have been blocked.
 *
 * This file mocks `@ipodhan/shared` at the module boundary (a fake chainable
 * `db.update().set().where().returning()` + a fake `DocumentRepository`) so
 * `buildAutoPersistDeps`'s REAL production wiring — not a test-only mock of
 * `setDocumentExtractionState` — is what gets exercised.
 */

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

vi.mock('@ipodhan/shared', () => ({
  db: { update: updateMock },
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
  IpoRiskFactorsRepository: vi.fn(),
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

import { buildAutoPersistDeps } from '../../../src/services/filing-auto-persist.js';

describe('setDocumentExtractionState (real production wiring) — cache invalidation after every status write', () => {
  beforeEach(() => {
    invalidateForIpoMock.mockClear();
    returningMock.mockResolvedValue([{ ipoId: 'ipo-1' }]);
  });

  it.each(['IN_PROGRESS', 'FAILED', 'COMPLETED', 'MANUAL_REVIEW'] as const)(
    'invalidates the documents cache for the IPO after a %s write',
    async (status) => {
      const deps = buildAutoPersistDeps({} as never);
      await deps.setDocumentExtractionState({ documentId: 'doc-1', status, retryCount: 1 });
      expect(invalidateForIpoMock).toHaveBeenCalledWith('ipo-1');
    }
  );

  it('is fail-open: a Redis/cache error during invalidation does not throw or block the write', async () => {
    invalidateForIpoMock.mockRejectedValueOnce(new Error('redis down'));
    const deps = buildAutoPersistDeps({} as never);
    await expect(
      deps.setDocumentExtractionState({ documentId: 'doc-1', status: 'FAILED', retryCount: 5 })
    ).resolves.toBeUndefined();
  });

  it('does nothing when the update touched no row (no ipoId returned)', async () => {
    returningMock.mockResolvedValueOnce([]);
    const deps = buildAutoPersistDeps({} as never);
    await deps.setDocumentExtractionState({ documentId: 'missing', status: 'FAILED', retryCount: 1 });
    expect(invalidateForIpoMock).not.toHaveBeenCalled();
  });
});

describe('incident regression — a stale cached listing must not survive a status write', () => {
  /**
   * Exercises the REAL `buildAutoPersistDeps().loadDocuments` /
   * `.setDocumentExtractionState`. `findByIPOMock` stands in for
   * `DocumentRepository.findByIPO`'s cache-aside behaviour: it keeps
   * returning whatever `cachedRows` currently holds until something calls
   * `invalidateForIpo`, exactly like a real Redis-backed cache would keep
   * serving a stale value until its key is deleted.
   */
  let cachedRows: Array<{ id: string; type: string; extractionStatus: string; retryCount: number; updatedAt: Date | null }>;

  beforeEach(() => {
    invalidateForIpoMock.mockClear();
    findByIPOMock.mockReset();
    findByIPOMock.mockImplementation(async () => cachedRows);
    invalidateForIpoMock.mockImplementation(async () => {
      cachedRows = freshRowAfterCycle1;
    });
  });

  const twentyMinAgo = new Date('2026-09-06T15:39:17Z');
  const freshRowAfterCycle1 = [
    { id: 'doc-1', type: 'RHP', extractionStatus: 'FAILED', retryCount: 5, updatedAt: twentyMinAgo },
  ];

  it('cycle 2 (20 min later) sees the FRESH post-timeout row via loadDocuments, not the stale pre-write one', async () => {
    // Cache still holds cycle 1's PRE-write snapshot (as it would the instant
    // before the FAILED write commits).
    cachedRows = [{ id: 'doc-1', type: 'RHP', extractionStatus: 'IN_PROGRESS', retryCount: 4, updatedAt: null }];

    const deps = buildAutoPersistDeps({} as never);
    // Cycle 1's write: the fix invalidates the cache as a side effect.
    await deps.setDocumentExtractionState({ documentId: 'doc-1', status: 'FAILED', retryCount: 5 });
    expect(invalidateForIpoMock).toHaveBeenCalledWith('ipo-1');

    // Cycle 2 reads through loadDocuments (real production code) — must get
    // the fresh row (retryCount 5, FAILED), not the stale cached one.
    const rows = await deps.loadDocuments('ipo-1');
    expect(rows[0]).toMatchObject({ extractionStatus: 'FAILED', retryCount: 5 });
  });

  it('without the fix (invalidateForIpo never called) cycle 2 would still read the stale IN_PROGRESS/retryCount-4 row', async () => {
    cachedRows = [{ id: 'doc-1', type: 'RHP', extractionStatus: 'IN_PROGRESS', retryCount: 4, updatedAt: null }];
    // No write happens here — simulating the pre-fix world where the write
    // never told the cache anything.
    const deps = buildAutoPersistDeps({} as never);
    const rows = await deps.loadDocuments('ipo-1');
    expect(rows[0]).toMatchObject({ extractionStatus: 'IN_PROGRESS', retryCount: 4 });
  });
});
