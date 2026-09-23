import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipoStatusEnumMock } from '../helpers/schema-mock.js';

/**
 * IPODhan item 7, slice S1 (spec docs/design/data-sourcing-pull-model.md
 * section 2.1 job table and "The two locks", OD-27, OD-28).
 *
 * OD-27: "The live figures job should have its own lock. ... The data job must
 * never block the live figures." OD-28: subscription and the demand graph only
 * while bidding is on; the grey-market premium every 30 minutes whenever an IPO
 * is UPCOMING or OPEN - evenings, weekends and holidays included.
 *
 * These drive the REAL main() and the REAL due-step-cycle predicates on a fake
 * clock (only Date is faked), so a regression in either the wiring or the
 * window arithmetic turns them red.
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
const runMoneycontrolScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, smeCount: 0, mainboardCount: 0 });
const runChittorgarhScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult, smeCount: 0, mainboardCount: 0 });
const runIPOAlertsFallbackMock = vi.fn().mockResolvedValue({ ...baseScraperResult, rateLimitUsed: 0, rateLimitRemaining: 100, triggerReason: 'manual' });
const runInvestorgainGMPScraperMock = vi.fn().mockResolvedValue({ success: true, gmpsProcessed: 0, gmpsCreated: 0, gmpsSkipped: 0, gmpsFailed: 0, errors: [] as string[] });
const runDemandBackfillMock = vi.fn().mockResolvedValue(undefined);
const updateListingPerformanceMock = vi.fn().mockResolvedValue({ totalListedIPOs: 0, existingRecords: 0, newRecordsCreated: 0, recordsUpdated: 0, failures: 0, duration: 1, timestamp: new Date(0).toISOString() });
const shouldRunListingPerformanceUpdateMock = vi.fn().mockReturnValue(false);
const dbReturningMock = vi.fn().mockResolvedValue([]);
// The count query is answered by WHICH statuses it asks for, so a test can say
// "no OPEN IPO, but one UPCOMING" - the Saturday-evening GMP case.
let openCount = 0;
let upcomingCount = 0;
const dbCountRowsMock = vi.fn().mockImplementation(async (where: { values?: string[] }) => {
  const values = where?.values ?? [];
  let c = 0;
  if (values.includes('OPEN')) c += openCount;
  if (values.includes('UPCOMING')) c += upcomingCount;
  return [{ c }];
});

const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(false);
const isCatchUpCadenceDueMock = vi.fn().mockResolvedValue(false);
const markCatchUpCadenceRanMock = vi.fn().mockResolvedValue(undefined);

const lockAcquireMock = vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' });
const lockReleaseMock = vi.fn().mockResolvedValue(true);
const lockExtendMock = vi.fn().mockResolvedValue(true);

// Round-4 MEDIUM/LOW: stable mock refs (not a fresh object per `getRedisClient()`
// call) so tests can assert on `redis.set` calls (the discovery cadence stamp)
// across the whole `main()` run.
const redisGetMock = vi.fn().mockResolvedValue(null);
const redisSetMock = vi.fn().mockResolvedValue('OK');

vi.mock('../../src/scrapers/nse-scraper-orchestrator-v2.js', () => ({ runNSEScraper: runNSEScraperMock }));
vi.mock('../../src/scrapers/bse-scraper-orchestrator-v2.js', () => ({ runBSEScraper: runBSEScraperMock }));
vi.mock('../../src/scrapers/moneycontrol-orchestrator-v2.js', () => ({ runMoneycontrolScraper: runMoneycontrolScraperMock }));
vi.mock('../../src/scrapers/chittorgarh-orchestrator-v2.js', () => ({ runChittorgarhScraper: runChittorgarhScraperMock }));
vi.mock('../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js', () => ({ runIPOAlertsFallback: runIPOAlertsFallbackMock }));
vi.mock('../../src/scrapers/investorgain-gmp-orchestrator-v2.js', () => ({ runInvestorgainGMPScraper: runInvestorgainGMPScraperMock }));
vi.mock('../../src/scripts/backfill-demand-graph.js', () => ({ runDemandBackfill: runDemandBackfillMock }));
vi.mock('../../src/scrapers/listing-performance-updater.js', () => ({ updateListingPerformance: updateListingPerformanceMock }));
vi.mock('../../src/scheduler/listing-performance-cadence.js', () => ({ shouldRunListingPerformanceUpdate: shouldRunListingPerformanceUpdateMock }));
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
const runStageReconcilerJobMock = vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} });
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({
  runStageReconcilerJob: runStageReconcilerJobMock,
}));
const runPrimaryDocBackfillMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({
  runPrimaryDocBackfill: runPrimaryDocBackfillMock,
}));
const runClosedIpoJobMock = vi.fn();
vi.mock('../../src/scheduler/closed-ipo-job.js', () => ({
  runClosedIpoJob: runClosedIpoJobMock,
  isClosedIpoJobDue: vi.fn().mockReturnValue(true),
  CLOSED_IPO_JOB_SLOT_IST_MINUTES: 22 * 60,
}));
const walkFieldPlanForIPOMock = vi.fn();
vi.mock('../../src/services/field-plan-walk.js', () => ({ walkFieldPlanForIPO: walkFieldPlanForIPOMock }));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({
  shouldRunOnCatchUpCadence: shouldRunOnCatchUpCadenceMock,
  isCatchUpCadenceDue: isCatchUpCadenceDueMock,
  markCatchUpCadenceRan: markCatchUpCadenceRanMock,
}));
vi.mock('../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    acquire: lockAcquireMock,
    release: lockReleaseMock,
    extendLock: lockExtendMock,
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
vi.mock('@ipodhan/shared', () => ({
  db: {
    delete: () => ({ where: () => ({ returning: dbReturningMock }) }),
    select: () => ({ from: () => ({ where: dbCountRowsMock }) }),
  },
  getRedisClient: () => ({ get: redisGetMock, set: redisSetMock }),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
  scraperSteps: {},
  ipos: { status: 'status' },
  ipoStatusEnum: ipoStatusEnumMock,
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
  inArray: vi.fn((col: unknown, values: unknown) => ({ col, values })),
  count: vi.fn(() => 'count()'),
}));


/** Build a UTC Date from explicit IST wall-clock fields (UTC = IST - 5:30). */
function istDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60_000);
}
// 2026-09-03 is a Thursday, 2026-09-05 a Saturday.
const THURSDAY_1400_IST = istDate(2026, 9, 3, 14, 0);
const THURSDAY_1800_IST = istDate(2026, 9, 3, 18, 0);
const THURSDAY_2100_IST = istDate(2026, 9, 3, 21, 0);
const SATURDAY_2200_IST = istDate(2026, 9, 5, 22, 0);

describe('item 7 S1 - the live-figures job runs under its own scraper:live lock', () => {
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
    openCount = 0;
    upcomingCount = 0;
    lockAcquireMock.mockReset().mockResolvedValue({ acquired: true, token: 'tok-1' });
    lockReleaseMock.mockReset().mockResolvedValue(true);
    lockExtendMock.mockReset().mockResolvedValue(true);
    shouldRunOnCatchUpCadenceMock.mockResolvedValue(false);
    isCatchUpCadenceDueMock.mockResolvedValue(false);
    // Discovery "ran just now", so a data run never reaches NSE/BSE discovery
    // and every NSE/BSE call a test sees is a live-figures call.
    redisGetMock.mockReset().mockImplementation(async () => new Date().toISOString());
    redisSetMock.mockReset().mockResolvedValue('OK');
  });

  afterEach(() => {
    vi.useRealTimers();
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it('OD-27: with scraper:cycle HELD by a running data job, a live run still takes scraper:live and calls GMP', async () => {
    // The data job holds the heavy lock; any acquire of it fails.
    lockAcquireMock.mockImplementation(async (resource: string) =>
      resource === 'scraper:cycle' ? { acquired: false } : { acquired: true, token: 'live-tok' });
    openCount = 1;
    const { LIVE_LOCK_TTL_MS } = await runWith(['--source=all', '--job=live'], THURSDAY_1400_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:live', { ttl: LIVE_LOCK_TTL_MS });
    // It never even asks for the heavy lock - asking would make it depend on it.
    expect(lockAcquireMock).not.toHaveBeenCalledWith('scraper:cycle', expect.anything());
    expect(runInvestorgainGMPScraperMock).toHaveBeenCalledTimes(1);
    expect(lockReleaseMock).toHaveBeenCalledWith('scraper:live', 'live-tok');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('OD-28: GMP runs at 22:00 IST on a Saturday when an IPO is UPCOMING (no IPO OPEN)', async () => {
    upcomingCount = 1;
    await runWith(['--source=all', '--job=live'], SATURDAY_2200_IST);

    expect(runInvestorgainGMPScraperMock).toHaveBeenCalledTimes(1);
    // ...and nothing bidding-gated ran on a Saturday night.
    expect(runNSEScraperMock).not.toHaveBeenCalled();
    expect(runBSEScraperMock).not.toHaveBeenCalled();
    expect(runDemandBackfillMock).not.toHaveBeenCalled();
  });

  it('OD-28: GMP makes no call when no IPO is UPCOMING or OPEN', async () => {
    await runWith(['--source=all', '--job=live'], SATURDAY_2200_IST);
    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('OD-28: subscription and the demand graph do NOT run outside bidding hours, even with an IPO OPEN', async () => {
    openCount = 2;
    await runWith(['--source=all', '--job=live'], THURSDAY_2100_IST);

    expect(runNSEScraperMock).not.toHaveBeenCalled();
    expect(runBSEScraperMock).not.toHaveBeenCalled();
    expect(runDemandBackfillMock).not.toHaveBeenCalled();
    // GMP is not bidding-gated: an OPEN IPO is also a GMP candidate at 21:00.
    expect(runInvestorgainGMPScraperMock).toHaveBeenCalledTimes(1);
  });

  it('spec 2.1: subscription and the demand graph run at 18:00 IST (inside 10:00-18:30) with an IPO OPEN', async () => {
    openCount = 1;
    await runWith(['--source=all', '--job=live'], THURSDAY_1800_IST);

    expect(runNSEScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
    expect(runBSEScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
    expect(runDemandBackfillMock).toHaveBeenCalledWith({ execute: true });
  });

  it('a live wake whose own lock is held (the previous live run is stuck) skips and exits 0', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: false });
    openCount = 1;
    await runWith(['--source=all', '--job=live'], THURSDAY_1400_IST);

    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
    expect(runNSEScraperMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('the live job never calls document, field-plan, closed-IPO or post-step code', async () => {
    openCount = 1;
    upcomingCount = 1;
    await runWith(['--source=all', '--job=live'], THURSDAY_1400_IST);

    expect(runPrimaryDocBackfillMock).not.toHaveBeenCalled();
    expect(walkFieldPlanForIPOMock).not.toHaveBeenCalled();
    expect(runClosedIpoJobMock).not.toHaveBeenCalled();
    expect(runStageReconcilerJobMock).not.toHaveBeenCalled();
    expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
    expect(runIPOAlertsFallbackMock).not.toHaveBeenCalled();
  });

  it('the data job no longer calls the live fetchers, even in bidding hours with an IPO OPEN', async () => {
    openCount = 3;
    upcomingCount = 2;
    await runWith(['--source=all', '--job=data'], THURSDAY_1400_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', expect.anything());
    expect(lockAcquireMock).not.toHaveBeenCalledWith('scraper:live', expect.anything());
    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
    expect(runDemandBackfillMock).not.toHaveBeenCalled();
    expect(runNSEScraperMock).not.toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
    expect(runBSEScraperMock).not.toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
  });

  it("no --job flag means the data job (today's cron line keeps working)", async () => {
    openCount = 3;
    await runWith(['--source=all'], THURSDAY_1400_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', expect.anything());
    expect(lockAcquireMock).not.toHaveBeenCalledWith('scraper:live', expect.anything());
    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
  });

  it('an unknown --job value is refused with exit 1 and runs nothing', async () => {
    upcomingCount = 1;
    await runWith(['--source=all', '--job=closed'], THURSDAY_1400_IST);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(lockAcquireMock).not.toHaveBeenCalled();
    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
  });

  it('with ENABLE_DUE_STEP_SCHEDULER off, --job=live does nothing (the legacy path still owns every source)', async () => {
    delete process.env.ENABLE_DUE_STEP_SCHEDULER;
    upcomingCount = 1;
    await runWith(['--source=all', '--job=live'], THURSDAY_1400_IST);

    expect(lockAcquireMock).not.toHaveBeenCalled();
    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('SIGTERM during a live run releases scraper:live with its own token', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'live-tok' });
    await runWith(['--source=all', '--job=live'], THURSDAY_1400_IST);
    lockReleaseMock.mockClear();

    process.emit('SIGTERM' as NodeJS.Signals);
    await new Promise((resolve) => setImmediate(resolve));

    expect(lockReleaseMock).toHaveBeenCalledWith('scraper:live', 'live-tok');
  });
});
