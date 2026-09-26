import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #959 — a failed extraction is re-read on a new extractor version or a new document, never on a timer.
 *
 * Spec basis: data-sourcing-pull-model.md §2 "One download, one read (OD-33)" ("A document is read once,
 * on arrival, and again only when (a) a newer document type arrives for that IPO, (b) the extractor
 * version changes ... There is no interval, no backoff timer"), §5.3 rule 5 ("Never on a backoff timer"),
 * OD-21 ("no timed retry"), §2.2 (a walk killed mid-extraction must be resumable — an OOM kill, a deploy
 * or a crash), OD-55 (a document is read to completion), OD-32 (the file is kept a week "so that we re-read it if
 * previous reads were not successful" — round 1: unfinished reads are re-read each pass inside that window).
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
  parseUnfinishedSince,
  markHardFailure,
  UNFINISHED_READS_EXHAUSTED_REASON,
  type AutoPersistDeps,
  type CandidateDocument,
} from '../../../src/services/filing-auto-persist.js';
import { planExtractionFailureSteps } from '../../../src/services/step-ledger-recorders.js';
import type { FilingExtraction, PersistFilingSummary } from '../../../src/services/filing-persister.js';

const V = EXTRACTOR_VERSION;
const NEXT = 'extract_filing.py@next-build';
const now = new Date('2026-09-26T10:00:00Z');
const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
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

  it('staging shape: legacy HARD_FAILURE:4..8 (memory abort, no window start) — re-read inside the OD-32 window from its last write, parked after it', () => {
    for (const n of [4, 8]) {
      const err = `${HARD_FAILURE_MARKER}:${n}:extractor: extractor exited 1`;
      const recent = { extractionStatus: 'FAILED', extractionError: err, retryCount: n, updatedAt: twoDaysAgo };
      expect(documentExtractionBlocked(recent, V, now, 7)).toEqual({ blocked: false });
      const old = { ...recent, updatedAt: thirtyDaysAgo };
      const gate = documentExtractionBlocked(old, V, now, 7);
      expect(gate).toMatchObject({ blocked: true, park: true });
      expect(gate.reason).toContain(UNFINISHED_READS_EXHAUSTED_REASON);
      expect(documentExtractionBlocked(old, NEXT, now, 7)).toEqual({ blocked: false });
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

  it('an IN_PROGRESS row is resumed at every pass inside the OD-32 window (no second-interruption block), parked after it', () => {
    expect(
      documentExtractionBlocked({ extractionStatus: 'IN_PROGRESS', extractionError: null, retryCount: 1, updatedAt: now }, V, now, 7)
    ).toEqual({ blocked: false });
    const interruptedTwice = (since: Date) =>
      withFailedVersion(`INTERRUPTED:2@${since.getTime()}:the previous run stopped mid-extraction`, V, SHA);
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'IN_PROGRESS', extractionError: interruptedTwice(twoDaysAgo), retryCount: 3, updatedAt: now, sha256: SHA },
        V,
        now,
        7
      )
    ).toEqual({ blocked: false });
    const gate = documentExtractionBlocked(
      { extractionStatus: 'IN_PROGRESS', extractionError: interruptedTwice(eightDaysAgo), retryCount: 3, updatedAt: now, sha256: SHA },
      V,
      now,
      7
    );
    expect(gate).toMatchObject({ blocked: true, park: true });
    expect(gate.reason).toContain(UNFINISHED_READS_EXHAUSTED_REASON);
  });

  it('the window is anchored on the FIRST unfinished attempt: a later attempt keeps the original start', () => {
    const first = markHardFailure(null, 'extractor: killed', V, SHA, eightDaysAgo);
    expect(parseUnfinishedSince(first)).toBe(eightDaysAgo.getTime());
    const second = markHardFailure(withFailedVersion(first, V, SHA), 'extractor: killed again', V, SHA, now);
    expect(second).toBe(`${HARD_FAILURE_MARKER}:2@${eightDaysAgo.getTime()}:extractor: killed again`);
  });

  it('M5: the count and window start RESET at a new extractor version, and at new bytes', () => {
    const prev = withFailedVersion(`${HARD_FAILURE_MARKER}:3@${eightDaysAgo.getTime()}:extractor: killed`, V, SHA);
    expect(markHardFailure(prev, 'x', NEXT, SHA, now)).toBe(`${HARD_FAILURE_MARKER}:1@${now.getTime()}:x`);
    expect(markHardFailure(prev, 'x', V, 'e'.repeat(64), now)).toBe(`${HARD_FAILURE_MARKER}:1@${now.getTime()}:x`);
    expect(markHardFailure(prev, 'x', V, SHA, now)).toBe(`${HARD_FAILURE_MARKER}:4@${eightDaysAgo.getTime()}:x`);
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
    expect(String(failed?.error)).toMatch(new RegExp(`^${HARD_FAILURE_MARKER}:1@\\d+:extractor: killed ${TAG}$`));
    const eSteps = recordedSteps.flatMap((s) => s.writes).filter((w) => /^E\d+$/.test(String(w.stepId)));
    for (const w of eSteps) {
      expect(w.status).toBe('FAILED');
      expect(w.nextDueAt).toBeNull();
    }
  });

  it('double interrupt end to end: resumed each pass inside the window, then parked FAILED + BLOCKED ledger + visible to the check', async () => {
    // Pass 1: a row left IN_PROGRESS by a killed run is resumed; the stamp records INTERRUPTED:1 with its window start.
    const d1 = deps({
      loadDocuments: vi.fn(async () => [doc({ extractionStatus: 'IN_PROGRESS', retryCount: 1, updatedAt: new Date() })]),
      runExtractor: vi.fn(() => ({ ok: true as const, extraction: extraction() })),
    });
    // The resumed run is killed too: simulate by reading only the IN_PROGRESS stamp it wrote.
    await processPendingFilings(IPO, d1);
    const stamp1 = stateCalls(d1)[0];
    expect(stamp1.status).toBe('IN_PROGRESS');
    expect(String(stamp1.error)).toMatch(/^INTERRUPTED:1@\d+:/);

    // Pass 2 (killed again, still inside the window): resumed again — no second-interruption block.
    const d2 = deps({
      loadDocuments: vi.fn(async () => [
        doc({ extractionStatus: 'IN_PROGRESS', extractionError: String(stamp1.error), retryCount: 2, updatedAt: new Date() }),
      ]),
    });
    const r2 = await processPendingFilings(IPO, d2);
    expect(r2.spawned).toBe(1);
    const stamp2 = stateCalls(d2)[0];
    expect(String(stamp2.error)).toMatch(/^INTERRUPTED:2@\d+:/);
    expect(parseUnfinishedSince(String(stamp2.error))).toBe(parseUnfinishedSince(String(stamp1.error)));

    // Pass 3: the same row, still IN_PROGRESS, its first interruption 8 days back — past the OD-32 window.
    const since8 = String(stamp2.error).replace(/^INTERRUPTED:2@\d+:/, `INTERRUPTED:2@${Date.now() - 8 * 24 * 60 * 60_000}:`);
    const d3 = deps({
      loadDocuments: vi.fn(async () => [
        doc({ extractionStatus: 'IN_PROGRESS', extractionError: since8, retryCount: 3, updatedAt: new Date() }),
      ]),
    });
    recordedSteps.length = 0;
    const r3 = await processPendingFilings(IPO, d3);
    expect(r3.spawned).toBe(0);
    expect(d3.runExtractor).not.toHaveBeenCalled();
    const parked = stateCalls(d3);
    expect(parked).toHaveLength(1);
    expect(parked[0].status).toBe('FAILED');
    expect(String(parked[0].error)).toMatch(/^UNFINISHED_EXHAUSTED: INTERRUPTED:2@\d+:/);
    expect(parseFailedVersion(String(parked[0].error))).toBe(V);
    const eSteps = recordedSteps.flatMap((s) => s.writes).filter((w) => /^E\d+$/.test(String(w.stepId)));
    expect(eSteps).toHaveLength(10);
    for (const w of eSteps) {
      expect(w.status).toBe('BLOCKED');
      expect(w.nextDueAt).toBeNull();
      expect(String(w.error)).toContain(UNFINISHED_READS_EXHAUSTED_REASON);
    }
    // Pass 4: the parked row is structural now — blocked, NOT parked again (no repeated writes).
    const d4 = deps({
      loadDocuments: vi.fn(async () => [
        doc({ extractionStatus: 'FAILED', extractionError: String(parked[0].error), retryCount: 3, updatedAt: new Date() }),
      ]),
    });
    const r4 = await processPendingFilings(IPO, d4);
    expect(r4.spawned).toBe(0);
    expect(stateCalls(d4)).toEqual([]);
    expect(r4.skipped.some((s) => WAIT_REASON.test(s))).toBe(true);
  });

  it('M11: pages left unread are an UNFINISHED read — INCOMPLETE_PAGES marker, re-read at the next pass', async () => {
    const d = deps({
      runExtractor: vi.fn(() => ({
        ok: true as const,
        extraction: { ...extraction(), unread_pages: [{ page: 7, reason: 'timeout' }] } as never,
      })),
    });
    await processPendingFilings(IPO, d);
    const failed = stateCalls(d).find((c) => c.status === 'FAILED');
    expect(String(failed?.error)).toMatch(/^INCOMPLETE_PAGES:1@\d+:1 page\(s\) never read \[7\] \(timeout\)/);
    expect(parseUnfinishedCount(String(failed?.error))).toBe(1);
    expect(
      documentExtractionBlocked(
        { extractionStatus: 'FAILED', extractionError: String(failed?.error), retryCount: 1, updatedAt: new Date(), sha256: SHA },
        V
      )
    ).toEqual({ blocked: false });
  });

  it('a persist throw is an unfinished read: PERSIST_FAILURE tagged, re-read again at the next pass inside the window', async () => {
    const d = deps({ persistFiling: vi.fn(async () => { throw new Error('connection reset'); }) as never });
    await processPendingFilings(IPO, d);
    const failed = stateCalls(d).find((c) => c.status === 'FAILED');
    expect(String(failed?.error)).toMatch(new RegExp(`^PERSIST_FAILURE:1@\\d+:persist: connection reset ${TAG}$`));
    const row = { extractionStatus: 'FAILED', extractionError: String(failed?.error), retryCount: 1, updatedAt: new Date() };
    const d2 = deps({
      persistFiling: vi.fn(async () => { throw new Error('connection reset'); }) as never,
      loadDocuments: vi.fn(async () => [doc({ ...row })]),
    });
    const r2 = await processPendingFilings(IPO, d2);
    expect(r2.spawned).toBe(1);
    const failed2 = stateCalls(d2).find((c) => c.status === 'FAILED');
    expect(String(failed2?.error)).toMatch(/^PERSIST_FAILURE:2@\d+:/);
    expect(documentExtractionBlocked({ ...row, extractionError: String(failed2?.error), retryCount: 2 }, V).blocked).toBe(false);
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
