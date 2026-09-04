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
import { DocumentRepository } from '@ipodhan/shared';

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

vi.mock('../../../src/scheduler/stage-reconciler.js', () => ({
  deriveLifecycleStage: () => 'PRE_OPEN',
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
    };
  }
);
const buildAutoPersistDepsMock = vi.fn().mockImplementation(() => ({}));

vi.mock('../../../src/services/filing-auto-persist.js', () => ({
  processPendingFilings: (...args: unknown[]) => processPendingFilingsMock(...args),
  buildAutoPersistDeps: (...args: unknown[]) => buildAutoPersistDepsMock(...args),
  DEFAULT_MAX_SPAWNS_PER_CYCLE: 3,
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
