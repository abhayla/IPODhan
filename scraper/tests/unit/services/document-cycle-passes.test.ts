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

const processPendingFilingsMock = vi.fn().mockResolvedValue({
  ipoId: 'x',
  considered: 0,
  extracted: 0,
  persisted: 0,
  failed: 0,
  skipped: [],
  spawned: 0,
  skippedBudget: 0,
});
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
function candidateRow(id: string) {
  return {
    id,
    company_name: `Company ${id}`,
    slug: id,
    symbol: null,
    segment: 'MAINBOARD',
    status: 'OPEN',
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
