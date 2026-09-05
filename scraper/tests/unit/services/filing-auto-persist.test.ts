import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** MINOR-1: spawnSync is mocked at the module boundary so the ENOENT/python3 retry is testable. */
const spawnSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ spawnSync: (...args: unknown[]) => spawnSyncMock(...args) }));

/**
 * D-15 lift: mutable so tests can flip ENABLE_SME_FILING_AUTO_PERSIST per case without
 * re-importing the module (same pattern as document-cycle-passes.test.ts). Both flags
 * default to false — production shape — and are reset in afterEach. Declared via
 * vi.hoisted so it exists by the time the hoisted vi.mock factory below runs.
 */
const MOCK_FEATURE_FLAGS = vi.hoisted(() => ({
  ENABLE_FILING_AUTO_PERSIST: false,
  ENABLE_SME_FILING_AUTO_PERSIST: false,
}));
vi.mock('../../../src/config/feature-flags.js', () => ({ FEATURE_FLAGS: MOCK_FEATURE_FLAGS }));

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
  smeAutoPersistEnabled,
  documentExtractionBlocked,
  defaultExtractorRunner,
  EXTRACTOR_VERSION,
  MAX_EXTRACTION_ATTEMPTS,
  EXTRACTION_BLOCKED_ERROR,
  EXTRACTOR_MEMORY_CEILING_EXIT,
  HARD_FAILURE_MARKER,
  HARD_FAILURE_MIN_BACKOFF_MS,
  parseHardFailureCount,
  markHardFailure,
  isMemoryAbortStderr,
  DEFAULT_MAX_SPAWNS_PER_CYCLE as DEFAULT_MAX_SPAWNS_PER_CYCLE_REAL,
  EXTRACT_TIMEOUT_MS as EXTRACT_TIMEOUT_MS_REAL,
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
  MOCK_FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST = false;
  MOCK_FEATURE_FLAGS.ENABLE_SME_FILING_AUTO_PERSIST = false;
});

// ------------------------------------------------------ MEMORY_ABORT_STDERR_RE

describe('isMemoryAbortStderr — round 5 MINOR-1 (Killed word-boundary anchor)', () => {
  it('matches the shell OOM-killer message', () => {
    expect(isMemoryAbortStderr('Killed')).toBe(true);
    expect(isMemoryAbortStderr('some output\nKilled\n')).toBe(true);
  });

  it('does NOT match unrelated stderr text merely containing "skilled" or lowercase "killed" in prose', () => {
    // Previously unanchored + case-insensitive: the old single regex was
    // `/…|Killed/i`, which matched "skilled" (contains the substring
    // "killed" is false lexically, but the old pattern had no word boundary
    // so it matched inside "skilled" too) and lowercase "killed" inside
    // unrelated prose (e.g. a worker-pool log line) — both are the
    // adversarial repros named in the brief and must not match at all.
    expect(isMemoryAbortStderr('warning: this route reassigns the skilled worker pool')).toBe(false);
    expect(isMemoryAbortStderr('note: previously killed by user via CTRL+C, retrying')).toBe(false);
  });

  it('does NOT match an incidental mention of MemoryError inside a comment/log line, only an actual exception line', () => {
    expect(
      isMemoryAbortStderr(
        'Traceback (most recent call last):\n  # NOTE: this branch previously mentions MemoryError in a comment, not a real exception\n  ValueError: bad input\n'
      )
    ).toBe(false);
    expect(isMemoryAbortStderr('Traceback (most recent call last):\nMemoryError: \n')).toBe(true);
    expect(isMemoryAbortStderr('MemoryError')).toBe(true);
  });
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

// -------------------------------------------------------- D-15 segment gate

describe('processPendingFilings — the D-15 segment gate (SME not validated yet)', () => {
  const SME_IPO = { ...IPO, segment: 'SME' };

  it('an SME candidate: no spawn, no persist, one E1 NOT_AVAILABLE_YET row with reason sme_not_validated', async () => {
    const d = deps();
    const result = await processPendingFilings(SME_IPO, d);

    expect(d.loadDocuments).not.toHaveBeenCalled();
    expect(d.loadStates).not.toHaveBeenCalled();
    expect(d.runExtractor).not.toHaveBeenCalled();
    expect(d.persistFiling).not.toHaveBeenCalled();
    expect(result.spawned).toBe(0);
    expect(result.persisted).toBe(0);
    expect(result.considered).toBe(0);

    expect(recordedSteps).toHaveLength(1);
    expect(recordedSteps[0]).toMatchObject({
      ipoId: 'ipo-1',
      writes: [
        expect.objectContaining({
          stepId: 'E1',
          status: 'NOT_AVAILABLE_YET',
          evidence: { reason: 'sme_not_validated' },
        }),
      ],
    });
  });

  it('an SME candidate never consumes the cycle-wide spawn budget', async () => {
    const d = deps({ spawnBudget: { remaining: 3 } });
    await processPendingFilings(SME_IPO, d);
    expect(d.spawnBudget!.remaining).toBe(3);
  });

  it('a MAINBOARD candidate is unaffected by the gate (control)', async () => {
    const d = deps();
    const result = await processPendingFilings(IPO, d);
    expect(result.spawned).toBe(1);
    expect(result.persisted).toBe(1);
    expect(d.loadDocuments).toHaveBeenCalled();
  });
});

// --------------------------------------------- D-15 lift (SME auto-persist)

describe('processPendingFilings — the D-15 lift behind ENABLE_SME_FILING_AUTO_PERSIST', () => {
  const SME_IPO = { ...IPO, segment: 'SME' };

  it('flag OFF (default): smeAutoPersistEnabled() is false — production behaviour is unchanged', () => {
    expect(smeAutoPersistEnabled()).toBe(false);
  });

  it('flag ON: an SME candidate spawns the extractor with sme:true and issue-size, persists through the same door, and writes no sme_not_validated row', async () => {
    MOCK_FEATURE_FLAGS.ENABLE_SME_FILING_AUTO_PERSIST = true;
    const smeIpoWithIssueSize = { ...SME_IPO, issueSize: 5_00_00_000 };
    const d = deps();

    const result = await processPendingFilings(smeIpoWithIssueSize, d);

    expect(d.loadDocuments).toHaveBeenCalled();
    expect(d.runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({ sme: true, issueSizeRupees: 5_00_00_000 })
    );
    expect(result.spawned).toBe(1);
    expect(result.persisted).toBe(1);
    // The SAME write door MAINBOARD uses — persistFiling called with the shared persisterDeps.
    expect(d.persistFiling).toHaveBeenCalled();
    const persistCall = (d.persistFiling as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(persistCall[3]).toBe(d.persisterDeps);

    const writesByIpo = recordedSteps.filter((r) => r.ipoId === smeIpoWithIssueSize.id);
    const evidenceReasons = writesByIpo.flatMap((r) =>
      r.writes.map((w) => (w as unknown as { evidence?: { reason?: string } }).evidence?.reason)
    );
    expect(evidenceReasons).not.toContain('sme_not_validated');
  });

  it('flag ON does not change a MAINBOARD candidate', async () => {
    MOCK_FEATURE_FLAGS.ENABLE_SME_FILING_AUTO_PERSIST = true;
    const d = deps();
    const result = await processPendingFilings(IPO, d);
    expect(result.spawned).toBe(1);
    expect(result.persisted).toBe(1);
    expect(d.runExtractor).toHaveBeenCalledWith(expect.objectContaining({ sme: false }));
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

  // F6 (S-02 round 6): a MANUAL_REVIEW row with NO encoded version at all —
  // an operator set it by hand, or it predates the `@<version>` encoding —
  // must NOT be treated the same as "blocked at an older build". There is no
  // version to compare, so it must stay blocked until a human clears it.
  it('F6 — MANUAL_REVIEW with NO encoded version (operator-set / legacy) BLOCKS, not revives', () => {
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'MANUAL_REVIEW', extractionError: 'operator flagged for manual check', retryCount: 3, updatedAt: now },
        V1,
        now
      ).blocked
    ).toBe(true);
  });

  it('F6 — MANUAL_REVIEW with a null/undefined extractionError BLOCKS, not revives', () => {
    expect(
      documentExtractionBlocked({ extractionStatus: 'MANUAL_REVIEW', extractionError: null, retryCount: 0, updatedAt: now }, V1, now)
        .blocked
    ).toBe(true);
    expect(
      documentExtractionBlocked({ extractionStatus: 'MANUAL_REVIEW', retryCount: 0, updatedAt: now }, V1, now).blocked
    ).toBe(true);
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

  // W-137: a document that has been killed/hit the memory ceiling TWICE must
  // not be retried an hour later just because the normal exponential curve
  // (2^attempts x 15 min, capped at 6h) says it is due.
  it('W-137 — 2 consecutive hard failures back off at least 24h, past the normal 6h cap', () => {
    const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60_000);
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60_000);
    const twoHardFailures = `${HARD_FAILURE_MARKER}:2:extractor exited null: killed`;

    // Ordinary exponential backoff at retryCount 5 is already capped at 6h,
    // so 20h later it would normally be clear — the hard-failure floor must
    // still hold it.
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'FAILED', retryCount: 5, updatedAt: twentyHoursAgo, extractionError: twoHardFailures },
        V1,
        now
      ).blocked
    ).toBe(true);

    expect(
      documentExtractionBlocked(
        { extractionStatus: 'FAILED', retryCount: 5, updatedAt: twentyFiveHoursAgo, extractionError: twoHardFailures },
        V1,
        now
      ).blocked
    ).toBe(false);
  });

  it('W-137 — a SINGLE hard failure still uses the normal exponential backoff (no 24h floor yet)', () => {
    const twentyMinAgo = new Date(now.getTime() - 20 * 60_000);
    const oneHardFailure = `${HARD_FAILURE_MARKER}:1:extractor exited null: killed`;
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'FAILED', retryCount: 1, updatedAt: twentyMinAgo, extractionError: oneHardFailure },
        V1,
        now
      ).blocked
    ).toBe(false);
  });
});

describe('parseHardFailureCount / markHardFailure — W-137 hard-failure marker', () => {
  it('parses the count out of a marked error', () => {
    expect(parseHardFailureCount(`${HARD_FAILURE_MARKER}:3:extractor exited null: boom`)).toBe(3);
  });

  it('returns 0 for null, undefined, and an ordinary (non-marked) error', () => {
    expect(parseHardFailureCount(null)).toBe(0);
    expect(parseHardFailureCount(undefined)).toBe(0);
    expect(parseHardFailureCount('extractor: some parse error')).toBe(0);
  });

  it('markHardFailure starts at 1 with no prior marker, and increments an existing one', () => {
    expect(markHardFailure(null, 'extractor exited null: killed')).toBe(
      `${HARD_FAILURE_MARKER}:1:extractor exited null: killed`
    );
    expect(markHardFailure(`${HARD_FAILURE_MARKER}:1:extractor exited null: killed`, 'extractor exited 3: killed again')).toBe(
      `${HARD_FAILURE_MARKER}:2:extractor exited 3: killed again`
    );
  });
});

describe('defaultExtractorRunner — W-137 hard-failure classification', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    delete process.env.PYTHON_BIN;
  });

  it('a signal-killed process (status null) is reported as a hard failure', () => {
    spawnSyncMock.mockReturnValueOnce({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(result.ok).toBe(false);
    expect((result as { hardFailure?: boolean }).hardFailure).toBe(true);
    expect((result as { error: string }).error).toContain('SIGKILL');
  });

  it('exit code EXTRACTOR_MEMORY_CEILING_EXIT (3) is reported as a hard failure', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: EXTRACTOR_MEMORY_CEILING_EXIT,
      stdout: '',
      stderr: JSON.stringify({ error: 'memory ceiling exceeded (2500 MB)' }),
    });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(result.ok).toBe(false);
    expect((result as { hardFailure?: boolean }).hardFailure).toBe(true);
  });

  it('an ordinary non-zero exit (e.g. bad doc type) is NOT a hard failure', () => {
    spawnSyncMock.mockReturnValueOnce({ status: 2, stdout: '', stderr: 'unknown doc type' });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(result.ok).toBe(false);
    expect((result as { hardFailure?: boolean }).hardFailure).toBe(false);
  });

  it('round 4: a C-level OpenBLAS abort (ordinary exit 1, EMPTY stdout) is still a hard failure — stderr is the only signal', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: 'OpenBLAS error: Memory allocation still failed after 10 retries, giving up.',
    });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(result.ok).toBe(false);
    expect((result as { hardFailure?: boolean }).hardFailure).toBe(true);
  });

  it('round 4: an ordinary exit 1 with unrelated stderr stays a SOFT failure', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: 'Traceback (most recent call last):\n  File "extract_filing.py", line 42\nValueError: unknown doc type XYZ',
    });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(result.ok).toBe(false);
    expect((result as { hardFailure?: boolean }).hardFailure).toBe(false);
  });
});

describe('processPendingFilings — round 4: a C-level memory abort is written as a hard failure', () => {
  it('an OpenBLAS-abort run (exit 1, empty stdout) reaches setDocumentExtractionState with the HARD_FAILURE marker', async () => {
    const d = deps({
      runExtractor: vi.fn(() => ({
        ok: false as const,
        error: 'extractor exited 1: OpenBLAS error: Memory allocation still failed after 10 retries, giving up.',
        hardFailure: true,
      })),
    });

    const result = await processPendingFilings(IPO, d);

    expect(result.failed).toBe(1);
    const failedCall = (d.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].status === 'FAILED'
    );
    expect(failedCall[0].error).toContain(HARD_FAILURE_MARKER);
  });
});

describe('processPendingFilings — W-137 hard-failure marker written end to end (MAJOR-1)', () => {
  /**
   * MAJOR-1 (round 2 review): the pure-function tests above prove
   * `markHardFailure`/`documentExtractionBlocked` are correct in isolation, but
   * nothing proved the SERVICE actually calls `markHardFailure` at the real
   * write site and that a THIRD attempt is refused by the 24h floor. Deleting
   * the `markHardFailure` call at its only call site (~941-943) left every
   * other test in this file green — this test is red against that deletion.
   */
  it('two signal-killed extractions on the same document write HARD_FAILURE:1 then HARD_FAILURE:2, and a third attempt is refused by the 24h floor', async () => {
    const makeKilledRunner = () =>
      vi.fn(() => ({ ok: false as const, error: 'extractor exited null (signal SIGKILL): ', hardFailure: true }));

    // --- attempt 1: fresh PENDING document, first hard failure -----------
    const d1 = deps({ runExtractor: makeKilledRunner(), loadDocuments: vi.fn(async () => [doc()]) });
    const r1 = await processPendingFilings(IPO, d1);
    expect(r1.spawned).toBe(1);
    const failed1 = (d1.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].status === 'FAILED'
    );
    expect(failed1[0].error).toBe(`${HARD_FAILURE_MARKER}:1:extractor: extractor exited null (signal SIGKILL): `);

    // --- attempt 2: document now FAILED with the 1st hard-failure marker,
    // updated 20 minutes ago — clear of the ordinary exponential backoff
    // (retryCount 1 -> 15 min) but still only ONE hard failure, so it is
    // NOT yet held by the 24h floor and the extractor runs again. ---------
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000);
    const docAfterFirstHardFailure = doc({
      extractionStatus: 'FAILED',
      retryCount: 1,
      extractionError: failed1[0].error,
      updatedAt: twentyMinAgo,
    });
    const d2 = deps({ runExtractor: makeKilledRunner(), loadDocuments: vi.fn(async () => [docAfterFirstHardFailure]) });
    const r2 = await processPendingFilings(IPO, d2);
    expect(r2.spawned).toBe(1);
    const failed2 = (d2.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].status === 'FAILED'
    );
    expect(failed2[0].error).toBe(`${HARD_FAILURE_MARKER}:2:extractor: extractor exited null (signal SIGKILL): `);

    // --- attempt 3: document now carries its 2nd hard-failure marker,
    // updated 20 hours ago — clear of the normal exponential cap (6h) but
    // still inside the W-137 24h hard-failure floor. The extractor MUST NOT
    // be spawned a third time, and the refusal reason must be recorded. ---
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60_000);
    const docAfterSecondHardFailure = doc({
      extractionStatus: 'FAILED',
      retryCount: 2,
      extractionError: failed2[0].error,
      updatedAt: twentyHoursAgo,
    });
    const d3 = deps({ runExtractor: makeKilledRunner(), loadDocuments: vi.fn(async () => [docAfterSecondHardFailure]) });
    const r3 = await processPendingFilings(IPO, d3);
    expect(r3.spawned).toBe(0);
    expect(d3.runExtractor).not.toHaveBeenCalled();
    expect(r3.skipped.some((s) => /extraction backing off until/.test(s))).toBe(true);
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

  it('a budget already at zero spawns nothing for this IPO, and (F5) never loads its documents', async () => {
    const budget = { remaining: 0 };
    const d = deps({
      loadDocuments: vi.fn(async () => FIVE_DOCS),
      loadStates: vi.fn(async () => FIVE_STATES),
      spawnBudget: budget,
    });

    const result = await processPendingFilings(IPO, d);

    expect(result.spawned).toBe(0);
    // F5: the budget is exhausted BEFORE this IPO's documents are even
    // loaded, so there is no document count left to report — the earlier
    // behaviour (loading all 5, then reporting skippedBudget=5) cost two DB
    // round trips for data that was thrown away unread.
    expect(result.skippedBudget).toBe(0);
    expect(d.runExtractor).not.toHaveBeenCalled();
    expect(d.loadDocuments).not.toHaveBeenCalled();
    expect(d.loadStates).not.toHaveBeenCalled();
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

// -------------------------------------------------- F3: extraction deadline

describe('processPendingFilings — the per-document extraction deadline (F3)', () => {
  const FIVE_DOCS = Array.from({ length: 5 }, (_, i) => doc({ id: `doc-${i}`, sha256: SHA }));
  const FIVE_STATES = FIVE_DOCS.map((d) => ({
    id: `state-${d.id}`,
    docType: 'RHP',
    documentId: d.id,
    extractedAt: null,
    extractorVersion: null,
  }));

  it('stops spawning once the deadline is reached BEFORE a new spawn, never interrupting one in flight', async () => {
    // Clock advances by 1 tick per read; deadlineMs=2 means: doc 0 checked at
    // t=0 (spawns), doc 1 checked at t=1 (spawns), doc 2 checked at t=2 -> at
    // the deadline, stop before spawning it (and every doc after it).
    let t = -1;
    const now = () => {
      t++;
      return t;
    };
    const d = deps({
      loadDocuments: vi.fn(async () => FIVE_DOCS),
      loadStates: vi.fn(async () => FIVE_STATES),
      deadlineMs: 2,
      now,
    });

    const result = await processPendingFilings(IPO, d);

    expect(d.runExtractor).toHaveBeenCalledTimes(2);
    expect(result.spawned).toBe(2);
    expect(result.skippedBudget).toBe(3);
    expect(result.skipped.join(' ')).toContain('extraction deadline reached');
  });

  it('with no deadlineMs set, all pending documents are spawned (existing callers unaffected)', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => FIVE_DOCS),
      loadStates: vi.fn(async () => FIVE_STATES),
    });
    const result = await processPendingFilings(IPO, d);
    expect(result.spawned).toBe(5);
    expect(result.skippedBudget).toBe(0);
  });
});

/**
 * F3 static invariant: the cap MUST never let extraction outlive the lock
 * that protects it from a second overlapping cycle. Worst case, every spawn
 * takes the full extractor timeout — that total, plus slack, must stay under
 * the lock TTL.
 */
describe('F3 — spawn cap cannot outlive the extraction lock', () => {
  it('DEFAULT_MAX_SPAWNS_PER_CYCLE * EXTRACT_TIMEOUT_MS + 60s < FILING_EXTRACTION_LOCK_TTL_MS', async () => {
    const { FILING_EXTRACTION_LOCK_TTL_MS } = await import('../../../src/services/document-cycle.js');
    const worstCaseMs = DEFAULT_MAX_SPAWNS_PER_CYCLE_REAL * EXTRACT_TIMEOUT_MS_REAL + 60_000;
    expect(worstCaseMs).toBeLessThan(FILING_EXTRACTION_LOCK_TTL_MS);
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

  // W-111 round 2: an ENOENT on an EXPLICITLY-set PYTHON_BIN (the deploy-
  // managed venv path — deploy-linux.sh) must NOT silently fall back to
  // system python3 — that is the exact drift this venv exists to prevent
  // (W-112). Only the unset/default-'python' path gets the python3 retry.
  it('does NOT retry with python3 on ENOENT when PYTHON_BIN is explicitly set (no silent fallback to system python)', () => {
    process.env.PYTHON_BIN = '/var/www/ipodhan/shared/venv/prod/bin/python';
    spawnSyncMock.mockReturnValueOnce({
      error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
    });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][0]).toBe('/var/www/ipodhan/shared/venv/prod/bin/python');
    expect(result.ok).toBe(false);
  });

  // W-111 round 3: PYTHON_BIN set but EMPTY (or whitespace-only) must be
  // treated exactly like unset — `??` only falls back on null/undefined, so
  // an empty string would otherwise become the literal spawn binary name
  // (immediate ENOENT on a name no shell resolves) instead of going
  // straight to 'python'.
  it('treats an empty PYTHON_BIN the same as unset — spawns "python" directly, not an empty binary name', () => {
    process.env.PYTHON_BIN = '';
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ doc_type: 'RHP', fields: {} }), stderr: '' });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][0]).toBe('python');
    expect(result.ok).toBe(true);
  });

  it('treats a whitespace-only PYTHON_BIN the same as unset', () => {
    process.env.PYTHON_BIN = '   ';
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ doc_type: 'RHP', fields: {} }), stderr: '' });

    const result = defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false });

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][0]).toBe('python');
    expect(result.ok).toBe(true);
  });

  // W-129 review: the net-worth/magnitude plausibility checks in the python
  // extractor only run when --issue-size is on the command line — wire it.
  it('appends --issue-size with the integer rupee value when issueSizeRupees is a finite positive number', () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ doc_type: 'RHP', fields: {} }), stderr: '' });

    defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false, issueSizeRupees: 451104000 });

    const args = spawnSyncMock.mock.calls[0][1] as string[];
    const idx = args.indexOf('--issue-size');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('451104000');
  });

  it.each([null, undefined, 0, NaN])(
    'omits --issue-size when issueSizeRupees is %s',
    (value) => {
      spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ doc_type: 'RHP', fields: {} }), stderr: '' });

      defaultExtractorRunner({ pdfPath: 'x.pdf', docType: 'RHP', sme: false, issueSizeRupees: value as never });

      const args = spawnSyncMock.mock.calls[0][1] as string[];
      expect(args).not.toContain('--issue-size');
    }
  );
});
