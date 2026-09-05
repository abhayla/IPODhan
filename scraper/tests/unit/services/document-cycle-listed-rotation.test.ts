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
    listForIpo: (ipoId: string) => Promise.resolve(fakeStoreListForIpo(ipoId)),
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
  }),
  buildAutoPersistDeps: vi.fn().mockImplementation(() => ({})),
  DEFAULT_MAX_SPAWNS_PER_CYCLE: 3,
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
    listing_date: daysAgo(listingRank.get(id)!),
    bse_ipo_no: null,
    company_website: null,
    verifier_url: null,
  };
}

const { runDocumentCycle } = await import('../../../src/services/document-cycle.js');

beforeEach(() => {
  vi.clearAllMocks();
  runIpoMock.mockClear();
  fakeClock = 0;
  visitLog = [];
  store = new Map();
  listingRank.clear();
  FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST = false;
  delete process.env.DOCUMENT_CYCLE_LISTED_CAP;
});

async function runCycles(n: number, ids: string[]): Promise<void> {
  for (let i = 0; i < n; i++) {
    dbExecuteMock.mockResolvedValueOnce({ rows: ids.map((id) => candidateRow(id)) });
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
 * W-144 DEFECT: `enrichListedCandidates` bounds how many LISTED rows it even
 * LOOKS AT to `listedCap * 4` INCOMPLETE rows (W-135), scanned in the fixed
 * SQL row order (`listing_date DESC`) — NOT in rotation order. When more than
 * `listedCap * 4` LISTED rows are simultaneously, persistently incomplete
 * (the realistic "these are all still WANTED because nothing has been filed
 * yet" case this test builds — 25 rows, cap 2 -> bound 8), the SAME first-8
 * rows (by listing_date desc) are re-scanned every cycle: none of them ever
 * resolves to complete (real code, not a test artifact — see `bumpAttempt`,
 * which deliberately never flips state to FOUND), so `incompleteSeen` always
 * hits the bound at row 8 and rows 8..24 are NEVER enriched, NEVER given a
 * `lastActivityAt`, and therefore NEVER even considered for the cap. They are
 * not "deferred" (which the code full well tracks) — they are silently
 * dropped every single cycle as `listedSkippedUnenriched`, forever, for as
 * long as they stay in the live window. This is the residual case the W-135
 * fix (only complete rows exit the bound) does not cover: it fixes staleness
 * cleared by completion, not a backlog that never completes.
 *
 * `it.fails` — this documents a REAL, currently-unfixed starvation bug. It is
 * expected to fail (i.e. `it.fails` itself passes) until W-144 lands a fix
 * (e.g. scanning LISTED rows in rotation order before applying the
 * enrichment bound, or persisting a rotation cursor). If this ever starts
 * passing, `it.fails` will FAIL and must be converted to a normal `it`.
 */
describe('W-144 DEFECT — backlog larger than listedCap*4 starves rows past the enrichment scan window', () => {
  it.fails(
    'N=25, cap=2 (enrichment bound=8), all rows permanently incomplete: every IPO is visited within ceil(N/cap)+slack cycles',
    async () => {
      const N = 25;
      const cap = 2;
      process.env.DOCUMENT_CYCLE_LISTED_CAP = String(cap);
      const ids = Array.from({ length: N }, (_, i) => `listed-${i}`);
      ids.forEach((id) => seedListedIpo(id));

      const boundedCycles = Math.ceil(N / cap) + 5; // generous slack
      await runCycles(boundedCycles, ids);

      const visited = new Set(visitLog);
      // EXPECTED (per the rotation guarantee): visited.size === N.
      // ACTUAL: only the first listedCap*4 = 8 rows (by listing_date desc)
      // are ever enriched/visited; rows 8..24 are permanently starved.
      expect(visited.size).toBe(N);
    }
  );
});
