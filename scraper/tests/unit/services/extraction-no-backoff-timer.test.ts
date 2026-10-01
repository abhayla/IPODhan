import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #959 — a failed extraction is re-read on a new extractor version or a new document, never on a timer.
 *
 * Spec basis: data-sourcing-pull-model.md §2 "One download, one read (OD-33)" ("A document is read once,
 * on arrival, and again only when (a) a newer document type arrives for that IPO, (b) the extractor
 * version changes ... There is no interval, no backoff timer"), §5.3 rule 5 ("Never on a backoff timer"),
 * OD-21 ("no timed retry"), §2.2 (a walk killed mid-extraction must be resumable — an OOM kill, a deploy
 * or a crash), OD-55 (a document is read to completion), OD-32 (the FILE is kept a week from the last
 * SUCCESSFUL read so it can be re-read if earlier reads failed; never-successful files to the 30-day cap).
 * Round 3 (built on the independent review of 2026-09-27): an unfinished read is re-read at the next
 * data-job slot and bounded by a COUNT per (extractor version, file sha256); no clock is read.
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
  markHardFailure,
  UNFINISHED_READS_EXHAUSTED_REASON,
  UNFINISHED_READ_CAPS,
  type AutoPersistDeps,
  type CandidateDocument,
} from '../../../src/services/filing-auto-persist.js';
import { planExtractionFailureSteps } from '../../../src/services/step-ledger-recorders.js';
import type { FilingExtraction, PersistFilingSummary } from '../../../src/services/filing-persister.js';

const V = EXTRACTOR_VERSION;
const NEXT = 'extract_filing.py@next-build';
const now = new Date('2026-09-26T10:00:00Z');
const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
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

describe('#959 gate — the version and bytes are the triggers, elapsed time is not', () => {
  it('an untagged (pre-#959) STRUCTURAL row is read against the pinned build it failed at; a newer build revives it once', () => {
    expect(UNTAGGED_FAILURE_VERSION).toBe('extract_filing.py@2026-09-03');
    const row = { extractionStatus: 'FAILED', extractionError: 'extractor: parse error', retryCount: 1, updatedAt: thirtyDaysAgo };
    expect(documentExtractionBlocked(row, UNTAGGED_FAILURE_VERSION).blocked).toBe(true);
    expect(documentExtractionBlocked(row, NEXT)).toEqual({ blocked: false });
  });

  it('a tagged structural FAILED row stays blocked 30 days later when nothing changed, with the named reason', () => {
    const gate = documentExtractionBlocked(
      { extractionStatus: 'FAILED', extractionError: withFailedVersion('extractor: parse error', V), retryCount: 1, updatedAt: thirtyDaysAgo },
      V
    );
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toMatch(WAIT_REASON);
    expect(gate.reason).toContain(`failed at ${V}`);
  });

  it('a FAILED row tagged with the version it failed at: same version blocks, a different one revives', () => {
    const err = withFailedVersion('extractor: parse error', V);
    expect(parseFailedVersion(err)).toBe(V);
    const row = { extractionStatus: 'FAILED', extractionError: err, retryCount: 3, updatedAt: thirtyDaysAgo };
    expect(documentExtractionBlocked(row, V).blocked).toBe(true);
    expect(documentExtractionBlocked(row, NEXT)).toEqual({ blocked: false });
  });

  it('new bytes on the SAME row (sha refreshed in place) are a new document: revived; the same bytes stay blocked', () => {
    const err = withFailedVersion('extractor: parse error', V, 'c'.repeat(64));
    expect(parseFailedSha(err)).toBe('c'.repeat(16));
    const row = { extractionStatus: 'FAILED', extractionError: err, retryCount: 1, updatedAt: thirtyDaysAgo };
    expect(documentExtractionBlocked({ ...row, sha256: 'c'.repeat(64) }, V).blocked).toBe(true);
    expect(documentExtractionBlocked({ ...row, sha256: 'd'.repeat(64) }, V)).toEqual({ blocked: false });
  });

  it('a new document (the sha changed on the row) is re-extracted through processPendingFilings', async () => {
    const d = deps({
      loadDocuments: vi.fn(async () => [
        doc({ extractionStatus: 'FAILED', extractionError: withFailedVersion('extractor: parse error', V, 'c'.repeat(64)), retryCount: 1 }),
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

  it('the gate reads no clock: the same row gives the same answer whatever updatedAt says', () => {
    const err = withFailedVersion(`${HARD_FAILURE_MARKER}:1@0:extractor: killed`, V, SHA);
    for (const updatedAt of [null, now, thirtyDaysAgo]) {
      expect(documentExtractionBlocked({ extractionStatus: 'FAILED', extractionError: err, retryCount: 1, updatedAt, sha256: SHA }, V)).toEqual({
        blocked: false,
      });
    }
    expect(documentExtractionBlocked.length).toBe(2);
  });

  it('caps per cause: killed/memory 2, pages unread 2, IN_PROGRESS unknown cause 3, save failure 3', () => {
    expect(UNFINISHED_READ_CAPS).toEqual({ HARD_FAILURE: 2, INCOMPLETE_PAGES: 2, INTERRUPTED: 3, PERSIST_FAILURE: 3, REREAD_CLEAR_FAILED: 3 });
  });

  it('the count is carried across causes at the same version+bytes and RESETS at a new version or new bytes', () => {
    const prev = withFailedVersion(`INTERRUPTED:1@5:the previous run stopped`, V, SHA);
    expect(markHardFailure(prev, 'x', V, SHA, now)).toBe(`${HARD_FAILURE_MARKER}:2@5:x`);
    expect(markHardFailure(prev, 'x', NEXT, SHA, now)).toBe(`${HARD_FAILURE_MARKER}:1@${now.getTime()}:x`);
    expect(markHardFailure(prev, 'x', V, 'e'.repeat(64), now)).toBe(`${HARD_FAILURE_MARKER}:1@${now.getTime()}:x`);
  });

  it('legacy staging rows HARD_FAILURE:4..8 (untagged, no count cap ever applied) are parked with 0 reads; a new version revives them', () => {
    for (const n of [4, 8]) {
      const row = { extractionStatus: 'FAILED', extractionError: `${HARD_FAILURE_MARKER}:${n}:extractor: extractor exited 1`, retryCount: n, updatedAt: twoDaysAgo };
      const gate = documentExtractionBlocked(row, V);
      expect(gate).toMatchObject({ blocked: true, park: true, unfinished: { count: n, cause: HARD_FAILURE_MARKER, cap: 2 } });
      expect(gate.reason).toContain(UNFINISHED_READS_EXHAUSTED_REASON);
      expect(documentExtractionBlocked({ ...row, extractionError: withFailedVersion(row.extractionError, V) }, NEXT)).toEqual({ blocked: false });
    }
  });

  it('legacy rows through processPendingFilings: parked FAILED UNFINISHED_EXHAUSTED, BLOCKED ledger, 0 spawns; next pass writes nothing', async () => {
    const legacy = doc({ extractionStatus: 'FAILED', extractionError: `${HARD_FAILURE_MARKER}:6:extractor: extractor exited 1`, retryCount: 6 });
    const d = deps({ loadDocuments: vi.fn(async () => [legacy]) });
    const r = await processPendingFilings(IPO, d);
    expect(r.spawned).toBe(0);
    expect(d.runExtractor).not.toHaveBeenCalled();
    const [park] = stateCalls(d);
    expect(park.status).toBe('FAILED');
    expect(String(park.error)).toMatch(/^UNFINISHED_EXHAUSTED: 6\/2 HARD_FAILURE: HARD_FAILURE:6:extractor: extractor exited 1 @failed-at:/);
    const eSteps = recordedSteps.flatMap((s) => s.writes).filter((w) => /^E\d+$/.test(String(w.stepId)));
    expect(eSteps.length).toBeGreaterThan(0);
    for (const w of eSteps) expect(w.status).toBe('BLOCKED');
    const d2 = deps({ loadDocuments: vi.fn(async () => [doc({ extractionStatus: 'FAILED', extractionError: String(park.error), retryCount: 6 })]) });
    const r2 = await processPendingFilings(IPO, d2);
    expect(r2.spawned).toBe(0);
    expect(stateCalls(d2)).toEqual([]);
    expect(r2.skipped.some((s) => WAIT_REASON.test(s))).toBe(true);
  });
});

/**
 * #959 round 3 — the class table. Every way an extraction ends unfinished, driven pass by pass through
 * the real `processPendingFilings` + gate, with the row's state carried between passes exactly as the
 * database would carry it. `reads` counts extractor spawns. Each ending must reach its cap and then
 * spend 0 more reads; box busy must never be counted.
 *
 * Red on main (2026-09-27, 05e1e182): the IN_PROGRESS row is resumed every pass forever (no count).
 * Red on the round-2 head (136731739): every killed/pages/save ending is re-read every pass inside a
 * 7-day window, so it passes its cap.
 */
type Row = { extractionStatus: string; extractionError: string | null; retryCount: number };
type Ending = {
  name: string;
  cap: number | null;
  /** How this ending leaves the row, given the state calls one pass made. */
  killedMidRead?: boolean;
  overrides: Partial<AutoPersistDeps>;
};
const KILLED = { ok: false as const, error: 'extractor exited null (signal SIGKILL): ', hardFailure: true };
const MEMORY = { ok: false as const, error: 'extractor exited 3: memory ceiling', hardFailure: true };
const HANG = { ok: false as const, error: 'spawn failed: spawnSync nice ETIMEDOUT', hardFailure: true, transientKind: 'spawn_timeout' };
const ENDINGS: Ending[] = [
  { name: 'killed / OOM (signal)', cap: 2, overrides: { runExtractor: vi.fn(() => KILLED) as never } },
  { name: 'memory ceiling (exit 3)', cap: 2, overrides: { runExtractor: vi.fn(() => MEMORY) as never } },
  { name: '2h hang limit (ETIMEDOUT)', cap: 2, overrides: { runExtractor: vi.fn(() => HANG) as never } },
  {
    name: 'hang limit with pages unread',
    cap: 2,
    overrides: {
      runExtractor: vi.fn(() => ({
        ok: true as const,
        extraction: { ...extraction(), unread_pages: [{ page: 412, reason: 'ceiling_reached' }] } as never,
      })) as never,
    },
  },
  {
    name: 'save failure (persist threw)',
    cap: 3,
    overrides: { persistFiling: vi.fn(async () => { throw new Error('connection reset'); }) as never },
  },
  { name: 'process kill leaving IN_PROGRESS (deploy restart / box OOM / crash)', cap: 3, killedMidRead: true, overrides: {} },
  {
    name: 'box busy (exit 75)',
    cap: null,
    overrides: { runExtractor: vi.fn(() => ({ ok: false as const, error: 'busy', busy: true })) as never },
  },
];

async function drive(ending: Ending, passes: number, start: Row) {
  let row: Row = { ...start };
  let reads = 0;
  const history: Row[] = [];
  for (let i = 0; i < passes; i++) {
    const runExtractor = (ending.overrides.runExtractor as ReturnType<typeof vi.fn> | undefined) ?? vi.fn(() => ({ ok: true as const, extraction: extraction() }));
    runExtractor.mockClear?.();
    const d = deps({ ...ending.overrides, runExtractor: runExtractor as never, loadDocuments: vi.fn(async () => [doc({ ...row })]) });
    await processPendingFilings(IPO, d);
    const spawnedNow = runExtractor.mock.calls.length;
    reads += spawnedNow;
    const calls = stateCalls(d);
    // A killed read dies right after its IN_PROGRESS stamp: only that write reaches the database.
    const applied = ending.killedMidRead && spawnedNow > 0 ? calls.slice(0, 1) : calls;
    for (const c of applied) {
      row = {
        extractionStatus: String(c.status ?? row.extractionStatus),
        extractionError: 'error' in c ? ((c.error as string | null) ?? null) : row.extractionError,
        retryCount: typeof c.retryCount === 'number' ? c.retryCount : row.retryCount,
      };
    }
    history.push({ ...row });
  }
  return { row, reads, history };
}

describe('#959 round 3 — every unfinished ending: next action, then parked at its COUNT cap', () => {
  for (const ending of ENDINGS) {
    it(`${ending.name}: ${ending.cap === null ? 'never counted, never parked' : `${ending.cap} reads, then parked with 0 more`}`, async () => {
      const start: Row = ending.killedMidRead
        ? { extractionStatus: 'IN_PROGRESS', extractionError: null, retryCount: 1 } // the first kill already happened
        : { extractionStatus: 'PENDING', extractionError: null, retryCount: 0 };
      const { row, reads, history } = await drive(ending, 8, start);
      if (ending.cap === null) {
        expect(reads).toBe(8);
        expect(row.extractionStatus).toBe('PENDING');
        expect(row.extractionError ?? '').not.toMatch(/UNFINISHED/);
        return;
      }
      // An IN_PROGRESS start already spent one read (the one that was killed): cap - 1 more.
      const expectedReads = ending.killedMidRead ? ending.cap - 1 : ending.cap;
      expect(reads).toBe(expectedReads);
      expect(row.extractionStatus).toBe('FAILED');
      expect(row.extractionError).toMatch(new RegExp(`^UNFINISHED_EXHAUSTED: ${ending.cap}/${ending.cap} `));
      expect(parseFailedVersion(row.extractionError)).toBe(V);
      // Once parked the row is never written again (no repeated park writes).
      const parkedAt = history.findIndex((h) => /^UNFINISHED_EXHAUSTED/.test(h.extractionError ?? ''));
      for (const h of history.slice(parkedAt)) expect(h).toEqual(history[parkedAt]);
      // A new extractor version readmits it with the count restarted.
      expect(
        documentExtractionBlocked({ extractionStatus: row.extractionStatus, extractionError: row.extractionError, retryCount: row.retryCount, updatedAt: null, sha256: SHA }, NEXT)
      ).toEqual({ blocked: false });
    });
  }

  it('IN_PROGRESS interruptions are counted on the resume stamp: INTERRUPTED:1, INTERRUPTED:2, then parked', async () => {
    const ending = ENDINGS.find((e) => e.killedMidRead)!;
    const { history } = await drive(ending, 3, { extractionStatus: 'IN_PROGRESS', extractionError: null, retryCount: 1 });
    expect(history[0].extractionError).toMatch(/^INTERRUPTED:1@\d+:/);
    expect(history[1].extractionError).toMatch(/^INTERRUPTED:2@\d+:/);
    expect(history[2].extractionStatus).toBe('FAILED');
    expect(history[2].extractionError).toMatch(/^UNFINISHED_EXHAUSTED: 3\/3 INTERRUPTED: INTERRUPTED:2@\d+:/);
  });

  it('a deploy restart is innocent: one interruption then a clean read completes, never parked', async () => {
    const { row, reads } = await drive({ name: 'restart then ok', cap: null, overrides: {} }, 1, {
      extractionStatus: 'IN_PROGRESS',
      extractionError: null,
      retryCount: 1,
    });
    expect(reads).toBe(1);
    expect(row.extractionStatus).toBe('COMPLETED');
  });

  it('the parked write carries the count/cause log line and BLOCKED E-steps (signal-ownership R6)', async () => {
    const { row } = await drive(ENDINGS[0], 1, { extractionStatus: 'PENDING', extractionError: null, retryCount: 0 });
    recordedSteps.length = 0;
    const d = deps({ runExtractor: vi.fn(() => KILLED) as never, loadDocuments: vi.fn(async () => [doc({ ...row })]) });
    await processPendingFilings(IPO, d);
    const eSteps = recordedSteps.flatMap((s) => s.writes).filter((w) => /^E\d+$/.test(String(w.stepId)));
    expect(eSteps.length).toBeGreaterThan(0);
    for (const w of eSteps) {
      expect(w.status).toBe('BLOCKED');
      expect(String(w.error)).toContain(UNFINISHED_READS_EXHAUSTED_REASON);
    }
  });
});

/**
 * #959 round 3 item 5 — the anchor door, interrupted repeatedly. M13 (the review's mutation: the anchor
 * stamp stops recording the interruption, i.e. `resumeError` dropped on the anchor path) must turn this red.
 */
describe('#959 anchor — double interrupt then park, spawning nothing', () => {
  const ANCHOR_SHA = 'a'.repeat(64);
  const anchorRow = (o: Partial<CandidateDocument>) =>
    doc({ id: 'anchor-1', type: 'ANCHOR_ALLOCATION_REPORT', sha256: ANCHOR_SHA, ...o });
  const anchorDeps = (row: CandidateDocument) =>
    deps({
      loadDocuments: vi.fn(async () => [row]),
      loadStates: vi.fn(async () => [
        { id: 'state-a', docType: 'ANCHOR_ALLOCATION_REPORT', documentId: 'anchor-1', extractedAt: null, extractorVersion: null },
      ]) as never,
      runAnchorPersist: vi.fn(async () => ({ kind: 'persisted' as const, reason: null, summary: {} as never })),
    });

  it('1st interrupted pass writes INTERRUPTED:1, the 2nd INTERRUPTED:2, the 3rd parks it (H3 BLOCKED) and spawns nothing', async () => {
    let row = anchorRow({ extractionStatus: 'IN_PROGRESS', extractionError: null, retryCount: 1 });
    const stamps: string[] = [];
    for (let pass = 1; pass <= 2; pass++) {
      const d = anchorDeps(row);
      await processPendingFilings(IPO, d);
      expect(d.runAnchorPersist).toHaveBeenCalledTimes(1);
      const stamp = stateCalls(d)[0];
      expect(stamp.status).toBe('IN_PROGRESS');
      stamps.push(String(stamp.error));
      // killed right after the stamp: only the stamp lands
      row = anchorRow({ extractionStatus: 'IN_PROGRESS', extractionError: String(stamp.error), retryCount: Number(stamp.retryCount) });
    }
    expect(stamps[0]).toMatch(/^INTERRUPTED:1@\d+:/);
    expect(stamps[1]).toMatch(/^INTERRUPTED:2@\d+:/);

    const { recordLiveStep } = await import('../../../src/services/step-ledger-recorders.js');
    (recordLiveStep as ReturnType<typeof vi.fn>).mockClear();
    const d3 = anchorDeps(row);
    const r3 = await processPendingFilings(IPO, d3);
    expect(d3.runAnchorPersist).not.toHaveBeenCalled();
    expect(r3.spawned).toBe(0);
    const [park] = stateCalls(d3);
    expect(park.status).toBe('FAILED');
    expect(String(park.error)).toMatch(/^UNFINISHED_EXHAUSTED: 3\/3 INTERRUPTED: /);
    expect(recordLiveStep).toHaveBeenCalledWith('ipo-1', 'H3', expect.objectContaining({ status: 'BLOCKED' }));
  });
});

describe('#959 service — failure writes carry the version tag, no due time', () => {
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
