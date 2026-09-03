import { describe, it, expect, vi } from 'vitest';

/**
 * S-02 round 4 — the state-patch builder and the REAL writer that applies it.
 *
 * `buildExtractionStatePatch` is the ONE pure function every extraction-status
 * write goes through (see the filing-auto-persist.ts module doc comment for the
 * full transition table). These tests exercise it directly, then prove the real
 * `setDocumentExtractionState` (built in `buildAutoPersistDeps`) hands its patch
 * to `db.update(documents).set(patch)` UNCHANGED — round-3 MAJOR-3 found this
 * writer had zero coverage.
 */

const { setMock, dbUpdateMock, db } = vi.hoisted(() => {
  const setMock = vi.fn(async () => undefined);
  const dbUpdateSet = vi.fn((patch: unknown) => {
    setMock(patch);
    return { where: vi.fn(async () => undefined) };
  });
  const dbUpdateMock = vi.fn(() => ({ set: dbUpdateSet }));
  return { setMock, dbUpdateMock, db: { update: dbUpdateMock } };
});

vi.mock('@ipodhan/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db,
  getRedisClient: () => ({}),
  DocumentRepository: vi.fn().mockImplementation(() => ({})),
  DocumentFetchStateRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/services/filing-persist-deps.js', () => ({
  buildFilingPersistDeps: vi.fn(() => ({})),
}));

import {
  buildExtractionStatePatch,
  buildAutoPersistDeps,
  EXTRACTION_BLOCKED_ERROR,
} from '../../../src/services/filing-auto-persist.js';

describe('buildExtractionStatePatch — the ONE pure function every write goes through', () => {
  const now = new Date('2026-09-03T10:00:00Z');

  it('(a) every transition includes updatedAt', () => {
    expect(buildExtractionStatePatch('IN_PROGRESS', { retryCount: 1 }, now).updatedAt).toBe(now);
    expect(buildExtractionStatePatch('COMPLETED', { error: null, retryCount: 0 }, now).updatedAt).toBe(now);
    expect(buildExtractionStatePatch('FAILED', { error: 'extractor: boom' }, now).updatedAt).toBe(now);
    expect(
      buildExtractionStatePatch('MANUAL_REVIEW', { error: `${EXTRACTION_BLOCKED_ERROR}@v1`, retryCount: 10 }, now)
        .updatedAt
    ).toBe(now);
  });

  it('(b) the IN_PROGRESS stamp writes the incremented retryCount', () => {
    const patch = buildExtractionStatePatch('IN_PROGRESS', { retryCount: 5 }, now);
    expect(patch).toMatchObject({ extractionStatus: 'IN_PROGRESS', retryCount: 5, updatedAt: now });
    expect(patch).not.toHaveProperty('extractedAt');
  });

  it('(h) success resets retryCount to 0, clears the error, and stamps extractedAt', () => {
    const patch = buildExtractionStatePatch('COMPLETED', { error: null, retryCount: 0 }, now);
    expect(patch).toEqual({
      extractionStatus: 'COMPLETED',
      updatedAt: now,
      extractionError: null,
      extractedAt: now,
      retryCount: 0,
    });
  });

  it('a FAILED patch leaves retryCount untouched when the caller omits it', () => {
    const patch = buildExtractionStatePatch('FAILED', { error: 'persist: boom' }, now);
    expect(patch).toEqual({ extractionStatus: 'FAILED', updatedAt: now, extractionError: 'persist: boom' });
    expect(patch).not.toHaveProperty('retryCount');
  });

  it('(f) a BLOCKED write is MANUAL_REVIEW with the version embedded in the error', () => {
    const patch = buildExtractionStatePatch(
      'MANUAL_REVIEW',
      { error: `${EXTRACTION_BLOCKED_ERROR}@extract_filing.py@2026-09-03`, retryCount: 10 },
      now
    );
    expect(patch).toEqual({
      extractionStatus: 'MANUAL_REVIEW',
      updatedAt: now,
      extractionError: `${EXTRACTION_BLOCKED_ERROR}@extract_filing.py@2026-09-03`,
      retryCount: 10,
    });
  });
});

describe('the REAL setDocumentExtractionState writer passes the patch to db.update unchanged', () => {
  it('forwards exactly what buildExtractionStatePatch produces', async () => {
    setMock.mockClear();
    dbUpdateMock.mockClear();
    const deps = buildAutoPersistDeps({} as never);

    const now = new Date();
    await deps.setDocumentExtractionState({ documentId: 'doc-1', status: 'FAILED', error: 'extractor: boom' });

    expect(dbUpdateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
    const appliedPatch = setMock.mock.calls[0][0] as Record<string, unknown>;
    const expectedPatch = buildExtractionStatePatch('FAILED', { error: 'extractor: boom' }, appliedPatch.updatedAt as Date);
    expect(appliedPatch).toEqual(expectedPatch);
    expect(appliedPatch.updatedAt).toBeInstanceOf(Date);
    expect((appliedPatch.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});
