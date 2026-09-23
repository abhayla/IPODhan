import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipoStatusEnumMock } from '../helpers/schema-mock.js';

/**
 * IPODhan item 7, slice S3 (spec docs/design/data-sourcing-pull-model.md
 * section 2.1 job table row "Closed-IPO job", section 6.1, OD-19, OD-22).
 *
 * §2.1: "never start while the heavy lock is held ... it never kills
 * anything." §6.1: "At 22:00 IST, once a day. It starts only if the data
 * job's cycle lock is free; if the 14:00 job is somehow still running, the
 * 22:00 job skips its turn and says so. It never kills anything."
 *
 * These drive the REAL main() and runClosedIpoWake against the REAL
 * isClosedIpoJobDue boundary check on a fake clock (only Date is faked), so
 * a regression in the wiring turns them red.
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
const dbReturningMock = vi.fn().mockResolvedValue([]);
const dbCountRowsMock = vi.fn().mockResolvedValue([{ c: 0 }]);

const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(false);
const isCatchUpCadenceDueMock = vi.fn().mockResolvedValue(false);
const markCatchUpCadenceRanMock = vi.fn().mockResolvedValue(undefined);

const lockAcquireMock = vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' });
const lockReleaseMock = vi.fn().mockResolvedValue(true);
const lockExtendMock = vi.fn().mockResolvedValue(true);
const lockGetTTLMock = vi.fn().mockResolvedValue(-2);

const redisGetMock = vi.fn().mockResolvedValue(null);
const redisSetMock = vi.fn().mockResolvedValue('OK');

const runClosedIpoJobMock = vi.fn().mockResolvedValue({
  candidatesConsidered: 0,
  attempted: 0,
  outcomes: { DONE: 0, PARTIAL: 0, FAILED: 0 },
  skippedCycleLockHeld: false,
  snapshot: null,
});

vi.mock('../../src/scrapers/nse-scraper-orchestrator-v2.js', () => ({ runNSEScraper: runNSEScraperMock }));
vi.mock('../../src/scrapers/bse-scraper-orchestrator-v2.js', () => ({ runBSEScraper: runBSEScraperMock }));
vi.mock('../../src/scrapers/moneycontrol-orchestrator-v2.js', () => ({ runMoneycontrolScraper: vi.fn() }));
vi.mock('../../src/scrapers/chittorgarh-orchestrator-v2.js', () => ({ runChittorgarhScraper: runChittorgarhScraperMock }));
vi.mock('../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js', () => ({ runIPOAlertsFallback: runIPOAlertsFallbackMock }));
vi.mock('../../src/scrapers/investorgain-gmp-orchestrator-v2.js', () => ({ runInvestorgainGMPScraper: runInvestorgainGMPScraperMock }));
vi.mock('../../src/scripts/backfill-demand-graph.js', () => ({ runDemandBackfill: runDemandBackfillMock }));
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
// Item 7 S3: the closed-IPO job module itself — runClosedIpoJob is the real
// unit under `resourceClosedIpo`/`selectClosedIpoCandidates`; here it is
// mocked so this suite tests ONLY the wiring (lock, cadence, flag), exactly
// as index-live-job-wiring.test.ts mocks GMP/NSE/BSE for the live job.
vi.mock('../../src/scheduler/closed-ipo-job.js', () => ({
  runClosedIpoJob: runClosedIpoJobMock,
  isClosedIpoJobDue: (now: Date, lastRunAt: Date | null) => {
    // Real boundary semantics, inlined so the fake clock still drives it:
    // the job is due once per 22:00-IST boundary. Tests set the clock either
    // side of that boundary and assert on it via runClosedIpoJobMock calls,
    // not on this predicate directly — see catch-up-cadence.test coverage
    // and closed-ipo-job.test.ts for isClosedIpoJobDue's own unit tests.
    const IST_OFFSET_MINUTES = 5 * 60 + 30;
    const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
    const dayIndex = Math.floor(istMs / 86_400_000);
    const minutesOfDay = new Date(istMs).getUTCHours() * 60 + new Date(istMs).getUTCMinutes();
    const boundaryEpochMinute =
      minutesOfDay >= 22 * 60 ? dayIndex * 1440 + 22 * 60 : (dayIndex - 1) * 1440 + 22 * 60;
    if (lastRunAt === null) return true;
    const lastRunIstMinute = Math.floor((lastRunAt.getTime() + IST_OFFSET_MINUTES * 60_000) / 60_000);
    return boundaryEpochMinute > lastRunIstMinute;
  },
  CLOSED_IPO_JOB_SLOT_IST_MINUTES: 22 * 60,
  resourceClosedIpo: vi.fn(),
  closedIpoResourcingVersion: vi.fn().mockReturnValue('r-test'),
}));
vi.mock('../../src/scheduler/closed-ipo-snapshot.js', () => ({
  writeFieldSourcesSnapshot: vi.fn().mockResolvedValue({ path: '/tmp/snap.json', rows: 0 }),
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
const THURSDAY_2200_IST = istDate(2026, 9, 3, 22, 0);
const THURSDAY_1400_IST = istDate(2026, 9, 3, 14, 0);

describe('item 7 S3 - the closed-IPO job runs as its own --job=closed wake under scraper:cycle', () => {
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
    process.env.ENABLE_CLOSED_IPO_JOB = 'true';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));
    lockAcquireMock.mockReset().mockResolvedValue({ acquired: true, token: 'tok-1' });
    lockReleaseMock.mockReset().mockResolvedValue(true);
    lockExtendMock.mockReset().mockResolvedValue(true);
    lockGetTTLMock.mockReset().mockResolvedValue(-2);
    runClosedIpoJobMock.mockReset().mockResolvedValue({
      candidatesConsidered: 0,
      attempted: 0,
      outcomes: { DONE: 0, PARTIAL: 0, FAILED: 0 },
      skippedCycleLockHeld: false,
      snapshot: null,
    });
    redisGetMock.mockReset().mockResolvedValue(null);
    redisSetMock.mockReset().mockResolvedValue('OK');
    dbCountRowsMock.mockReset().mockResolvedValue([{ c: 0 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it('§2.1/§6.1: with scraper:cycle HELD by a running data job, a closed wake picks 0 IPOs, logs the skip, and exits 0', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: false });
    lockGetTTLMock.mockResolvedValue(1_200_000); // 20 minutes remaining, arbitrary but > 0
    await runWith(['--source=all', '--job=closed'], THURSDAY_2200_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', expect.anything());
    expect(runClosedIpoJobMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    // no-kill (§2.1): it never calls forceRelease or signals another process.
    expect(lockReleaseMock).not.toHaveBeenCalled();
  });

  it('§6.1: with scraper:cycle free, a closed wake acquires it, runs the job, and releases it', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'closed-tok' });
    await runWith(['--source=all', '--job=closed'], THURSDAY_2200_IST);

    expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', expect.anything());
    expect(runClosedIpoJobMock).toHaveBeenCalledTimes(1);
    expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'closed-tok');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('runClosedIpoJob is passed isCycleLockHeld that resolves false (this process already proved it holds the lock)', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'closed-tok' });
    await runWith(['--source=all', '--job=closed'], THURSDAY_2200_IST);

    const deps = runClosedIpoJobMock.mock.calls[0][0];
    await expect(deps.isCycleLockHeld()).resolves.toBe(false);
  });

  it('ENABLE_CLOSED_IPO_JOB=false: the wake still takes and releases the lock, logs "disabled", and never calls runClosedIpoJob', async () => {
    process.env.ENABLE_CLOSED_IPO_JOB = 'false';
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'closed-tok' });
    await runWith(['--source=all', '--job=closed'], THURSDAY_2200_IST);

    expect(runClosedIpoJobMock).not.toHaveBeenCalled();
    expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'closed-tok');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('the data job no longer runs the closed-IPO job as a post-step (item 2)', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'data-tok' });
    await runWith(['--source=all', '--job=data'], THURSDAY_1400_IST);

    expect(runClosedIpoJobMock).not.toHaveBeenCalled();
  });

  it("no --job flag (today's cron line) also never runs the closed-IPO job in-cycle", async () => {
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'data-tok' });
    await runWith(['--source=all'], THURSDAY_1400_IST);

    expect(runClosedIpoJobMock).not.toHaveBeenCalled();
  });

  it('the closed wake never touches live-figures or discovery code', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'closed-tok' });
    await runWith(['--source=all', '--job=closed'], THURSDAY_2200_IST);

    expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
    expect(runNSEScraperMock).not.toHaveBeenCalled();
    expect(runBSEScraperMock).not.toHaveBeenCalled();
    expect(runDemandBackfillMock).not.toHaveBeenCalled();
    expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
    expect(runIPOAlertsFallbackMock).not.toHaveBeenCalled();
  });

  it('SIGTERM during a closed run releases scraper:cycle with its own token', async () => {
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'closed-tok' });
    let jobStarted!: () => void;
    const started = new Promise<void>((resolve) => { jobStarted = resolve; });
    runClosedIpoJobMock.mockImplementationOnce(() => { jobStarted(); return new Promise(() => {}); }); // in flight
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(THURSDAY_2200_IST);
    process.argv = [...originalArgv.slice(0, 2), '--source=all', '--job=closed'];
    const mod = await import('../../src/index.js');
    void mod.main();
    await started;
    lockReleaseMock.mockClear();

    process.emit('SIGTERM' as NodeJS.Signals);
    await new Promise((resolve) => setImmediate(resolve));

    expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'closed-tok');
  });
});
