import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #959 — a failed extraction is re-read on a new extractor version or a new document, never on a timer.
 *
 * Spec basis: data-sourcing-pull-model.md §2 "One download, one read (OD-33)" ("A document is read once,
 * on arrival, and again only when (a) a newer document type arrives for that IPO, (b) the extractor
 * version changes ... There is no interval, no backoff timer"), §5.3 rule 5 ("Never on a backoff timer"),
 * OD-21 ("no timed retry"), §2.2 (a walk killed mid-extraction must be resumable — an OOM kill, a deploy
 * or a crash), OD-55 (a document is read to completion).
 *
 * Measured on ipodhan_staging 2026-09-26: 6 documents sat on the timer — 2 anchor deterministic refusals
 * (retry 1) and 4 `HARD_FAILURE:4..8` "extractor exited 1" (retries 4-8). The fixtures below are those shapes.
 */

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('../../../src/utils/low-priority-spawn.js', () => ({
  withLowPriority: (bin: string, args: string[]) => ({ bin, args }),
  EXTRACTOR_BUSY_EXIT_CODE: 75,
}));
const MOCK_FEATURE_FLAGS = vi.hoisted(() => ({
  ENABLE_FILING_AUTO_PERSIST: false,
  ENABLE_SME_FILING_AUTO_PERSIST: false,
}));
vi.mock('../../../src/config/feature-flags.js', () => ({ FEATURE_FLAGS: MOCK_FEATURE_FLAGS }));

const recordedSteps: { ipoId: string; writes: Record<string, unknown>[] }[] = [];
vi.mock('../../../src/services/step-ledger-recorders.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeSteps: vi.fn(async (ipoId: string, writes: never[]) => {
      recordedSteps.push({ ipoId, writes: writes as never });
      return writes.length;
    }),
    recordLiveStep: vi.fn(async () => 1),
  };
});

import {
  documentExtractionBlocked,
  processPendingFilings,
  EXTRACTOR_VERSION,
  HARD_FAILURE_MARKER,
  UNTAGGED_FAILURE_VERSION,
  withFailedVersion,
  parseFailedVersion,
  parseFailedSha,
  parseUnfinishedCount,
  type AutoPersistDeps,
  type CandidateDocument,
} from '../../../src/services/filing-auto-persist.js';
import { planExtractionFailureSteps } from '../../../src/services/step-ledger-recorders.js';
import type { FilingExtraction, PersistFilingSummary } from '../../../src/services/filing-persister.js';

const V = EXTRACTOR_VERSION;
const NEXT = 'extract_filing.py@next-build';
const now = new Date('2026-09-26T10:00:00Z');
const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
const WAIT_REASON = /waits for a new extractor version or a new document \(#959/;

const SHA = 'b'.repeat(64);
const TAG = `@failed-at:${EXTRACTOR_VERSION}#${'b'.repeat(16)}`;
const IPO = { id: 'ipo-1', companyName: 'Aranda Test Ltd', slug: 'aranda-test-ltd', segment: 'MAINBOARD' };
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
const summary = (): PersistFilingSummary => ({
  written: { promoters: 3 },
  skipped_protected: [],
  skipped_cross_document_disagreement: [],
  skipped_failed_check: [],
  skipped_no_column: [],
  skipped_no_unit: [],
  skipped_unit_mismatch: [],
  ipos_fields: ['issueSize'],
  applied: true,
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
    version: V,
    ...overrides,
  };
}
const stateCalls = (d: AutoPersistDeps) =>
  (d.setDocumentExtractionState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as Record<string, unknown>);

beforeEach(() => {
  recordedSteps.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('#959 gate — the version is the trigger, elapsed time is not', () => {
  it('the version a legacy (untagged) FAILED row is read against is the extractor version current when #959 landed', () => {
    // Pins the assumption: every untagged FAILED row on staging (attempts 2026-09-24..26) failed at this build.
    expect(UNTAGGED_FAILURE_VERSION).toBe('extract_filing.py@2026-09-03');
    expect(EXTRACTOR_VERSION).toBe(UNTAGGED_FAILURE_VERSION);
  });

  it('an ordinary FAILED row stays blocked 30 days later when nothing changed, with the named reason', () => {
    const gate = documentExtractionBlocked(
      { extractionStatus: 'FAILED', extractionError: 'extractor: parse error', retryCount: 1, updatedAt: thirtyDaysAgo },
      V,
      now
    );
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toMatch(WAIT_REASON);
    expect(gate.reason).toContain(`failed at ${V}`);
  });

  it('staging shape: an anchor deterministic refusal (retry 1, untagged) stays blocked; a new extractor version revives it', () => {
    const anchorRefusal =
      'anchor: row "ARANDA INVESTMENTS PTE. LTD." prints 8.55% but the derived share is 8.49% @id:parse_failed:0123456789abcdef';
    const row = { extractionStatus: 'FAILED', extractionError: anchorRefusal, retryCount: 1, updatedAt: thirtyDaysAgo };
    expect(documentExtractionBlocked(row, V, now)).toMatchObject({ blocked: true });
    expect(documentExtractionBlocked(row, NEXT, now)).toEqual({ blocked: false });
  });

  it('staging shape: HARD_FAILURE:4..8 "extractor exited 1" stays blocked with a named reason until the version changes', () => {
    for (const n of [4, 8]) {
      const row = {
        extractionStatus: 'FAILED',
        extractionError: `${HARD_FAILURE_MARKER}:${n}:extractor: extractor exited 1`,
        retryCount: n,
        updatedAt: thirtyDaysAgo,
      };
      const gate = documentExtractionBlocked(row, V, now);
      expect(gate.blocked).toBe(true);
      expect(gate.reason).toMatch(WAIT_REASON);
      expect(gate.reason).toContain(`${n} unfinished attempt(s)`);
      expect(documentExtractionBlocked(row, NEXT, now)).toEqual({ blocked: false });
    }
  });

  it('a FAILED row tagged with the version it failed at: same version blocks, a different one revives', () => {
    const err = withFailedVersion('extractor: parse error', V);
    expect(parseFailedVersion(err)).toBe(V);
    const row = { extractionStatus: 'FAILED', extractionError: err, retryCount: 3, updatedAt: thirtyDaysAgo };
    expect(documentExtractionBlocked(row, V, now).blocked).toBe(true);
    expect(documentExtractionBlocked(row, NEXT, now)).toEqual({ blocked: false });
  });

  it('new bytes on the SAME row (sha refreshed in place) are a new document: revived; the same bytes stay blocked', () => {
    const err = withFailedVersion('extractor: parse error', V, 'c'.repeat(64));
    expect(parseFailedSha(err)).toBe('c'.repeat(16));
    const row = { extractionStatus: 'FAILED', extractionError: err, retryCount: 1, updatedAt: thirtyDaysAgo };
    expect(documentExtractionBlocked({ ...row, sha256: 'c'.repeat(64) }, V, now).blocked).toBe(true);
    expect(documentExtractionBlocked({ ...row, sha256: 'd'.repeat(64) }, V, now)).toEqual({ blocked: false });
  });

  it('a new document (the sha changed on the row) is re-extracted through processPendingFilings', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [
        doc({
          extractionStatus: 'FAILED',
          extractionError: withFailedVersion('extractor: parse error', V, 'c'.repeat(64)),
          retryCount: 1,
          updatedAt: thirtyDaysAgo,
        }),
      ]),
    });
    const r = await processPendingFilings(IPO, d);
    expect(r.spawned).toBe(1);
  });

  it('the version tag survives the 1000-char extraction_error cap', () => {
    const err = withFailedVersion('x'.repeat(5000), V);
    expect(err.length).toBeLessThanOrEqual(1000);
    expect(parseFailedVersion(err)).toBe(V);
  });

  it('ONE unfinished read (killed/OOM once) is resumed at the next pass with NO wait — not a timer', () => {
    const gate = documentExtractionBlocked(
      {
        extractionStatus: 'FAILED',
        extractionError: withFailedVersion(`${HARD_FAILURE_MARKER}:1:extractor: killed`, V),
        retryCount: 1,
        updatedAt: now, // failed this very instant
      },
      V,
      now
    );
    expect(gate).toEqual({ blocked: false });
  });

  it('an IN_PROGRESS row left by a killed run is resumed once with no wait; a second interruption blocks it', () => {
    expect(
      documentExtractionBlocked({ extractionStatus: 'IN_PROGRESS', extractionError: null, retryCount: 1, updatedAt: now }, V, now)
    ).toEqual({ blocked: false });
    const secondInterruption = documentExtractionBlocked(
      {
        extractionStatus: 'IN_PROGRESS',
        extractionError: withFailedVersion('INTERRUPTED:1:the previous run stopped mid-extraction', V),
        retryCount: 2,
        updatedAt: thirtyDaysAgo,
      },
      V,
      now
    );
    expect(secondInterruption.blocked).toBe(true);
    expect(secondInterruption.reason).toMatch(WAIT_REASON);
  });

  it('a FAILED row with retryCount 0 is still blocked (no retryCount loophole back into a loop)', () => {
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'FAILED', extractionError: 'corrigendum_read_failed: boom', retryCount: 0, updatedAt: thirtyDaysAgo },
        V,
        now
      ).blocked
    ).toBe(true);
  });
});

describe('#959 service — processPendingFilings on the real gate', () => {
  it('a FAILED document whose old timer has long elapsed is NOT re-extracted when nothing changed', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [
        doc({ extractionStatus: 'FAILED', extractionError: 'extractor: parse error', retryCount: 1, updatedAt: thirtyDaysAgo }),
      ]),
    });
    const r = await processPendingFilings(IPO, d);
    expect(r.spawned).toBe(0);
    expect(d.runExtractor).not.toHaveBeenCalled();
    expect(stateCalls(d)).toEqual([]);
    expect(r.skipped.some((s) => WAIT_REASON.test(s))).toBe(true);
  });

  it('the same document IS re-extracted when the extractor version differs', async () => {
    const d = deps({
      version: NEXT,
      loadDocuments: vi.fn(async () => [
        doc({ extractionStatus: 'FAILED', extractionError: 'extractor: parse error', retryCount: 1, updatedAt: thirtyDaysAgo }),
      ]),
    });
    const r = await processPendingFilings(IPO, d);
    expect(r.spawned).toBe(1);
    expect(stateCalls(d)[0]).toMatchObject({ status: 'IN_PROGRESS', retryCount: 2 });
  });

  it('an extractor failure writes FAILED tagged with the version, and the E-steps are BLOCKED with the reason, no due time', async () => {
    const d = deps({ runExtractor: vi.fn(() => ({ ok: false as const, error: 'exited 1: parse error' })) });
    await processPendingFilings(IPO, d);
    const failed = stateCalls(d).find((c) => c.status === 'FAILED');
    expect(failed?.error).toBe(`extractor: exited 1: parse error ${TAG}`);
    const eSteps = recordedSteps.flatMap((s) => s.writes).filter((w) => /^E\d+$/.test(String(w.stepId)));
    expect(eSteps).toHaveLength(10);
    for (const w of eSteps) {
      expect(w.status).toBe('BLOCKED');
      expect(w.nextDueAt).toBeNull();
      expect(String(w.error)).toMatch(WAIT_REASON);
    }
  });

  it('a first hard failure is FAILED + resumable: E-steps FAILED with no future due time', async () => {
    const d = deps({ runExtractor: vi.fn(() => ({ ok: false as const, error: 'killed', hardFailure: true })) });
    await processPendingFilings(IPO, d);
    const failed = stateCalls(d).find((c) => c.status === 'FAILED');
    expect(failed?.error).toBe(`${HARD_FAILURE_MARKER}:1:extractor: killed ${TAG}`);
    const eSteps = recordedSteps.flatMap((s) => s.writes).filter((w) => /^E\d+$/.test(String(w.stepId)));
    for (const w of eSteps) {
      expect(w.status).toBe('FAILED');
      expect(w.nextDueAt).toBeNull();
    }
  });

  it('resuming an IN_PROGRESS row stamps INTERRUPTED:1 with the version, so a second kill blocks it', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [doc({ extractionStatus: 'IN_PROGRESS', retryCount: 1, updatedAt: now })]),
    });
    await processPendingFilings(IPO, d);
    const stamp = stateCalls(d)[0];
    expect(stamp.status).toBe('IN_PROGRESS');
    expect(stamp.retryCount).toBe(2);
    expect(parseUnfinishedCount(String(stamp.error))).toBe(1);
    expect(String(stamp.error)).toMatch(/^INTERRUPTED:1:/);
    expect(parseFailedVersion(String(stamp.error))).toBe(V);
    // What the NEXT pass sees if this resume is also killed:
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'IN_PROGRESS', extractionError: String(stamp.error), retryCount: 2, updatedAt: thirtyDaysAgo },
        V,
        now
      ).blocked
    ).toBe(true);
  });

  it('a persist throw is one unfinished read: PERSIST_FAILURE:1 tagged, resumable once, then blocked', async () => {
    const d = deps({ persistFiling: vi.fn(async () => { throw new Error('connection reset'); }) as never });
    await processPendingFilings(IPO, d);
    const failed = stateCalls(d).find((c) => c.status === 'FAILED');
    expect(failed?.error).toBe(`PERSIST_FAILURE:1:persist: connection reset ${TAG}`);
    const row = { extractionStatus: 'FAILED', extractionError: String(failed?.error), retryCount: 1, updatedAt: now };
    expect(documentExtractionBlocked(row, V, now)).toEqual({ blocked: false });

    const d2 = deps({
      persistFiling: vi.fn(async () => { throw new Error('connection reset'); }) as never,
      loadDocuments: vi.fn(async () => [doc({ ...row })]),
    });
    await processPendingFilings(IPO, d2);
    const failed2 = stateCalls(d2).find((c) => c.status === 'FAILED');
    expect(failed2?.error).toBe(`PERSIST_FAILURE:2:persist: connection reset ${TAG}`);
    expect(
      documentExtractionBlocked({ ...row, extractionError: String(failed2?.error), retryCount: 2 }, V, now).blocked
    ).toBe(true);
  });
});

describe('#959 ledger — planExtractionFailureSteps carries no timer', () => {
  it('without a blocked reason: FAILED, nextDueAt null (due at the next pass, not after a wait)', () => {
    const writes = planExtractionFailureSteps('extractor: killed', { docType: 'RHP', version: V });
    expect(writes.every((w) => w.status === 'FAILED' && w.nextDueAt === null)).toBe(true);
  });
  it('with a blocked reason: BLOCKED, the reason appended to the error, nextDueAt null', () => {
    const writes = planExtractionFailureSteps('extractor: parse error', {
      docType: 'RHP',
      version: V,
      blockedReason: 'waits for a new extractor version or a new document (#959)',
    });
    expect(writes.every((w) => w.status === 'BLOCKED' && w.nextDueAt === null)).toBe(true);
    expect(writes[0].error).toBe('extractor: parse error — waits for a new extractor version or a new document (#959)');
  });
});
