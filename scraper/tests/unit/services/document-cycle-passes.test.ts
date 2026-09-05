/**
 * W-102 — runDocumentCycle two-pass restructure.
 *
 * Found live 2026-09-03 17:26: `runDocumentCycle` ran auto-persist (python
 * extraction, minutes) INSIDE the per-IPO discovery loop, so extraction time
 * was charged against `CYCLE_BUDGET.DISCOVERY_MS` (60s) — two python runs
 * took 8 minutes and the cycle stopped after ONE IPO ("budget=exhausted").
 * In production that is one IPO's filings extracted per 30-min cron at best.
 *
 * The fix: PASS 1 discovery (unchanged, under DISCOVERY_MS) never calls
 * `processPendingFilings`; PASS 2 extraction — only when the flag is on and
 * the cycle lock was acquired — iterates ALL candidates (not just the ones
 * pass 1 reached) with the ONE shared spawn budget and its own soft cap
 * (`CYCLE_BUDGET.EXTRACTION_MS`), checked BETWEEN IPOs.
 *
 * These tests fail on the pre-fix single-loop code (red), because that code
 * (a) only offers `processPendingFilings` to IPOs pass 1 actually reached
 * (bounded by the 60s discovery budget), and (b) has no extraction-side
 * budget check at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { ipos } from '@ipodhan/shared/db/schema';
import { DocumentRepository, DocumentFetchStateRepository } from '@ipodhan/shared';

// ---------------------------------------------------------------------------
// Mocks — every dependency runDocumentCycle touches, fake-deps style (see
// filing-auto-persist.test.ts / s02-step-ledger-wiring.test.ts for the same
// pattern in this repo).
// ---------------------------------------------------------------------------

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
    listForIpo: vi.fn().mockResolvedValue([]),
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

const runIpoMock = vi.fn().mockImplementation((ipo: { id: string }) => ({
  ipoId: ipo.id,
  companyName: 'Test Co',
  stage: 'PRE_OPEN',
  skipped: false,
  skipReason: '',
  due: [],
  found: [],
  notYetFiled: [],
  notFound: [],
  blocked: [],
  notApplicable: [],
  superseded: [],
  leadManagers: [],
  attempts: [],
  networkCalls: 0,
}));

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

// W-124 round 2: a vi.fn() (not a plain arrow) so individual tests can
// override the stage per DB status — the round-1 tests below all want the
// default fixed 'PRE_OPEN' regardless of status, the round-2 LISTED tests
// need the real status-to-stage mapping to reach the LISTED-only code paths.
const deriveLifecycleStageMock = vi.fn(() => 'PRE_OPEN' as string);
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

const FEATURE_FLAGS: { ENABLE_FILING_AUTO_PERSIST: boolean } = { ENABLE_FILING_AUTO_PERSIST: true };
vi.mock('../../../src/config/feature-flags.js', () => ({ FEATURE_FLAGS }));

vi.mock('../../../src/services/step-ledger.js', () => ({
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDocumentRunSteps: vi.fn().mockResolvedValue(undefined),
}));

// F2: decrement the SHARED spawnBudget when the mock is given one (mirrors
// what the real processPendingFilings does), so a test can observe whether
// the second candidate sees the FIRST candidate's spend or a fresh budget.
const processPendingFilingsMock = vi.fn(
  async (ipo: { id: string }, deps: { spawnBudget?: { remaining: number } } | undefined) => {
    if (deps?.spawnBudget) deps.spawnBudget.remaining -= 1;
    return {
      ipoId: ipo.id,
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
    };
  }
);
const buildAutoPersistDepsMock = vi.fn().mockImplementation(() => ({}));

vi.mock('../../../src/services/filing-auto-persist.js', () => ({
  processPendingFilings: (...args: unknown[]) => processPendingFilingsMock(...args),
  buildAutoPersistDeps: (...args: unknown[]) => buildAutoPersistDepsMock(...args),
  DEFAULT_MAX_SPAWNS_PER_CYCLE: 3,
  // W-168: the anchor allocation report's own per-cycle spawn budget.
  anchorMaxSpawnsPerCycle: () => 1,
  FILING_EXTRACTION_LOCK_TTL_MS: 45 * 60 * 1000,
}));

const lockAcquireMock = vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' });
const lockReleaseMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    acquire: (...args: unknown[]) => lockAcquireMock(...args),
    release: (...args: unknown[]) => lockReleaseMock(...args),
  })),
}));

// loadCandidateIpos hits the DB directly via `db.execute(sql...)`; stub the
// raw rows it expects rather than mocking loadCandidateIpos itself, so the
// real candidate-shaping logic (including the live-window filter) still runs.
function candidateRow(id: string, status = 'OPEN') {
  return {
    id,
    company_name: `Company ${id}`,
    slug: id,
    symbol: null,
    segment: 'MAINBOARD',
    status,
    price_range_min: null,
    price_range_max: null,
    listing_date: null,
    bse_ipo_no: null,
    company_website: null,
    verifier_url: null,
  };
}

const { runDocumentCycle, PURGE_CANDIDATES_SQL } = await import('../../../src/services/document-cycle.js');

beforeEach(() => {
  vi.clearAllMocks();
  FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST = true;
  deriveLifecycleStageMock.mockImplementation(() => 'PRE_OPEN');
  lockAcquireMock.mockResolvedValue({ acquired: true, token: 'tok-1' });
  // Restore the default implementation every test — `clearAllMocks()` clears
  // call history but NOT a `mockImplementation` a previous test installed
  // (e.g. the F2 spawn-budget-observation test below), so tests must not rely
  // on implementation ordering.
  processPendingFilingsMock.mockImplementation(
    async (ipo: { id: string }, deps: { spawnBudget?: { remaining: number } } | undefined) => {
      if (deps?.spawnBudget) deps.spawnBudget.remaining -= 1;
      return {
        ipoId: ipo.id,
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
      };
    }
  );
  runIpoMock.mockImplementation((ipo: { id: string }) => ({
    ipoId: ipo.id,
    companyName: 'Test Co',
    stage: 'PRE_OPEN',
    skipped: false,
    skipReason: '',
    due: [],
    found: [],
    notYetFiled: [],
    notFound: [],
    blocked: [],
    notApplicable: [],
    superseded: [],
    leadManagers: [],
    attempts: [],
    networkCalls: 0,
  }));
  dbExecuteMock.mockResolvedValue({ rows: [candidateRow('ipo-1'), candidateRow('ipo-2')] });
});

describe('W-102 — pass 2 offers EVERY candidate to processPendingFilings, not only what pass 1 reached', () => {
  it('with the flag on and a discovery budget of 0 (pass 1 processes nothing), pass 2 still calls processPendingFilings for BOTH candidates', async () => {
    await runDocumentCycle({ budgetMs: 0, extractionBudgetMs: 999_999 });

    expect(processPendingFilingsMock).toHaveBeenCalledTimes(2);
    const idsOffered = processPendingFilingsMock.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(idsOffered).toEqual(['ipo-1', 'ipo-2']);
  });

  it('flag off — processPendingFilings is never called (regression guard)', async () => {
    FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST = false;
    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    expect(processPendingFilingsMock).not.toHaveBeenCalled();
    expect(lockAcquireMock).not.toHaveBeenCalled();
  });
});

describe('W-102 — the spawn budget object is the SAME instance across both candidates', () => {
  it('reuses one AutoPersistDeps (and its spawnBudget) for every candidate in pass 2', async () => {
    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    expect(buildAutoPersistDepsMock).toHaveBeenCalledTimes(1);
    expect(processPendingFilingsMock).toHaveBeenCalledTimes(2);
    const deps1 = processPendingFilingsMock.mock.calls[0][1];
    const deps2 = processPendingFilingsMock.mock.calls[1][1];
    expect(deps1).toBe(deps2);
  });

  // F2 (S-02 round 6): identity alone doesn't prove the budget is SPENT
  // across candidates — a fresh `{remaining: N}` object could be assigned to
  // the same `deps.spawnBudget` property every iteration and `deps1 === deps2`
  // would still hold. Assert the actual counter value the second candidate
  // observes is the FIRST candidate's spend, not a reset one.
  it('the second candidate observes the budget the FIRST candidate already spent (3 then 2), not a fresh one', async () => {
    const observedRemaining: number[] = [];
    processPendingFilingsMock.mockImplementation(
      async (ipo: { id: string }, deps: { spawnBudget?: { remaining: number } } | undefined) => {
        observedRemaining.push(deps?.spawnBudget?.remaining as number);
        if (deps?.spawnBudget) deps.spawnBudget.remaining -= 1;
        return {
          ipoId: ipo.id,
          considered: 0,
          extracted: 0,
          persisted: 0,
          failed: 0,
          skipped: [],
          spawned: 1,
          skippedBudget: 0,
          anchorsConsidered: 0,
          anchorsSpawned: 0,
          anchorsPersisted: 0,
          anchorsManualReview: 0,
          anchorsFailed: 0,
        };
      }
    );

    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    // DEFAULT_MAX_SPAWNS_PER_CYCLE is mocked to 3 (line above) — the SAME
    // value real production uses today.
    expect(observedRemaining).toEqual([3, 2]);
  });
});

describe('F1 — the cycle lock NOT being acquired skips extraction but never discovery', () => {
  it('lock unavailable: processPendingFilings and lock.release are never called; discovery still runs for every candidate', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: false });

    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    expect(processPendingFilingsMock).not.toHaveBeenCalled();
    expect(lockReleaseMock).not.toHaveBeenCalled();
    // Discovery (pass 1) is independent of the extraction lock — both
    // candidates still get a discovery pass.
    expect(runIpoMock).toHaveBeenCalledTimes(2);
  });
});

describe('W-102 — pass 2 stops BETWEEN IPOs once EXTRACTION_MS is exceeded', () => {
  it('processes the first candidate, then stops before the second once the clock says the extraction budget is spent', async () => {
    // Call sequence inside runDocumentCycle once `now` is threaded through:
    //   1: startedAt
    //   2: discovery-loop check (candidate 1)
    //   3: discovery-loop check (candidate 2)
    //   4: extractionStartedAt
    //   5: extraction-loop check (candidate 1) -> 0ms elapsed, proceed
    //   6: extraction-loop check (candidate 2) -> budget exceeded, stop
    //   7+: duration calc for the summary (repeats last value)
    const values = [0, 0, 0, 1_000, 1_000, 1_100, 1_100];
    let i = 0;
    const now = vi.fn(() => (i < values.length ? values[i++] : values[values.length - 1]));

    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 50, now });

    expect(processPendingFilingsMock).toHaveBeenCalledTimes(1);
    expect((processPendingFilingsMock.mock.calls[0][0] as { id: string }).id).toBe('ipo-1');
  });
});

/**
 * W-101 — runDocumentPurge's SQL used `upper(i.status)`, but `ipos.status` is
 * the `ipo_status` ENUM, not text: Postgres 42883 ("function upper(ipo_status)
 * does not exist") failed the purge on EVERY run. Fix: `upper(i.status::text)`.
 * Same pattern as `stage-reconciler-job.test.ts` (W-100) — every `i.<column>`
 * reference must be a real `ipos` column, checked without a live database.
 */
describe('F4 — extraction_blocked/extraction_failed tally covers pass 2, over every candidate', () => {
  it('a document that PASS 2 pushed into MANUAL_REVIEW is counted in THIS cycle summary', async () => {
    // ipo-2 is only reached because the tally now runs AFTER pass 2, over
    // every candidate — not from the snapshot pass 1 took before pass 2 had
    // written anything.
    vi.mocked(DocumentRepository).mockImplementationOnce(
      () =>
        ({
          findByIPO: vi.fn((ipoId: string) =>
            Promise.resolve(ipoId === 'ipo-2' ? [{ extractionStatus: 'MANUAL_REVIEW' }] : [])
          ),
        }) as never
    );

    const summary = await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    expect(summary.extractionBlocked).toBe(1);
  });
});

describe('W-124 — one purge (WITHDRAWN/POSTPONED) slot is reserved regardless of the discovery budget', () => {
  it('with budgetMs=0 (the live backlog would normally get zero slots), the WITHDRAWN candidate is still processed', async () => {
    dbExecuteMock.mockResolvedValue({
      rows: [candidateRow('ipo-1', 'OPEN'), candidateRow('ipo-2', 'OPEN'), candidateRow('withdrawn-1', 'WITHDRAWN')],
    });

    await runDocumentCycle({ budgetMs: 0, extractionBudgetMs: 999_999 });

    const idsProcessed = runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(idsProcessed).toContain('withdrawn-1');
    expect(idsProcessed).toHaveLength(1);
  });

  it('with no purge candidate present, budgetMs=0 processes nobody (no reservation to make)', async () => {
    dbExecuteMock.mockResolvedValue({
      rows: [candidateRow('ipo-1', 'OPEN'), candidateRow('ipo-2', 'OPEN')],
    });

    await runDocumentCycle({ budgetMs: 0, extractionBudgetMs: 999_999 });

    expect(runIpoMock).not.toHaveBeenCalled();
  });

  it('a purge candidate reached BEFORE the budget trips is processed normally, with no double-processing', async () => {
    dbExecuteMock.mockResolvedValue({
      rows: [candidateRow('withdrawn-1', 'WITHDRAWN'), candidateRow('ipo-1', 'OPEN')],
    });

    await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    const idsProcessed = runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(idsProcessed.filter((id) => id === 'withdrawn-1')).toHaveLength(1);
    expect(idsProcessed).toContain('ipo-1');
  });
});

/**
 * W-124 round 2 (Tier A review findings) — MAJOR-1 and MAJOR-2.
 *
 * MAJOR-1: a complete LISTED row (`alreadyComplete === true`) must not enter
 * `candidates` at all, so it costs zero DB round trips in PASS 1
 * (`runIpo`/`processCandidate`), PASS 2 (`processPendingFilings`), or the F4
 * extraction tally (`documents.findByIPO`) — only counted in the summary.
 *
 * MAJOR-2: `enrichListedCandidates` is bounded to `listedCap * 4` LISTED
 * rows — the sequential N+1 (`store.listForIpo` per LISTED row) must never
 * scan the whole LISTED backlog before the discovery budget clock starts.
 */
/** N days ago as a `YYYY-MM-DD` string — must stay inside the 10-day live window (`isInLiveWindow`). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

describe('W-124 round 2 — MAJOR-1: a complete LISTED row is excluded from every pass', () => {
  function listedRow(id: string, listingDate: string) {
    return { ...candidateRow(id, 'LISTED'), listing_date: listingDate };
  }

  // Every doc type `dueDocTypesForStage('LISTED')` accumulates, already
  // closed (FOUND — extraction is not enabled in this cycle, so FOUND is a
  // closed state) or already NOT_APPLICABLE for the two types LISTED retires
  // permanently (CORRIGENDUM/ADDENDUM) — this is what makes `planIpoCycle`
  // return `skipIpo: true` for this row.
  const COMPLETE_STATE_ROWS = [
    { id: 'r1', docType: 'DRHP', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r2', docType: 'RHP', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r3', docType: 'PRICE_BAND_AD', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r4', docType: 'RATIOS_BASIS_ISSUE_PRICE', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r5', docType: 'ANCHOR_ALLOCATION_REPORT', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r6', docType: 'CORRIGENDUM', state: 'NOT_APPLICABLE', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r7', docType: 'PROSPECTUS', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r8', docType: 'BASIS_OF_ALLOTMENT_AD', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r9', docType: 'ADDENDUM', state: 'NOT_APPLICABLE', lastAttemptAt: new Date('2026-08-01') },
  ];

  it('the complete LISTED row never reaches runIpo, processPendingFilings, or the F4 tally', async () => {
    deriveLifecycleStageMock.mockImplementation((args: unknown) => (args as { status: string }).status);
    dbExecuteMock.mockResolvedValue({
      rows: [listedRow('listed-complete', daysAgo(1)), candidateRow('ipo-1', 'OPEN')],
    });
    vi.mocked(DocumentFetchStateRepository).mockImplementation(
      () =>
        ({
          listForIpo: vi.fn((ipoId: string) =>
            Promise.resolve(ipoId === 'listed-complete' ? COMPLETE_STATE_ROWS : [])
          ),
          update: vi.fn().mockResolvedValue(undefined),
        }) as never
    );
    const findByIpoMock = vi.fn().mockResolvedValue([]);
    vi.mocked(DocumentRepository).mockImplementation(() => ({ findByIPO: findByIpoMock }) as never);

    const summary = await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

    const runIpoIds = runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id);
    const persistIds = processPendingFilingsMock.mock.calls.map((c) => (c[0] as { id: string }).id);
    const tallyIds = findByIpoMock.mock.calls.map((c) => c[0]);

    expect(runIpoIds).not.toContain('listed-complete');
    expect(persistIds).not.toContain('listed-complete');
    expect(tallyIds).not.toContain('listed-complete');
    expect(runIpoIds).toContain('ipo-1');
    expect(summary.listedComplete).toBe(1);
  });
});

describe('W-124 round 2 — MAJOR-2: LISTED enrichment is bounded to listedCap * 4', () => {
  it('only enriches the first listedCap * 4 LISTED rows — store.listForIpo is called at most that many times for LISTED stage', async () => {
    deriveLifecycleStageMock.mockImplementation((args: unknown) => (args as { status: string }).status);
    process.env.DOCUMENT_CYCLE_LISTED_CAP = '1'; // bound = 1 * 4 = 4
    try {
      const listedRows = Array.from({ length: 10 }, (_, i) =>
        ({ ...candidateRow(`listed-${i}`, 'LISTED'), listing_date: daysAgo(i) })
      );
      dbExecuteMock.mockResolvedValue({ rows: listedRows });

      const listForIpoMock = vi.fn().mockResolvedValue([]);
      vi.mocked(DocumentFetchStateRepository).mockImplementation(
        () => ({ listForIpo: listForIpoMock, update: vi.fn().mockResolvedValue(undefined) }) as never
      );

      await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

      // Bounded to listedCap * 4 = 4 DISTINCT LISTED ipos enriched, never all
      // 10 — the cap admits at most 1 of those 4 into PASS 1, which re-fetches
      // `listForIpo` once more for that single winner (a separate call this
      // test does not care about); what matters is the enrichment loop itself
      // never touched more than 4 distinct LISTED ipoIds.
      const distinctIpoIds = new Set(listForIpoMock.mock.calls.map((c) => c[0]));
      expect(distinctIpoIds.size).toBeLessThanOrEqual(4);
      expect(listForIpoMock.mock.calls.length).toBeLessThanOrEqual(5);
    } finally {
      delete process.env.DOCUMENT_CYCLE_LISTED_CAP;
    }
  });
});

describe('W-101 — PURGE_CANDIDATES_SQL', () => {
  it('casts status to text before upper() — no bare upper(i.status)', () => {
    expect(PURGE_CANDIDATES_SQL).toContain('i.status::text');
    expect(PURGE_CANDIDATES_SQL).not.toMatch(/upper\(i\.status\)/);
  });

  it('references only columns that exist on the ipos pgTable', () => {
    const referenced = [...new Set([...PURGE_CANDIDATES_SQL.matchAll(/\bi\.([a-zA-Z_]+)\b/g)].map((m) => m[1]))];
    expect(referenced.length).toBeGreaterThanOrEqual(3);

    const columns = getTableColumns(ipos);
    const validColumnNames = new Set(Object.values(columns).map((c: any) => c.name));

    const invalid = referenced.filter((name) => !validColumnNames.has(name));
    expect(invalid).toEqual([]);
  });
});

/**
 * W-135 — `enrichListedCandidates` must bound `maxToEnrich` to INCOMPLETE
 * LISTED rows only. Found on the 2026-09-04 staging soak: the newest LISTED
 * rows fill the bound every cycle even after they become complete, so older
 * LISTED rows past them are never enriched, never offered a cap slot, and
 * never get their documents fetched — permanent starvation until they leave
 * the live window (staging: `listedCap 2, listedEnriched 8, listedComplete
 * 0, listedSkippedUnenriched 9`, cycle after cycle).
 */
describe('W-135 — enrichListedCandidates counts only incomplete rows toward the enrichment bound', () => {
  const COMPLETE_STATE_ROWS = [
    { id: 'r1', docType: 'DRHP', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r2', docType: 'RHP', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r3', docType: 'PRICE_BAND_AD', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r4', docType: 'RATIOS_BASIS_ISSUE_PRICE', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r5', docType: 'ANCHOR_ALLOCATION_REPORT', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r6', docType: 'CORRIGENDUM', state: 'NOT_APPLICABLE', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r7', docType: 'PROSPECTUS', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r8', docType: 'BASIS_OF_ALLOTMENT_AD', state: 'FOUND', lastAttemptAt: new Date('2026-08-01') },
    { id: 'r9', docType: 'ADDENDUM', state: 'NOT_APPLICABLE', lastAttemptAt: new Date('2026-08-01') },
  ];

  it('17 LISTED rows, the newest 8 already complete, listedCap 2 -> the 9th/10th (oldest incomplete among the first 10) win the cap slots; listedComplete=8, listedSkippedUnenriched=0', async () => {
    deriveLifecycleStageMock.mockImplementation((args: unknown) => (args as { status: string }).status);
    process.env.DOCUMENT_CYCLE_LISTED_CAP = '2'; // bound = 2 * 4 = 8 INCOMPLETE rows
    try {
      // Newest-first (listing_date desc, matching the SQL order): indices
      // 0-7 are complete, 8-16 are incomplete.
      const listedRows = Array.from({ length: 17 }, (_, i) => ({
        ...candidateRow(`listed-${i}`, 'LISTED'),
        listing_date: daysAgo(i),
      }));
      dbExecuteMock.mockResolvedValue({ rows: listedRows });

      vi.mocked(DocumentFetchStateRepository).mockImplementation(
        () =>
          ({
            listForIpo: vi.fn((ipoId: string) => {
              const idx = Number(ipoId.replace('listed-', ''));
              return Promise.resolve(idx < 8 ? COMPLETE_STATE_ROWS : []);
            }),
            update: vi.fn().mockResolvedValue(undefined),
          }) as never
      );
      const findByIpoMock = vi.fn().mockResolvedValue([]);
      vi.mocked(DocumentRepository).mockImplementation(() => ({ findByIPO: findByIpoMock }) as never);

      const summary = await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

      const runIpoIds = runIpoMock.mock.calls.map((c) => (c[0] as { id: string }).id);
      // The two cap slots must go to the oldest INCOMPLETE rows reached
      // (listed-8, listed-9), not be starved by the 8 complete rows ahead
      // of them filling the old (wrong) bound.
      expect(runIpoIds).toContain('listed-8');
      expect(runIpoIds).toContain('listed-9');
      expect(summary.listedComplete).toBe(8);
      expect(summary.listedSkippedUnenriched).toBe(0);
    } finally {
      delete process.env.DOCUMENT_CYCLE_LISTED_CAP;
    }
  });

  it('a visit ceiling still bounds the N+1 even when every LISTED row is complete — rows past the ceiling are listedSkippedUnenriched', async () => {
    deriveLifecycleStageMock.mockImplementation((args: unknown) => (args as { status: string }).status);
    process.env.DOCUMENT_CYCLE_LISTED_CAP = '2';
    try {
      const totalRows = 250; // > LISTED_ENRICH_VISIT_CEILING (200)
      // All within the 10-day live window (unlike the ordering tests above) —
      // this test is about the visit ceiling, not the live-window filter, so
      // every row must actually reach `enrichListedCandidates` as a candidate.
      const listedRows = Array.from({ length: totalRows }, (_, i) => ({
        ...candidateRow(`listed-${i}`, 'LISTED'),
        listing_date: daysAgo(1),
      }));
      dbExecuteMock.mockResolvedValue({ rows: listedRows });

      const listForIpoMock = vi.fn().mockResolvedValue(COMPLETE_STATE_ROWS); // every row complete
      vi.mocked(DocumentFetchStateRepository).mockImplementation(
        () => ({ listForIpo: listForIpoMock, update: vi.fn().mockResolvedValue(undefined) }) as never
      );
      vi.mocked(DocumentRepository).mockImplementation(() => ({ findByIPO: vi.fn().mockResolvedValue([]) }) as never);

      const summary = await runDocumentCycle({ budgetMs: 999_999, extractionBudgetMs: 999_999 });

      const distinctIpoIds = new Set(listForIpoMock.mock.calls.map((c) => c[0]));
      expect(distinctIpoIds.size).toBeLessThanOrEqual(200);
      expect(summary.listedSkippedUnenriched).toBeGreaterThan(0);
    } finally {
      delete process.env.DOCUMENT_CYCLE_LISTED_CAP;
    }
  });
});
