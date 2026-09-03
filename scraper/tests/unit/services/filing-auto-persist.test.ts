import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  EXTRACTOR_VERSION,
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
      expect.objectContaining({ documentId: 'doc-1', status: 'IN_PROGRESS' })
    );
    expect(withFile.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'COMPLETED' })
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
  it('an extractor failure writes FAILED E-rows with a backoff and returns the document to PENDING', async () => {
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
    expect(d.setDocumentExtractionState).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'PENDING' })
    );
  });

  it('a persist failure is recorded as a FAILED G3 and does not throw out of the service', async () => {
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
