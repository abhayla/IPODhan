import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** MINOR-1: spawnSync is mocked at the module boundary so the ENOENT/python3 retry is testable. */
const spawnSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ spawnSync: (...args: unknown[]) => spawnSyncMock(...args) }));

/**
 * S-02 — the automatic extract + persist path.
 *
 * The step-ledger writer is mocked at the module boundary: these tests are about
 * WHAT the service decides to do (spawn / not spawn / persist / refuse), and the
 * mapping from a run to ledger rows is tested as a pure function in
 * step-ledger-recorders.test.ts. Mocking it here also keeps the tests free of a
 * database and a Redis connection.
 */
const recordedSteps: { ipoId: string; writes: { stepId: string; status: string }[] }[] = [];
vi.mock('../../../src/services/step-ledger-recorders.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeSteps: vi.fn(async (ipoId: string, writes: never[]) => {
      recordedSteps.push({ ipoId, writes: writes as never });
      return writes.length;
    }),
    recordLiveStep: vi.fn(async (ipoId: string, stepId: string) => {
      recordedSteps.push({ ipoId, writes: [{ stepId, status: 'DONE' }] });
      return 1;
    }),
  };
});

import {
  selectPendingFilings,
  processPendingFilings,
  autoPersistEnabled,
  documentExtractionBlocked,
  defaultExtractorRunner,
  EXTRACTOR_VERSION,
  MAX_EXTRACTION_ATTEMPTS,
  EXTRACTION_BLOCKED_ERROR,
  type AutoPersistDeps,
  type CandidateDocument,
} from '../../../src/services/filing-auto-persist.js';
import type { FilingExtraction, PersistFilingSummary } from '../../../src/services/filing-persister.js';

const SHA = 'a'.repeat(64);
const IPO = { id: 'ipo-1', companyName: 'Rays Of Belief Ltd', slug: 'rays-of-belief-ltd', segment: 'MAINBOARD' };

const doc = (o: Partial<CandidateDocument> = {}): CandidateDocument => ({
  id: 'doc-1',
  type: 'RHP',
  sha256: SHA,
  extractionStatus: 'PENDING',
  extractedAt: null,
  retryCount: 0,
  updatedAt: null,
  ...o,
});

const extraction = (): FilingExtraction => ({
  doc_type: 'RHP',
  extraction_status: 'OK',
  unit: 'MILLION',
  fiscal_years: [2024],
  fields: { price_band_floor: { value: 100, page: 1, check: { name: 'c', passed: true, detail: 'ok' } } } as never,
});

const summary = (o: Partial<PersistFilingSummary> = {}): PersistFilingSummary => ({
  written: { promoters: 3 },
  skipped_protected: [],
  skipped_cross_document_disagreement: [],
  skipped_failed_check: [],
  skipped_no_column: [],
  skipped_no_unit: [],
  skipped_unit_mismatch: [],
  ipos_fields: ['issueSize'],
  applied: true,
  ...o,
});

function deps(overrides: Partial<AutoPersistDeps> = {}): AutoPersistDeps {
  return {
    loadDocuments: vi.fn(async () => [doc()]),
    loadStates: vi.fn(async () => [
      { id: 'state-1', docType: 'RHP', documentId: 'doc-1', extractedAt: null, extractorVersion: null },
    ]),
    runExtractor: vi.fn(() => ({ ok: true as const, extraction: extraction() })),
    persistFiling: vi.fn(async () => summary()) as never,
    persisterDeps: { protectionFilter: vi.fn() } as never,
    setDocumentExtractionState: vi.fn(async () => undefined),
    setFetchStateExtracted: vi.fn(async () => undefined),
    invalidateCaches: vi.fn(async () => undefined),
    fileExists: () => true,
    storeDir: 'C:/store',
    version: EXTRACTOR_VERSION,
    ...overrides,
  };
}

beforeEach(() => {
  recordedSteps.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ENABLE_FILING_AUTO_PERSIST;
});

// --------------------------------------------------------------------- flag

describe('the flag is off unless it is explicitly on', () => {
  it('autoPersistEnabled() is false with the env var unset — production behaviour is unchanged', () => {
    // FEATURE_FLAGS is evaluated at import time from an env that does not set
    // ENABLE_FILING_AUTO_PERSIST, which is exactly the production shape today.
    expect(autoPersistEnabled()).toBe(false);
  });
});

// ---------------------------------------------------- selectPendingFilings

describe('selectPendingFilings — what still needs extracting', () => {
  const states = [
    { docType: 'RHP', documentId: 'doc-1', extractedAt: null, extractorVersion: null },
  ];
  const exists = () => true;

  it('picks up a stored, never-extracted document', () => {
    const { pending } = selectPendingFilings('ipo-1', [doc()], states, { fileExists: exists });
    expect(pending.map((d) => d.type)).toEqual(['RHP']);
  });

  it('SKIPS a document already extracted by the current extractor version (no second spawn)', () => {
    const { pending, skipped } = selectPendingFilings(
      'ipo-1',
      [doc({ extractionStatus: 'COMPLETED', extractedAt: new Date() })],
      [{ docType: 'RHP', documentId: 'doc-1', extractedAt: new Date(), extractorVersion: EXTRACTOR_VERSION }],
      { fileExists: exists, version: EXTRACTOR_VERSION }
    );
    expect(pending).toHaveLength(0);
    expect(skipped[0]).toContain('already extracted');
  });

  it('RE-extracts the same document after an extractor version bump', () => {
    const { pending } = selectPendingFilings(
      'ipo-1',
      [doc({ extractionStatus: 'COMPLETED', extractedAt: new Date() })],
      [{ docType: 'RHP', documentId: 'doc-1', extractedAt: new Date(), extractorVersion: 'old-version' }],
      { fileExists: exists, version: EXTRACTOR_VERSION }
    );
    expect(pending).toHaveLength(1);
  });

  it('skips a doc type the extractor does not understand, and one with no stored file', () => {
    const { pending, skipped } = selectPendingFilings(
      'ipo-1',
      [doc({ type: 'BIDDING_CENTERS' }), doc({ id: 'doc-2', type: 'DRHP' })],
      states,
      { fileExists: () => false }
    );
    expect(pending).toHaveLength(0);
    expect(skipped.join(' ')).toContain('not an extractable doc type');
    expect(skipped.join(' ')).toContain('no stored file');
  });

  it('skips a document with no sha256 — we cannot name its file on disk', () => {
    const { pending, skipped } = selectPendingFilings('ipo-1', [doc({ sha256: null })], states, { fileExists: exists });
    expect(pending).toHaveLength(0);
    expect(skipped[0]).toContain('no sha256');
  });
});

// -------------------------------------------------- processPendingFilings

describe('processPendingFilings — the happy path', () => {
  it('spawns the extractor once, persists with apply:true through the shared deps, and invalidates caches', async () => {
    const withFile = deps();
    const r2 = await processPendingFilings(IPO, withFile);

    expect(r2.considered).toBe(1);
    expect(r2.spawned).toBe(1);
    expect(r2.persisted).toBe(1);
    expect(withFile.runExtractor).toHaveBeenCalledTimes(1);

    const persistCall = (withFile.persistFiling as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(persistCall[0]).toBe('ipo-1');
    expect(persistCall[2]).toMatchObject({ docType: 'RHP', apply: true, documentId: 'doc-1', sourceSha: SHA });
    // The SAME dependency set the CLI uses, protection filter included.
    expect(persistCall[3]).toBe(withFile.persisterDeps);
    expect(persistCall[3].protectionFilter).toBeDefined();

    expect(withFile.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'IN_PROGRESS', retryCount: 1 })
    );
    expect(withFile.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'COMPLETED' })
    );
    expect(withFile.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'COMPLETED', retryCount: 0 })
    );
    expect(withFile.setFetchStateExtracted).toHaveBeenCalledWith({
      stateId: 'state-1',
      extractedAt: expect.any(Date),
      extractorVersion: EXTRACTOR_VERSION,
    });
    expect(withFile.invalidateCaches).toHaveBeenCalledWith('rays-of-belief-ltd');

    const ids = recordedSteps.flatMap((r) => r.writes.map((w) => w.stepId));
    expect(ids).toEqual(expect.arrayContaining(['E1', 'E9', 'E10', 'G1', 'G3', 'G4', 'J1']));
  });

  it('a second run over an already-extracted document spawns NO python at all', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [doc({ extractionStatus: 'COMPLETED', extractedAt: new Date() })]),
      loadStates: vi.fn(async () => [
        { id: 'state-1', docType: 'RHP', documentId: 'doc-1', extractedAt: new Date(), extractorVersion: EXTRACTOR_VERSION },
      ]),
    });
    const result = await processPendingFilings(IPO, d);
    expect(result.spawned).toBe(0);
    expect(d.runExtractor).not.toHaveBeenCalled();
    expect(d.persistFiling).not.toHaveBeenCalled();
  });
});

describe('processPendingFilings — failures are recorded, never fatal', () => {
  it('an extractor failure writes FAILED E-rows with a backoff, marks IN_PROGRESS with retryCount 1, and FAILED with retryCount unchanged', async () => {
    const d = deps({ runExtractor: vi.fn(() => ({ ok: false as const, error: 'extractor exited 1: boom' })) });

    const result = await processPendingFilings(IPO, d);

    expect(result.failed).toBe(1);
    expect(result.persisted).toBe(0);
    expect(d.persistFiling).not.toHaveBeenCalled();

    const eWrites = recordedSteps.flatMap((r) => r.writes).filter((w) => w.stepId.startsWith('E'));
    expect(eWrites).toHaveLength(10);
    for (const w of eWrites) {
      expect(w.status).toBe('FAILED');
      expect((w as { error?: string }).error).toContain('boom');
      expect((w as { nextDueAt?: Date }).nextDueAt).toBeInstanceOf(Date);
    }
    // Round 4: the attempt is counted at the IN_PROGRESS stamp (transition 1) —
    // retryCount 1 written THERE, and the subsequent FAILED write (transition
    // 3) leaves retryCount unchanged (no retryCount key at all).
    expect(d.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'IN_PROGRESS', retryCount: 1 })
    );
    const failedCall = (d.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].status === 'FAILED'
    );
    expect(failedCall[0]).not.toHaveProperty('retryCount');
    expect(failedCall[0].error).toContain('extractor: ');
    expect(failedCall[0].error).toContain('boom');
  });

  it('(e) a persist throw is FAILED (never PENDING), retryCount unchanged, and does not throw out of the service', async () => {
    const d = deps({
      persistFiling: vi.fn(async () => {
        throw new Error('unique constraint violated');
      }) as never,
    });

    const result = await processPendingFilings(IPO, d);
    expect(result.failed).toBe(1);
    const g3 = recordedSteps.flatMap((r) => r.writes).find((w) => w.stepId === 'G3');
    expect(g3.status).toBe('FAILED');
    expect(d.invalidateCaches).not.toHaveBeenCalled();

    const failedCall = (d.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].status === 'FAILED'
    );
    expect(failedCall[0].error).toContain('persist: ');
    expect(failedCall[0].error).toContain('unique constraint violated');
    expect(failedCall[0]).not.toHaveProperty('retryCount');
  });

  it('a document-load failure returns an empty result instead of throwing', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(processPendingFilings(IPO, d)).resolves.toMatchObject({ considered: 0, spawned: 0 });
  });
});

describe('processPendingFilings — the W-45 paired-agreement gate is not skipped', () => {
  /** The extractor's real series shape: `{ "<fiscal year>": <number> }`. */
  const withRevenue = (revenue: number, unit: string | null = 'MILLION') =>
    ({
      doc_type: 'RHP',
      extraction_status: 'OK',
      unit,
      fiscal_years: [2024],
      fields: {
        revenue_by_fy: {
          value: { '2024': revenue },
          page: 1,
          check: { name: 'revenue_year_series', passed: true, detail: 'ok' },
        },
      },
    }) as unknown as FilingExtraction;

  function pairDeps(adRevenue: number, rhpRevenue: number, unit: string | null = 'MILLION') {
    return deps({
      loadDocuments: vi.fn(async () => [
        doc({ id: 'doc-ad', type: 'PRICE_BAND_AD', sha256: 'b'.repeat(64) }),
        doc({ id: 'doc-rhp', type: 'RHP' }),
      ]),
      loadStates: vi.fn(async () => [
        { id: 's1', docType: 'PRICE_BAND_AD', documentId: 'doc-ad', extractedAt: null, extractorVersion: null },
        { id: 's2', docType: 'RHP', documentId: 'doc-rhp', extractedAt: null, extractorVersion: null },
      ]),
      runExtractor: vi.fn(({ docType }) => ({
        ok: true as const,
        extraction: withRevenue(docType === 'RHP' ? rhpRevenue : adRevenue, unit),
      })),
    });
  }

  const revenueOf = (call: unknown[]) =>
    (call[1] as FilingExtraction).fields?.revenue_by_fy?.value ?? null;

  it('withholds the disagreeing series from BOTH documents when the ad and the RHP disagree', async () => {
    const d = pairDeps(10, 1000);
    const result = await processPendingFilings(IPO, d);

    expect(result.persisted).toBe(2);
    const calls = (d.persistFiling as ReturnType<typeof vi.fn>).mock.calls;
    // The gate ran: the mis-parsed revenue series is gone from both payloads, so
    // neither document's financial block can reach the database.
    for (const call of calls) expect(revenueOf(call)).toBeNull();
  });

  it('lets an AGREEING pair through with the series intact — the gate is not a blanket block', async () => {
    const d = pairDeps(1000, 1000);
    const result = await processPendingFilings(IPO, d);

    expect(result.persisted).toBe(2);
    const calls = (d.persistFiling as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) expect(revenueOf(call)).toEqual({ '2024': 1000 });
  });

  it('persists NOTHING when the two documents state no comparable unit', async () => {
    const d = pairDeps(10, 1000, null);
    const result = await processPendingFilings(IPO, d);

    expect(d.persistFiling).not.toHaveBeenCalled();
    expect(d.invalidateCaches).not.toHaveBeenCalled();
    expect(result.persisted).toBe(0);
    // The refusal is visible in the ledger, not just in a log line.
    const blocked = recordedSteps.flatMap((r) => r.writes).find((w) => w.status === 'BLOCKED');
    expect(blocked?.stepId).toBe('G1');
  });
});

// ---------------------------------------- MAJOR-A: per-document retry gate

describe('documentExtractionBlocked — pure per-document gate logic', () => {
  const now = new Date('2026-09-03T10:00:00Z');
  const V1 = EXTRACTOR_VERSION;

  it('a never-tried document (PENDING, retryCount 0) never blocks', () => {
    expect(
      documentExtractionBlocked({ extractionStatus: 'PENDING', retryCount: 0, updatedAt: null }, V1, now).blocked
    ).toBe(false);
  });

  it('(g) MANUAL_REVIEW at the CURRENT version blocks, regardless of updatedAt', () => {
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'MANUAL_REVIEW', extractionError: `${EXTRACTION_BLOCKED_ERROR}@${V1}`, retryCount: 10, updatedAt: now },
        V1,
        now
      ).blocked
    ).toBe(true);
  });

  it('(g) MANUAL_REVIEW at a DIFFERENT (older) version does not block — eligible again', () => {
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'MANUAL_REVIEW', extractionError: `${EXTRACTION_BLOCKED_ERROR}@old-version`, retryCount: 10, updatedAt: now },
        V1,
        now
      ).blocked
    ).toBe(false);
  });

  it('FAILED with retryCount 1 blocks 5 minutes later, and is clear 20 minutes later', () => {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    const twentyMinAgo = new Date(now.getTime() - 20 * 60_000);
    // attemptsBefore = retryCount(1) - 1 = 0 -> backoff = 15 min.
    expect(
      documentExtractionBlocked({ extractionStatus: 'FAILED', retryCount: 1, updatedAt: fiveMinAgo }, V1, now).blocked
    ).toBe(true);
    expect(
      documentExtractionBlocked({ extractionStatus: 'FAILED', retryCount: 1, updatedAt: twentyMinAgo }, V1, now).blocked
    ).toBe(false);
  });

  it('(c) a killed-mid-extraction IN_PROGRESS row is gated by the SAME backoff as FAILED', () => {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    const twentyMinAgo = new Date(now.getTime() - 20 * 60_000);
    expect(
      documentExtractionBlocked({ extractionStatus: 'IN_PROGRESS', retryCount: 1, updatedAt: fiveMinAgo }, V1, now)
        .blocked
    ).toBe(true);
    expect(
      documentExtractionBlocked({ extractionStatus: 'IN_PROGRESS', retryCount: 1, updatedAt: twentyMinAgo }, V1, now)
        .blocked
    ).toBe(false);
  });
});

describe('selectPendingFilings — the per-document retry gate (MAJOR-A)', () => {
  const twoStates = [
    { docType: 'RHP', documentId: 'doc-x', extractedAt: null, extractorVersion: null },
    { docType: 'PROSPECTUS', documentId: 'doc-y', extractedAt: null, extractorVersion: null },
  ];
  const now = new Date('2026-09-03T10:00:00Z');

  it('(a) doc X FAILED 1 attempt 5 min ago and doc Y PENDING -> only Y is selected', () => {
    const x = doc({
      id: 'doc-x',
      type: 'RHP',
      extractionStatus: 'FAILED',
      retryCount: 1,
      updatedAt: new Date(now.getTime() - 5 * 60_000),
    });
    const y = doc({ id: 'doc-y', type: 'PROSPECTUS', sha256: 'b'.repeat(64), extractionStatus: 'PENDING' });
    const { pending, skipped } = selectPendingFilings('ipo-1', [x, y], twoStates, { fileExists: () => true, now });
    expect(pending.map((d) => d.id)).toEqual(['doc-y']);
    expect(skipped.join(' ')).toContain('backing off');
  });

  it('(b) doc X FAILED 1 attempt 20 min ago -> X is selected — its own backoff window has elapsed', () => {
    const x = doc({
      id: 'doc-x',
      type: 'RHP',
      extractionStatus: 'FAILED',
      retryCount: 1,
      updatedAt: new Date(now.getTime() - 20 * 60_000),
    });
    const { pending } = selectPendingFilings('ipo-1', [x], twoStates, { fileExists: () => true, now });
    expect(pending.map((d) => d.id)).toEqual(['doc-x']);
  });

  it('(c) a document at retryCount 10 / MANUAL_REVIEW at the current version is never selected', () => {
    const x = doc({
      id: 'doc-x',
      type: 'RHP',
      extractionStatus: 'MANUAL_REVIEW',
      extractionError: `${EXTRACTION_BLOCKED_ERROR}@${EXTRACTOR_VERSION}`,
      retryCount: MAX_EXTRACTION_ATTEMPTS,
    });
    const { pending, skipped } = selectPendingFilings('ipo-1', [x], twoStates, { fileExists: () => true, now });
    expect(pending).toHaveLength(0);
    expect(skipped[0]).toContain(EXTRACTION_BLOCKED_ERROR);
  });

  it('(g) a document MANUAL_REVIEW at an OLDER version is selected again, resetting to retryCount 1', async () => {
    const x = doc({
      id: 'doc-x',
      type: 'RHP',
      extractionStatus: 'MANUAL_REVIEW',
      extractionError: `${EXTRACTION_BLOCKED_ERROR}@old-version`,
      retryCount: MAX_EXTRACTION_ATTEMPTS,
    });
    const { pending } = selectPendingFilings('ipo-1', [x], twoStates, { fileExists: () => true, now });
    expect(pending.map((d) => d.id)).toEqual(['doc-x']);

    const d = deps({ loadDocuments: vi.fn(async () => [x]) });
    await processPendingFilings(IPO, d);
    expect(d.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-x', status: 'IN_PROGRESS', retryCount: 1 })
    );
  });

  it('one document backing off does NOT block an unrelated sibling document of the same IPO', () => {
    // Regression pin for MAJOR-A: before the fix, a shared per-IPO gate meant
    // ANY document's failure blocked every OTHER document belonging to the
    // same IPO. Two documents, one blocked, one not — both decided independently.
    const blocked = doc({
      id: 'doc-blocked',
      type: 'RHP',
      extractionStatus: 'MANUAL_REVIEW',
      extractionError: `${EXTRACTION_BLOCKED_ERROR}@${EXTRACTOR_VERSION}`,
      retryCount: MAX_EXTRACTION_ATTEMPTS,
    });
    const ok = doc({ id: 'doc-ok', type: 'PROSPECTUS', sha256: 'c'.repeat(64), extractionStatus: 'PENDING' });
    const { pending } = selectPendingFilings('ipo-1', [blocked, ok], twoStates, { fileExists: () => true, now });
    expect(pending.map((d) => d.id)).toEqual(['doc-ok']);
  });
});

describe('processPendingFilings — per-document retry bookkeeping (MAJOR-A)', () => {
  it('(d) success resets retryCount to 0 and clears the error', async () => {
    const d = deps({ loadDocuments: vi.fn(async () => [doc({ retryCount: 4 })]) });
    await processPendingFilings(IPO, d);
    expect(d.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'COMPLETED', error: null, retryCount: 0 })
    );
  });

  it('a failure passes this document own PREVIOUS retryCount as attemptsBefore, producing the matching backoff', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [doc({ retryCount: 4 })]),
      runExtractor: vi.fn(() => ({ ok: false as const, error: 'boom' })),
    });
    await processPendingFilings(IPO, d);
    const eWrite = recordedSteps.flatMap((r) => r.writes).find((w) => w.stepId === 'E1') as { nextDueAt?: Date };
    // attemptsBefore=4 (the value BEFORE the IN_PROGRESS stamp) -> 2^4 x 15min = 4h.
    expect(eWrite.nextDueAt).toBeInstanceOf(Date);
    // Round 4: the IN_PROGRESS stamp writes retryCount 5 (4+1); the later
    // FAILED write carries no retryCount at all (unchanged from that stamp).
    expect(d.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'IN_PROGRESS', retryCount: 5 })
    );
    const failedCall = (d.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].status === 'FAILED'
    );
    expect(failedCall[0]).not.toHaveProperty('retryCount');
  });

  it('(f) the 10th stamp (retryCount 9 -> 10) is recorded MANUAL_REVIEW with the version in the error', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [doc({ retryCount: MAX_EXTRACTION_ATTEMPTS - 1 })]),
      runExtractor: vi.fn(() => ({ ok: false as const, error: 'boom' })),
    });
    await processPendingFilings(IPO, d);
    const expectedError = `${EXTRACTION_BLOCKED_ERROR}@${EXTRACTOR_VERSION}`;
    expect(d.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        status: 'MANUAL_REVIEW',
        error: expectedError,
        retryCount: MAX_EXTRACTION_ATTEMPTS,
      })
    );
    const eWrites = recordedSteps.flatMap((r) => r.writes).filter((w) => w.stepId.startsWith('E'));
    for (const w of eWrites) expect((w as { error?: string }).error).toBe(expectedError);
  });

  it('a document already at the cap (MANUAL_REVIEW at the current version) is blocked before spawning at all', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [
        doc({
          extractionStatus: 'MANUAL_REVIEW',
          extractionError: `${EXTRACTION_BLOCKED_ERROR}@${EXTRACTOR_VERSION}`,
          retryCount: MAX_EXTRACTION_ATTEMPTS,
        }),
      ]),
    });
    const result = await processPendingFilings(IPO, d);
    expect(result.spawned).toBe(0);
    expect(d.runExtractor).not.toHaveBeenCalled();
  });
});

describe('processPendingFilings — the W-45 disagreement failure path (round 4)', () => {
  it('(d) a W-45 refusal is FAILED (not MANUAL_REVIEW), with retryCount unchanged from the extract-time stamp', async () => {
    // decidePairedPersist only refuses outright (proceed:false) when the two
    // documents cannot be compared at all — an ordinary numeric disagreement
    // instead proceeds with the metric withheld (see the withholding test
    // above). No comparable unit is the refusal path this test exercises.
    const withRevenue = (revenue: number, unit: string | null) =>
      ({
        doc_type: 'RHP',
        extraction_status: 'OK',
        unit,
        fiscal_years: [2024],
        fields: {
          revenue_by_fy: {
            value: { '2024': revenue },
            page: 1,
            check: { name: 'revenue_year_series', passed: true, detail: 'ok' },
          },
        },
      }) as unknown as FilingExtraction;

    const d = deps({
      loadDocuments: vi.fn(async () => [
        doc({ id: 'doc-ad', type: 'PRICE_BAND_AD', sha256: 'b'.repeat(64) }),
        doc({ id: 'doc-rhp', type: 'RHP' }),
      ]),
      loadStates: vi.fn(async () => [
        { id: 's1', docType: 'PRICE_BAND_AD', documentId: 'doc-ad', extractedAt: null, extractorVersion: null },
        { id: 's2', docType: 'RHP', documentId: 'doc-rhp', extractedAt: null, extractorVersion: null },
      ]),
      runExtractor: vi.fn(({ docType }) => ({
        ok: true as const,
        extraction: withRevenue(docType === 'RHP' ? 1000 : 10, null),
      })),
    });

    await processPendingFilings(IPO, d);

    const calls = (d.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls;
    const failedCalls = calls.filter((c) => c[0].status === 'FAILED');
    expect(failedCalls).toHaveLength(2);
    for (const call of failedCalls) {
      expect(call[0].error).toContain('w45_disagreement');
      expect(call[0]).not.toHaveProperty('retryCount');
    }

    // Selected again once its own backoff (retryCount 1 -> 15 min) elapses.
    const failedDoc = doc({
      id: 'doc-ad',
      type: 'PRICE_BAND_AD',
      sha256: 'b'.repeat(64),
      extractionStatus: 'FAILED',
      retryCount: 1,
      updatedAt: new Date(Date.now() - 20 * 60_000),
    });
    const { pending } = selectPendingFilings('ipo-1', [failedDoc], [], { fileExists: () => true });
    expect(pending.map((x) => x.id)).toEqual(['doc-ad']);
  });
});

// ------------------------------------------------------- MAJOR-1: spawn cap

describe('processPendingFilings — the per-cycle spawn budget (MAJOR-1)', () => {
  const FIVE_DOCS = Array.from({ length: 5 }, (_, i) => doc({ id: `doc-${i}`, sha256: SHA }));
  const FIVE_STATES = FIVE_DOCS.map((d) => ({
    id: `state-${d.id}`,
    docType: 'RHP',
    documentId: d.id,
    extractedAt: null,
    extractorVersion: null,
  }));

  it('5 pending docs with a budget of 3 spawn exactly 3 and leave 2 as skipped_budget', async () => {
    const budget = { remaining: 3 };
    const d = deps({
      loadDocuments: vi.fn(async () => FIVE_DOCS),
      loadStates: vi.fn(async () => FIVE_STATES),
      spawnBudget: budget,
    });

    const result = await processPendingFilings(IPO, d);

    expect(result.spawned).toBe(3);
    expect(result.skippedBudget).toBe(2);
    expect(d.runExtractor).toHaveBeenCalledTimes(3);
    expect(budget.remaining).toBe(0);
    expect(result.skipped.join(' ')).toContain('spawn budget exhausted');
  });

  it('a budget already at zero spawns nothing for this IPO', async () => {
    const budget = { remaining: 0 };
    const d = deps({
      loadDocuments: vi.fn(async () => FIVE_DOCS),
      loadStates: vi.fn(async () => FIVE_STATES),
      spawnBudget: budget,
    });

    const result = await processPendingFilings(IPO, d);

    expect(result.spawned).toBe(0);
    expect(result.skippedBudget).toBe(5);
    expect(d.runExtractor).not.toHaveBeenCalled();
  });

  it('with no spawnBudget dep at all (unset), behaviour is unbounded — existing callers are unaffected', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => FIVE_DOCS),
      loadStates: vi.fn(async () => FIVE_STATES),
    });
    const result = await processPendingFilings(IPO, d);
    expect(result.spawned).toBe(5);
    expect(result.skippedBudget).toBe(0);
  });
});

// --------------------------------------------------- MINOR-1: python binary

describe('defaultExtractorRunner — python binary resolution', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    delete process.env.PYTHON_BIN;
  });

  it('an ENOENT on the first spawn retries once with python3', () => {
    spawnSyncMock
      .mockReturnValueOnce({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ doc_type: 'RHP', fields: {} }), stderr: '' });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect(spawnSyncMock.mock.calls[0][0]).toBe('python');
    expect(spawnSyncMock.mock.calls[1][0]).toBe('python3');
    expect(result.ok).toBe(true);
  });

  it('honours PYTHON_BIN when set, with no retry needed', () => {
    process.env.PYTHON_BIN = 'python3.11';
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ doc_type: 'RHP', fields: {} }), stderr: '' });

    defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][0]).toBe('python3.11');
  });
});
