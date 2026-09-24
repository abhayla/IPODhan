import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipoStatusEnumMock } from '../helpers/schema-mock.js';

/**
 * Item 7 S4 (spec docs/design/data-sourcing-pull-model.md section 2.1 job
 * table row "Opening-day check", OD-31): the discovery-only check, its own
 * `--job=opening` process under the SAME heavy lock the data/closed jobs
 * take (scraper:cycle).
 *
 * §2.1: "the two exchange lists only: register a new or changed IPO so the
 * live jobs can see it | never fetch, download or extract a filing; it
 * writes identity and status, nothing else."
 *
 * These drive the REAL main() and runOpeningDayCheckWake against a fake
 * clock, mirroring index-closed-job-wiring.test.ts's mocking shape.
 */

const baseScraperResult = {
  success: true,
  iposProcessed: 0,
  iposInserted: 0,
  iposUpdated: 0,
  iposFailed: 0,
  iposSkipped: 0,
  subscriptionsCreated: 0,
  subscriptionsSkipped: 0,
  fieldsProtected: 0,
  errors: [] as string[],
};

const runNSEScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, smeCount: 0, mainboardCount: 0 });
const runBSEScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, iposMerged: 0, smeCount: 0, mainboardCount: 0 });
const runChittorgarhScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, smeCount: 0, mainboardCount: 0 });
const runIPOAlertsFallbackMock = vi.fn().mockResolvedValue({ ...baseScraperResult, rateLimitUsed: 0, rateLimitRemaining: 100, triggerReason: 'manual' });
const runInvestorgainGMPScraperMock = vi.fn().mockResolvedValue({ success: true, gmpsProcessed: 0, gmpsCreated: 0, gmpsSkipped: 0, gmpsFailed: 0, errors: [] as string[] });
const runDemandBackfillMock = vi.fn().mockResolvedValue(undefined);
// Document/extraction path spies (§2.1: "never fetch, download or extract a
// filing"). If runOpeningDayCheckWake ever called into the document cycle,
// one of these would be invoked and the "never calls document/extraction"
// assertions below would fail.
const runDocumentCycleMock = vi.fn().mockResolvedValue({ success: true, errors: [] });
const runDocumentPurgeMock = vi.fn().mockResolvedValue(undefined);

const dbCountRowsMock = vi.fn().mockResolvedValue([{ id: 'ipo-open-today' }]);
const dbLimitMock = vi.fn().mockResolvedValue([{ id: 'ipo-open-today' }]);

const lockAcquireMock = vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' });
const lockReleaseMock = vi.fn().mockResolvedValue(true);
const lockExtendMock = vi.fn().mockResolvedValue(true);
const lockGetTTLMock = vi.fn().mockResolvedValue(-2);

const redisGetMock = vi.fn().mockResolvedValue(null);
const redisSetMock = vi.fn().mockResolvedValue('OK');

vi.mock('../../src/scrapers/nse-scraper-orchestrator-v2.js', () => ({ runNSEScraper: runNSEScraperMock }));
vi.mock('../../src/scrapers/bse-scraper-orchestrator-v2.js', () => ({ runBSEScraper: runBSEScraperMock }));
vi.mock('../../src/scrapers/moneycontrol-orchestrator-v2.js', () => ({ runMoneycontrolScraper: vi.fn() }));
vi.mock('../../src/scrapers/chittorgarh-orchestrator-v2.js', () => ({ runChittorgarhScraper: runChittorgarhScraperMock }));
vi.mock('../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js', () => ({ runIPOAlertsFallback: runIPOAlertsFallbackMock }));
vi.mock('../../src/scrapers/investorgain-gmp-orchestrator-v2.js', () => ({ runInvestorgainGMPScraper: runInvestorgainGMPScraperMock }));
vi.mock('../../src/scripts/backfill-demand-graph.js', () => ({ runDemandBackfill: runDemandBackfillMock }));
vi.mock('../../src/services/document-cycle.js', () => ({
  runDocumentCycle: runDocumentCycleMock,
  runDocumentPurge: runDocumentPurgeMock,
  formatCycleReason: vi.fn().mockReturnValue(''),
  releaseHeldLocks: vi.fn().mockResolvedValue(undefined),
  getWakeBudgetMs: vi.fn().mockReturnValue(20 * 60 * 1000),
}));
vi.mock('../../src/scrapers/listing-performance-updater.js', () => ({ updateListingPerformance: vi.fn().mockResolvedValue({ totalListedIPOs: 0, existingRecords: 0, newRecordsCreated: 0, recordsUpdated: 0, failures: 0, duration: 1, timestamp: new Date(0).toISOString() }) }));
vi.mock('../../src/scheduler/listing-performance-cadence.js', () => ({ shouldRunListingPerformanceUpdate: vi.fn().mockReturnValue(false) }));
vi.mock('../../src/scheduler/jobs/registrar-health-check-job.js', () => ({
  runRegistrarHealthCheck: vi.fn().mockResolvedValue({ checked: 0, healthy: 0, newlyDead: [], stillDead: [] }),
}));
vi.mock('../../src/scheduler/registrar-health-check-cadence.js', () => ({
  shouldRunRegistrarHealthCheck: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/services/registrar-reresolve.js', () => ({
  reresolveRegistrarIds: vi.fn().mockResolvedValue({ candidates: 0, matched: 0, written: 0, unmatchedNames: [] }),
}));
vi.mock('../../src/scheduler/jobs/duplicate-sweep-job.js', () => ({
  runDuplicateSweepJob: vi.fn().mockResolvedValue({ totalIpos: 0, clusters: 0, dupClusters: [], applied: false }),
}));
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({
  runStageReconcilerJob: vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} }),
}));
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({
  runPrimaryDocBackfill: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/scheduler/closed-ipo-job.js', () => ({
  runClosedIpoJob: vi.fn(),
  isClosedIpoJobDue: vi.fn().mockReturnValue(false),
  CLOSED_IPO_JOB_SLOT_IST_MINUTES: 22 * 60,
  resourceClosedIpo: vi.fn(),
  closedIpoResourcingVersion: vi.fn().mockReturnValue('r-test'),
}));
vi.mock('../../src/scheduler/closed-ipo-snapshot.js', () => ({
  writeFieldSourcesSnapshot: vi.fn().mockResolvedValue({ path: '/tmp/snap.json', rows: 0 }),
}));
vi.mock('../../src/services/field-plan-walk.js', () => ({ walkFieldPlanForIPO: vi.fn() }));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({
  shouldRunOnCatchUpCadence: vi.fn().mockResolvedValue(false),
  isCatchUpCadenceDue: vi.fn().mockResolvedValue(false),
  markCatchUpCadenceRan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    acquire: lockAcquireMock,
    release: lockReleaseMock,
    extendLock: lockExtendMock,
    getLockTTL: lockGetTTLMock,
  })),
}));
vi.mock('../../src/services/freshness-monitor.js', () => ({ evaluateFreshness: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/services/deploy-drift-monitor.js', () => ({
  checkDeployDrift: vi.fn().mockResolvedValue([]),
  getMainShaFromOrigin: vi.fn(),
  getServedShaForSlot: vi.fn(),
}));
vi.mock('../../src/services/cross-source-disagreement-monitor.js', () => ({
  checkCrossSourceDisagreements: vi.fn().mockResolvedValue({ openIpoCount: 0, disagreements: [], highValueCount: 0, otherCount: 0 }),
}));
// scheduler/opening-day-check.js is exercised for real (its own unit tests
// cover the gate); only the DB layer beneath it is stubbed.
const runOpeningDayDiscoveryMock = vi.fn().mockResolvedValue({
  todayIso: '2026-09-03', nseRowsChecked: 2, bseRowsChecked: 3, written: [], skippedNonIpo: [], storedOpeningToday: [], failures: [],
});
const createOpeningDayWriterMock = vi.fn(() => vi.fn());
const createProvenanceRecorderMock = vi.fn((repo: unknown) => ({ repo, take: vi.fn(() => []) }));
vi.mock('../../src/scheduler/opening-day-discovery.js', () => ({
  runOpeningDayDiscovery: runOpeningDayDiscoveryMock,
  createOpeningDayWriter: createOpeningDayWriterMock,
  createProvenanceRecorder: createProvenanceRecorderMock,
}));
vi.mock('../../src/services/data-consolidation-service.js', () => ({
  DataConsolidationService: vi.fn().mockImplementation(() => ({ consolidateIPOData: vi.fn() })),
}));
vi.mock('@ipodhan/shared', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({})),
  IpoFieldPlanRepository: vi.fn().mockImplementation(() => ({})),
  FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
  filterProtectedFields: vi.fn(),
  createFieldProtectionService: vi.fn().mockReturnValue({}),
  resolveIpoRow: vi.fn(),
  inferBoundVia: vi.fn(),
  SOURCE_KEY_NO_WRITE_ERROR_NAMES: new Set<string>(),
  db: {
    delete: () => ({ where: () => ({ returning: vi.fn().mockResolvedValue([]) }) }),
    select: () => ({ from: () => ({ where: (...args: unknown[]) => {
      // countIposByStatus's shape: where(...) resolves directly to rows.
      // anyIpoOpensToday's shape: where(...).limit(1) resolves to rows.
      const chain = Promise.resolve(dbCountRowsMock()) as unknown as { limit: () => Promise<unknown> };
      chain.limit = () => dbLimitMock();
      return chain;
    } }) }),
  },
  getRedisClient: () => ({ get: redisGetMock, set: redisSetMock }),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
  scraperSteps: {},
  ipos: { id: 'id', status: 'status', openDate: 'open_date', companyName: 'company_name' },
  ipoStatusEnum: ipoStatusEnumMock,
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
  eq: vi.fn((col: unknown, value: unknown) => ({ col, value })),
  inArray: vi.fn((col: unknown, values: unknown) => ({ col, values })),
  count: vi.fn(() => 'count()'),
}));

/** Build a UTC Date from explicit IST wall-clock fields (UTC = IST - 5:30). */
function istDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60_000);
}
const THURSDAY_0945_IST = istDate(2026, 9, 3, 9, 45);

describe('item 7 S4 - the opening-day check runs as its own --job=opening wake under scraper:cycle', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const runWith = async (args: string[], now: Date) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    process.argv = [...originalArgv.slice(0, 2), ...args];
    const mod = await import('../../src/index.js');
    await mod.main();
    return mod;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_TOKEN = 'test-admin-token';
    process.env.ENABLE_DUE_STEP_SCHEDULER = 'true';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));
    lockAcquireMock.mockReset().mockResolvedValue({ acquired: true, token: 'tok-1' });
    lockReleaseMock.mockReset().mockResolvedValue(true);
    lockExtendMock.mockReset().mockResolvedValue(true);
    lockGetTTLMock.mockReset().mockResolvedValue(-2);
    redisGetMock.mockReset().mockResolvedValue(null);
    redisSetMock.mockReset().mockResolvedValue('OK');
    dbCountRowsMock.mockReset().mockResolvedValue([{ id: 'ipo-open-today' }]);
    dbLimitMock.mockReset().mockResolvedValue([{ id: 'ipo-open-today' }]);
    runNSEScraperMock.mockClear();
    runBSEScraperMock.mockClear();
    runDocumentCycleMock.mockClear();
    runDocumentPurgeMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it('§2.1: with an IPO opening today, the check acquires scraper:cycle, runs the two exchange list calls only (OD-87), releases the lock, and never calls the document/extraction path', async () => {
    dbLimitMock.mockResolvedValue([{ id: 'ipo-open-today' }]);
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'opening-tok' });
    await runWith(['--source=all', '--job=opening'], THURSDAY_0945_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', expect.anything());
    // OD-87: the two LIST functions only — never the full NSE/BSE orchestrators.
    expect(runOpeningDayDiscoveryMock).toHaveBeenCalledTimes(1);
    const deps = runOpeningDayDiscoveryMock.mock.calls[0][0];
    expect(deps.fetchNseList.name).toBe('fetchCurrentIssueList');
    expect(deps.fetchBseList.name).toBe('fetchBSEBoard');
    // Provenance (round 5): the writer gets the provenance writer, the flag, and the
    // recorder that tells it which rows the decision call already wrote.
    const writerCollaborators = (createOpeningDayWriterMock.mock.calls as any[])[0][0];
    expect(writerCollaborators.fieldSources).toBeDefined();
    expect(typeof writerCollaborators.sourceTrackingEnabled).toBe('boolean');
    expect(writerCollaborators.decisionProvenance).toBe(createProvenanceRecorderMock.mock.results[0].value);
    expect(runNSEScraperMock).not.toHaveBeenCalled();
    expect(runBSEScraperMock).not.toHaveBeenCalled();
    // Discovery-only (§2.1): no document/extraction call from this job.
    expect(runDocumentCycleMock).not.toHaveBeenCalled();
    expect(runDocumentPurgeMock).not.toHaveBeenCalled();
    // Never the aggregator, API fallback or field-plan walk — those are the
    // data job's own post-steps.
    expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
    expect(runIPOAlertsFallbackMock).not.toHaveBeenCalled();
    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
    expect(runDemandBackfillMock).not.toHaveBeenCalled();
    expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'opening-tok');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('review finding 1 (CRITICAL, class coverage): the DB has ZERO rows for the day (no prior row at all) — the check still takes the lock and fetches both lists, exactly the case a DB-only gate would have skipped', async () => {
    // dbLimitMock backs BOTH anyIpoOpensToday calls (pre-fetch would have
    // been wrong; this suite's fix reads it only AFTER the fetch). Empty on
    // the way in is exactly "no stored row yet" — the fetch must still run.
    dbLimitMock.mockResolvedValue([]);
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'opening-tok' });
    await runWith(['--source=all', '--job=opening'], THURSDAY_0945_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', expect.anything());
    // OD-87: the two LIST functions only — never the full NSE/BSE orchestrators.
    expect(runOpeningDayDiscoveryMock).toHaveBeenCalledTimes(1);
    const deps = runOpeningDayDiscoveryMock.mock.calls[0][0];
    expect(deps.fetchNseList.name).toBe('fetchCurrentIssueList');
    expect(deps.fetchBseList.name).toBe('fetchBSEBoard');
    expect(runNSEScraperMock).not.toHaveBeenCalled();
    expect(runBSEScraperMock).not.toHaveBeenCalled();
    expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'opening-tok');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('§2.1 lock table ("heavy ... skipped if held"): with scraper:cycle HELD, the check skips this occurrence, logs the skip, and never kills or queues', async () => {
    dbLimitMock.mockResolvedValue([{ id: 'ipo-open-today' }]);
    lockAcquireMock.mockResolvedValue({ acquired: false });
    lockGetTTLMock.mockResolvedValue(1_200_000);
    await runWith(['--source=all', '--job=opening'], THURSDAY_0945_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', expect.anything());
    expect(runOpeningDayDiscoveryMock).not.toHaveBeenCalled();
    expect(runNSEScraperMock).not.toHaveBeenCalled();
    expect(runBSEScraperMock).not.toHaveBeenCalled();
    expect(lockReleaseMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
