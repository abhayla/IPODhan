import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipoStatusEnumMock } from '../helpers/schema-mock.js';

/**
 * S-02 §5 (`ENABLE_DUE_STEP_SCHEDULER`): proves the one-shot `--source=all`
 * entrypoint routes through `runDueStepCycle()` (discovery/live/aggregator
 * gating) ONLY when the flag is on, and that with the flag OFF the legacy
 * per-source blocks (NSE/BSE/Moneycontrol/Chittorgarh/GMP unconditionally on
 * every cycle) are exactly what still runs — the rollback path.
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
const dbCountRowsMock = vi.fn().mockResolvedValue([{ c: 0 }]);

const isDiscoveryDueMock = vi.fn().mockReturnValue(false);
const isMarketHoursISTMock = vi.fn().mockReturnValue(false);
const mostRecentDiscoverySlotLabelMock = vi.fn().mockReturnValue('08:30 IST');
const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(false);

const lockAcquireMock = vi.fn().mockResolvedValue({ acquired: true, token: 'tok-1' });
const lockReleaseMock = vi.fn().mockResolvedValue(true);

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
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({
  runStageReconcilerJob: vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} }),
}));
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({
  runPrimaryDocBackfill: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({
  shouldRunOnCatchUpCadence: shouldRunOnCatchUpCadenceMock,
}));
vi.mock('../../src/scheduler/due-step-cycle.js', () => ({
  isDiscoveryDue: isDiscoveryDueMock,
  isMarketHoursIST: isMarketHoursISTMock,
  mostRecentDiscoverySlotLabel: mostRecentDiscoverySlotLabelMock,
}));
vi.mock('../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    acquire: lockAcquireMock,
    release: lockReleaseMock,
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
  getRedisClient: () => ({ get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') }),
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

describe('scraper/src/index.ts one-shot --source=all path (due-step scheduler wiring)', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    process.env.ADMIN_API_TOKEN = 'test-admin-token';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));
    lockAcquireMock.mockResolvedValue({ acquired: true, token: 'tok-1' });
    isDiscoveryDueMock.mockReturnValue(false);
    isMarketHoursISTMock.mockReturnValue(false);
    shouldRunOnCatchUpCadenceMock.mockResolvedValue(false);
    dbCountRowsMock.mockResolvedValue([{ c: 0 }]);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    vi.resetModules();
  });

  describe('flag OFF (default) — legacy path is UNCHANGED', () => {
    it('never touches the due-step lock or runDemandBackfill; runs every source unconditionally', async () => {
      delete process.env.ENABLE_DUE_STEP_SCHEDULER;
      const { main } = await import('../../src/index.js');
      await main();

      expect(lockAcquireMock).not.toHaveBeenCalled();
      expect(runDemandBackfillMock).not.toHaveBeenCalled();
      expect(runNSEScraperMock).toHaveBeenCalledTimes(1);
      expect(runBSEScraperMock).toHaveBeenCalledTimes(1);
      expect(runMoneycontrolScraperMock).toHaveBeenCalledTimes(1);
      expect(runChittorgarhScraperMock).toHaveBeenCalledTimes(1);
      expect(runInvestorgainGMPScraperMock).toHaveBeenCalledTimes(1);
      expect(runIPOAlertsFallbackMock).toHaveBeenCalledTimes(1);
      // Legacy calls carry no restriction argument.
      expect(runNSEScraperMock).toHaveBeenCalledWith();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('flag ON — due-step cycle owns discovery/live/aggregators', () => {
    beforeEach(() => {
      process.env.ENABLE_DUE_STEP_SCHEDULER = 'true';
    });

    it('acquires the cycle lock and releases it on success', async () => {
      const { main } = await import('../../src/index.js');
      await main();

      expect(lockAcquireMock).toHaveBeenCalledWith('scraper:cycle', { ttl: 55 * 60 * 1000 });
      expect(lockReleaseMock).toHaveBeenCalledWith('scraper:cycle', 'tok-1');
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('exits 0 doing nothing when the lock is already held (previous cycle still running)', async () => {
      lockAcquireMock.mockResolvedValueOnce({ acquired: false });
      const { main } = await import('../../src/index.js');
      await main();

      expect(runNSEScraperMock).not.toHaveBeenCalled();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('discovery: runs NSE+BSE when due, skips them when not due — never gated by top-level source blocks', async () => {
      isDiscoveryDueMock.mockReturnValue(true);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runNSEScraperMock).toHaveBeenCalledTimes(1);
      expect(runBSEScraperMock).toHaveBeenCalledTimes(1);
      // Called with no args (unrestricted discovery fetch), not the OPEN-only live restriction.
      expect(runNSEScraperMock).toHaveBeenCalledWith();
    });

    it('discovery: NOT due -> NSE/BSE never called', async () => {
      isDiscoveryDueMock.mockReturnValue(false);
      isMarketHoursISTMock.mockReturnValue(false);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runNSEScraperMock).not.toHaveBeenCalled();
      expect(runBSEScraperMock).not.toHaveBeenCalled();
    });

    it('live: outside market hours -> zero network calls (GMP/demand-graph never invoked)', async () => {
      isMarketHoursISTMock.mockReturnValue(false);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
      expect(runDemandBackfillMock).not.toHaveBeenCalled();
    });

    it('live: market hours but zero OPEN IPOs -> zero network calls', async () => {
      isMarketHoursISTMock.mockReturnValue(true);
      dbCountRowsMock.mockResolvedValue([{ c: 0 }]);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
      expect(runDemandBackfillMock).not.toHaveBeenCalled();
    });

    it('live: market hours + OPEN IPOs present -> GMP + demand graph + OPEN-restricted NSE/BSE run', async () => {
      isMarketHoursISTMock.mockReturnValue(true);
      dbCountRowsMock.mockResolvedValue([{ c: 3 }]);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runInvestorgainGMPScraperMock).toHaveBeenCalledTimes(1);
      expect(runDemandBackfillMock).toHaveBeenCalledWith({ execute: true });
      expect(runNSEScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
      expect(runBSEScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['OPEN'] });
    });

    it('aggregators: cadence not due -> Moneycontrol/Chittorgarh never called', async () => {
      shouldRunOnCatchUpCadenceMock.mockResolvedValue(false);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
    });

    it('aggregators: cadence due but zero UPCOMING/OPEN IPOs -> skipped (zero network calls)', async () => {
      shouldRunOnCatchUpCadenceMock.mockResolvedValue(true);
      dbCountRowsMock.mockResolvedValue([{ c: 0 }]);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
    });

    it('aggregators: cadence due + UPCOMING/OPEN IPOs present -> Moneycontrol+Chittorgarh restricted to UPCOMING/OPEN', async () => {
      shouldRunOnCatchUpCadenceMock.mockResolvedValue(true);
      dbCountRowsMock.mockResolvedValue([{ c: 5 }]);
      const { main } = await import('../../src/index.js');
      await main();
      expect(runMoneycontrolScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['UPCOMING', 'OPEN'] });
      expect(runChittorgarhScraperMock).toHaveBeenCalledWith({ allowedStatuses: ['UPCOMING', 'OPEN'] });
    });

    it('never calls the legacy unconditional per-source blocks (NSE/BSE/MC/CG/GMP/fallback) directly on "all"', async () => {
      // With everything "not due", NOTHING should have been called at all.
      const { main } = await import('../../src/index.js');
      await main();
      expect(runNSEScraperMock).not.toHaveBeenCalled();
      expect(runBSEScraperMock).not.toHaveBeenCalled();
      expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
      expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
      expect(runInvestorgainGMPScraperMock).not.toHaveBeenCalled();
      expect(runIPOAlertsFallbackMock).not.toHaveBeenCalled();
    });
  });
});
