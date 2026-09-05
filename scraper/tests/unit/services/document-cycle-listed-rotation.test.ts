/**
 * W-144 — prove LISTED-tier rotation across MANY cycles at unit level.
 *
 * Everything the codebase currently has for this claim
 * (`document-cycle-listed-order.test.ts`, the W-124/W-135 tests in
 * `document-cycle-passes.test.ts`) exercises `orderAndCapCandidates` and
 * `enrichListedCandidates` for ONE OR TWO cycles with hand-fed
 * `lastActivityAt` values. The rotation CLAIM ("every LISTED row eventually
 * gets a turn instead of the newest listings permanently starving the older
 * ones" — see `orderAndCapCandidates`'s doc comment, W-124) has only ever
 * been proven live on staging over 2 real cron cycles. This file drives the
 * REAL `runDocumentCycle` repeatedly against a persistent in-memory fake
 * store (the same `DocumentFetchStateRepository` seam production code reads
 * and writes through `enrichListedCandidates`/`toStateRow`), so the
 * many-cycle rotation guarantee is proven, not assumed.
 *
 * Fake-deps pattern copied from `document-cycle-passes.test.ts` (same
 * `vi.mock` boilerplate — `runDocumentCycle` hits `db.execute` and the two
 * shared repositories directly, so those are the seams to fake).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbExecuteMock = vi.fn();
const dbInsertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

/** Spy wrapping `fakeStoreListForIpo` so a test can observe the ORDER `enrichListedCandidates` visits ipos in (W-153). */
const listForIpoSpy = vi.fn((ipoId: string) => Promise.resolve(fakeStoreListForIpo(ipoId)));

vi.mock('@ipodhan/shared', () => ({
  db: {
    execute: (...args: unknown[]) => dbExecuteMock(...args),
    insert: (...args: unknown[]) => dbInsertMock(...args),
  },
  getRedisClient: () => ({}),
  DocumentRepository: vi.fn().mockImplementation(() => ({
    findByIPO: vi.fn().mockResolvedValue([]),
  })),
  DocumentFetchStateRepository: vi.fn().mockImplementation(() => ({
    listForIpo: (...args: unknown[]) => listForIpoSpy(...(args as [string])),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  IPORepository: vi.fn().mockImplementation(() => ({})),
  IpoPipelineStepsRepository: vi.fn().mockImplementation(() => ({
    findByIpo: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../src/services/data-persister.js', () => ({
  recordBseDiscoveryMetadata: vi.fn().mockResolvedValue(undefined),
  recordDocumentSourceHints: vi.fn().mockResolvedValue(undefined),
}));

// runIpoMock is where a real cycle would make network calls and then persist
// the attempt back to document_fetch_state (bumping last_attempt_at). This
// fake writes straight into the same in-memory store `listForIpo` reads, so
// the NEXT call to `runDocumentCycle` sees a persisted rotation timestamp —
// exactly the "cycle state persisted through the fake store" the brief asks
// for, without needing a real DB.
const runIpoMock = vi.fn((ipo: { id: string }) => {
  visitLog.push(ipo.id);
  bumpAttempt(ipo.id);
  return {
    ipoId: ipo.id,
    companyName: 'Test Co',
    stage: 'LISTED',
    skipped: false,
    skipReason: '',
    due: ['RHP'],
    found: [],
    notYetFiled: [],
    notFound: [],
    blocked: [],
    notApplicable: [],
    superseded: [],
    leadManagers: [],
    attempts: [],
    networkCalls: 1,
  };
});

vi.mock('../../../src/services/document-discovery-runner.js', () => ({
  DocumentDiscoveryRunner: vi.fn().mockImplementation(() => ({
    runIpo: (...args: unknown[]) => runIpoMock(...args),
  })),
  defaultFetcher: {},
  toStateRow: (r: unknown) => r,
}));

vi.mock('../../../src/utils/network-counter.js', () => ({
  NetworkCounter: vi.fn().mockImplementation(() => ({ byHost: () => ({}) })),
}));

vi.mock('../../../src/services/company-host-source.js', () => ({
  isVerifierUrl: () => false,
}));

const deriveLifecycleStageMock = vi.fn((args: unknown) => (args as { status: string }).status);
vi.mock('../../../src/scheduler/stage-reconciler.js', () => ({
  deriveLifecycleStage: (...args: unknown[]) => deriveLifecycleStageMock(...args),
}));

vi.mock('../../../src/services/document-store.js', () => ({
  hasStoredFile: () => true,
  getStoreDir: () => '.',
  decidePurge: vi.fn(),
  purgeIpoDocuments: vi.fn(),
  getRetentionDays: () => 7,
  getMaxRetentionDays: () => 30,
}));

const FEATURE_FLAGS: { ENABLE_FILING_AUTO_PERSIST: boolean } = { ENABLE_FILING_AUTO_PERSIST: false };
vi.mock('../../../src/config/feature-flags.js', () => ({ FEATURE_FLAGS }));

vi.mock('../../../src/services/step-ledger.js', () => ({
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDocumentRunSteps: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/filing-auto-persist.js', () => ({
  processPendingFilings: vi.fn().mockResolvedValue({
    ipoId: 'n/a',
    considered: 0,
    extracted: 0,
    persisted: 0,
    failed: 0,
    skipped: [],
    spawned: 0,
    skippedBudget: 0,
    anchorsConsidered: 0,
    anchorsSpawned: 0,
    anchorsPersisted: 0,
    anchorsManualReview: 0,
    anchorsFailed: 0,
  }),
  buildAutoPersistDeps: vi.fn().mockImplementation(() => ({})),
  DEFAULT_MAX_SPAWNS_PER_CYCLE: 3,
  // W-168: read unconditionally by runDocumentCycle (same as
  // DEFAULT_MAX_SPAWNS_PER_CYCLE above), regardless of the flag value.
  anchorMaxSpawnsPerCycle: () => 1,
}));
vi.mock('../../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    acquire: vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' }),
    release: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// The fake persistent store — one RHP row per IPO, keyed by ipo id. This is
// the fake of `document_fetch_state` that `enrichListedCandidates` reads
// (via `listForIpo`) to compute `lastActivityAt`, and that `runIpo` (faked
// above) writes back to (`bumpAttempt`) — the same round trip production
// code makes, minus the network and the real Postgres row.
// ---------------------------------------------------------------------------
type FakeRow = { docType: string; state: string; attempts: number; nextRetryAt: Date | null; lastAttemptAt: Date | null };
let fakeClock = 0;
let visitLog: string[] = [];
let store: Map<string, FakeRow[]> = new Map();

function fakeStoreListForIpo(ipoId: string) {
  const rows = store.get(ipoId) ?? [];
  return rows.map((row, i) => ({
    id: `${ipoId}-${i}`,
    docType: row.docType,
    state: row.state,
    attempts: row.attempts,
    nextRetryAt: row.nextRetryAt,
    blockedSinceAt: null,
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: row.lastAttemptAt,
  }));
}

/** Simulates the runner persisting an attempt on every open row: state never resolves, attempt count and last_attempt_at bump. */
function bumpAttempt(ipoId: string) {
  const rows = store.get(ipoId);
  if (!rows) return;
  fakeClock += 1;
  const now = new Date(fakeClock * 60_000);
  for (const row of rows) {
    row.attempts += 1;
    row.lastAttemptAt = now;
  }
}

/** A LISTED row with one still-pending RHP row (its "one PENDING RHP") — every other due doc type is simply missing (also counts as due, per `planIpoCycle`'s `missingRows` path), so the IPO stays incomplete indefinitely. */
function seedListedIpo(id: string) {
  store.set(id, [{ docType: 'RHP', state: 'WANTED', attempts: 0, nextRetryAt: null, lastAttemptAt: null }]);
}

/** Every doc type `dueDocTypesForStage('LISTED')` accumulates, closed (FOUND) or NOT_APPLICABLE — mirrors `COMPLETE_STATE_ROWS` in document-cycle-passes.test.ts so `planIpoCycle` actually returns `skipIpo: true`. */
function seedCompleteListedIpo(id: string) {
  const found = (docType: string): FakeRow => ({ docType, state: 'FOUND', attempts: 1, nextRetryAt: null, lastAttemptAt: new Date('2026-08-01') });
  const notApplicable = (docType: string): FakeRow => ({ docType, state: 'NOT_APPLICABLE', attempts: 1, nextRetryAt: null, lastAttemptAt: new Date('2026-08-01') });
  store.set(id, [
    found('DRHP'),
    found('RHP'),
    found('PRICE_BAND_AD'),
    found('RATIOS_BASIS_ISSUE_PRICE'),
    found('ANCHOR_ALLOCATION_REPORT'),
    notApplicable('CORRIGENDUM'),
    found('PROSPECTUS'),
    found('BASIS_OF_ALLOTMENT_AD'),
    notApplicable('ADDENDUM'),
  ]);
}

/** `daysAgo` matching document-cycle-passes.test.ts — stays inside the 10-day live window (`isInLiveWindow`). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Explicit listing-date rank so ids don't need to be parseable (`listed-N`) — 0 = most recent, matching the real SQL's listing_date DESC order. */
const listingRank = new Map<string, number>();
function candidateRow(id: string) {
  if (!listingRank.has(id)) listingRank.set(id, listingRank.size);
  return {
    id,
    company_name: `Company ${id}`,
    slug: id,
    symbol: null,
    segment: 'MAINBOARD',
    status: 'LISTED',
    price_range_min: null,
    price_range_max: null,
    // Fixed, small offset regardless of N — `isInLiveWindow` only keeps
    // LISTED rows within LIVE_WINDOW_DAYS_AFTER_LISTING (10) days, and a
    // large-N rotation test (e.g. 25 ids) must not accidentally push older
    // ranks outside that window. `listingRank` still breaks id-order ties
    // deterministically via `sqlOrderedIds`; the real listing_date-desc
    // tie-break inside `orderAndCapCandidates` falls back to `id` when dates
    // are equal (see its comparator), so a shared date is still deterministic.
    listing_date: daysAgo(1),
    bse_ipo_no: null,
    company_website: null,
    verifier_url: null,
  };
}

const { runDocumentCycle } = await import('../../../src/services/document-cycle.js');

beforeEach(() => {
  vi.clearAllMocks();
  runIpoMock.mockClear();
  listForIpoSpy.mockImplementation((ipoId: string) => Promise.resolve(fakeStoreListForIpo(ipoId)));
  fakeClock = 0;
  visitLog = [];
  store = new Map();
  listingRank.clear();
  FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST = false;
  delete process.env.DOCUMENT_CYCLE_LISTED_CAP;
});

/** Max `lastAttemptAt` across an ipo's persisted rows, or `null` if never attempted — the same aggregate `CANDIDATE_IPOS_SQL`'s LEFT JOIN computes in Postgres. */
function currentActivityMs(id: string): number | null {
  const rows = store.get(id);
  if (!rows || rows.length === 0) return null;
  let max: number | null = null;
  for (const r of rows) {
    if (r.lastAttemptAt) {
      const t = r.lastAttemptAt.getTime();
      if (max === null || t > max) max = t;
    }
  }
  return max;
}

/**
 * W-153: simulates `CANDIDATE_IPOS_SQL`'s LISTED ordering — last_activity ASC
 * NULLS FIRST, listing_date DESC as tie-break only. `db.execute` is fully
 * mocked in these tests (no real Postgres), so this is what stands in for
 * the JOIN's output order every cycle; the code under test
 * (`enrichListedCandidates`'s bounded scan, `orderAndCapCandidates`) is
 * unchanged and is what actually gets exercised against it.
 */
function sqlOrderedIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ta = currentActivityMs(a);
    const tb = currentActivityMs(b);
    if (ta === null && tb === null) return listingRank.get(a)! - listingRank.get(b)!;
    if (ta === null) return -1;
    if (tb === null) return 1;
    if (ta !== tb) return ta - tb;
    return listingRank.get(a)! - listingRank.get(b)!;
  });
}

async function runCycles(n: number, ids: string[]): Promise<void> {
  ids.forEach((id) => candidateRow(id)); // registers each id's listingRank before any sort needs it
  for (let i = 0; i < n; i++) {
    dbExecuteMock.mockResolvedValueOnce({ rows: sqlOrderedIds(ids).map((id) => candidateRow(id)) });
    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });
  }
}

describe('W-144 — LISTED rotation is bounded and fair within the enrichment window', () => {
  it('N=6 (within listedCap*4=8), cap=2: every IPO is visited at least once within ceil(N/cap)+slack cycles', async () => {
    const N = 6;
    const cap = 2;
    process.env.DOCUMENT_CYCLE_LISTED_CAP = String(cap);
    const ids = Array.from({ length: N }, (_, i) => `listed-${i}`);
    ids.forEach((id) => seedListedIpo(id));

    const boundedCycles = Math.ceil(N / cap) + 2; // +2 slack
    await runCycles(boundedCycles, ids);

    const visited = new Set(visitLog);
    expect(visited.size).toBe(N); // every IPO visited at least once
  });

  it('N=6, cap=2: no IPO is visited a 2nd time before every IPO has been visited once (fairness)', async () => {
    const N = 6;
    const cap = 2;
    process.env.DOCUMENT_CYCLE_LISTED_CAP = String(cap);
    const ids = Array.from({ length: N }, (_, i) => `listed-${i}`);
    ids.forEach((id) => seedListedIpo(id));

    await runCycles(Math.ceil(N / cap), ids); // exactly enough cycles for one full rotation, no slack

    // First N visits (one full rotation) must be N DISTINCT ids — a repeat
    // inside that window means someone was visited twice while another IPO
    // was still waiting for its first turn.
    const firstRotation = visitLog.slice(0, N);
    expect(new Set(firstRotation).size).toBe(N);
  });

  it('a complete LISTED row drops out (listedComplete) and never consumes a cap slot again', async () => {
    const cap = 1;
    process.env.DOCUMENT_CYCLE_LISTED_CAP = String(cap);
    seedCompleteListedIpo('listed-0'); // already complete: due=[] for every doc type
    seedListedIpo('listed-1', 'WANTED');
    const ids = ['listed-0', 'listed-1'];

    dbExecuteMock.mockResolvedValueOnce({ rows: ids.map((id) => candidateRow(id)) });
    const summary1 = await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    // listed-0 is complete -> never enters candidates -> never offered to runIpo.
    expect(runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id)).not.toContain('listed-0');
    expect(runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id)).toContain('listed-1');
    expect(summary1.listedComplete).toBe(1);
    expect(summary1.listedDeferred).toBe(0); // cap=1 covers the single incomplete row

    // A second cycle: listed-1 was just processed, listed-0 is still complete —
    // counters must sum consistently (complete + deferred + visited == total LISTED seen).
    runIpoMock.mockClear();
    dbExecuteMock.mockResolvedValueOnce({ rows: ids.map((id) => candidateRow(id)) });
    const summary2 = await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });
    expect(summary2.listedComplete).toBe(1);
    expect(summary2.listedEnriched).toBeGreaterThanOrEqual(summary2.listedComplete);
  });

  it('an IPO whose fetch keeps failing does not block rotation — the least-recently-touched comparator protects its neighbour regardless', async () => {
    const cap = 1;
    process.env.DOCUMENT_CYCLE_LISTED_CAP = String(cap);
    seedListedIpo('failing-ipo', 'WANTED');
    seedListedIpo('healthy-ipo', 'WANTED');
    const ids = ['failing-ipo', 'healthy-ipo'];

    // Cycle 1: failing-ipo sorts first (both never-touched, tie-break by
    // listing_date desc -> 'failing-ipo' id 0 is most recent), consumes the
    // single cap slot, "fails" and its store row is put into backoff
    // (nextRetryAt in the far future) instead of being retried immediately.
    dbExecuteMock.mockResolvedValueOnce({ rows: ids.map((id) => candidateRow(id)) });
    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });
    expect(runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['failing-ipo']);

    const rows = store.get('failing-ipo')!;
    for (const row of rows) row.nextRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // backed off a full day

    // Cycle 2: failing-ipo is now in backoff (skipIpo=true -> alreadyComplete)
    // so it costs zero cap slots; the healthy IPO gets the cap slot instead of
    // being starved behind a permanently-retrying neighbour.
    runIpoMock.mockClear();
    dbExecuteMock.mockResolvedValueOnce({ rows: ids.map((id) => candidateRow(id)) });
    const summary = await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });
    const visitedCycle2 = runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(visitedCycle2).toEqual(['healthy-ipo']);
    expect(visitedCycle2).not.toContain('failing-ipo');
    // failing-ipo still has other due doc types missing (never resolved by
    // this fake, same as production until every type is accounted for), so
    // it stays incomplete rather than `listedComplete` — but the rotation
    // comparator (lastActivityAt ascending) is what actually protects
    // healthy-ipo here: failing-ipo's real timestamp from cycle 1 sinks it
    // behind the never-touched healthy-ipo regardless of backoff.
    expect(summary.listedDeferred).toBe(1); // failing-ipo: incomplete, still due, but loses the single cap slot to the fairer candidate
  });
});

/**
 * W-153 fix: `enrichListedCandidates` still bounds how many LISTED rows it
 * looks at to `listedCap * 4` INCOMPLETE rows (W-135, UNCHANGED) — but which
 * rows arrive in that scan window is no longer the fixed SQL row order
 * (`listing_date DESC`). `CANDIDATE_IPOS_SQL` now orders the LISTED tier by
 * `last_activity ASC NULLS FIRST` (a LEFT JOIN aggregate over
 * `document_fetch_state`), `listing_date DESC` only breaking ties — so the
 * scan window always contains the GLOBALLY least-recently-touched rows, not
 * whichever rows happen to have the newest listing date. Before the fix
 * (see the W-144 test this replaces), 25 permanently-incomplete rows with
 * cap 2 (bound 8) meant rows 8..24 were silently dropped every cycle,
 * forever. `sqlOrderedIds` (this file) simulates the JOIN's output order
 * cycle to cycle — `db.execute` is fully mocked, so it is the SQL-ordering
 * assumption under test; `enrichListedCandidates`/`orderAndCapCandidates`
 * are exercised unmodified against it.
 */
describe('W-153 — rotation-aware scan order removes the backlog-starvation defect', () => {
  it('N=25, cap=2 (enrichment bound=8), all rows permanently incomplete: every IPO is visited within ceil(N/cap)+slack cycles', async () => {
    const N = 25;
    const cap = 2;
    process.env.DOCUMENT_CYCLE_LISTED_CAP = String(cap);
    const ids = Array.from({ length: N }, (_, i) => `listed-${i}`);
    ids.forEach((id) => seedListedIpo(id));

    const boundedCycles = Math.ceil(N / cap) + 5; // generous slack
    await runCycles(boundedCycles, ids);

    const visited = new Set(visitLog);
    expect(visited.size).toBe(N); // no row is left behind, however large the backlog
  });

  it('a row with a NULL last activity is scanned before any touched row, regardless of listing_date', async () => {
    const cap = 5; // large enough that both rows fit the enrichment bound and the cap
    process.env.DOCUMENT_CYCLE_LISTED_CAP = String(cap);
    seedListedIpo('touched');
    seedListedIpo('never-touched');
    candidateRow('touched'); // registers listingRank -> lower rank (more recent listing_date)
    candidateRow('never-touched');
    const touchedRow = store.get('touched')!;
    touchedRow[0].lastAttemptAt = new Date('2020-01-01'); // touched long ago, but touched

    const scanOrder: string[] = [];
    listForIpoSpy.mockImplementation((ipoId: string) => {
      scanOrder.push(ipoId);
      return Promise.resolve(fakeStoreListForIpo(ipoId));
    });

    dbExecuteMock.mockResolvedValueOnce({
      rows: sqlOrderedIds(['touched', 'never-touched']).map((id) => candidateRow(id)),
    });
    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    // never-touched (NULL last_activity) must be the FIRST row enrichListedCandidates
    // reads via store.listForIpo, ahead of touched — even though touched has
    // an OLDER listing_date (would have won the pre-W-153 listing_date-desc order).
    expect(scanOrder[0]).toBe('never-touched');
  });
});

describe('W-153 — CANDIDATE_IPOS_SQL text', () => {
  it('joins document_fetch_state and orders the LISTED tier by last_activity ASC NULLS FIRST before listing_date', async () => {
    const { CANDIDATE_IPOS_SQL } = await import('../../../src/services/document-cycle.js');
    expect(CANDIDATE_IPOS_SQL).toContain('document_fetch_state');
    expect(CANDIDATE_IPOS_SQL).toMatch(/last_activity\s+END\s+ASC\s+NULLS\s+FIRST/);
    // last_activity must be ordered BEFORE listing_date (tie-break only).
    const activityIdx = CANDIDATE_IPOS_SQL.indexOf('last_activity END ASC');
    const listingIdx = CANDIDATE_IPOS_SQL.indexOf("i.listing_date END DESC");
    expect(activityIdx).toBeGreaterThan(-1);
    expect(listingIdx).toBeGreaterThan(activityIdx);
  });
});
