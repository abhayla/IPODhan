import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T-324 ITEM 2 regression test: proves the one-shot production path
 * (`scraper/src/index.ts --source=all`, the ONLY scraper process PM2 runs --
 * see docs/monitoring/scrape-cadence-measurement.md) actually invokes the
 * served-SHA drift monitor (`checkDeployDrift`, via `triggerDeployDriftMonitor`),
 * cadence-gated to once an hour through the SAME `catch-up-cadence.ts` guard
 * the T-311 jobs already use -- not a second scheduler. Mirrors
 * index-scheduler-jobs-wiring.test.ts's pattern for the other T-311/T-324
 * one-shot-cycle triggers.
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

const runNSEScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runBSEScraperMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  iposMerged: 0,
  smeCount: 0,
  mainboardCount: 0,
});
const runMoneycontrolScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runChittorgarhScraperMock = vi.fn().mockResolvedValue({ ...baseScraperResult });
const runIPOAlertsFallbackMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  rateLimitUsed: 0,
  rateLimitRemaining: 100,
  triggerReason: 'manual',
});
const runInvestorgainGMPScraperMock = vi.fn().mockResolvedValue({
  success: true,
  gmpsProcessed: 0,
  gmpsCreated: 0,
  gmpsSkipped: 0,
  gmpsFailed: 0,
  errors: [] as string[],
});
const updateListingPerformanceMock = vi.fn().mockResolvedValue({
  totalListedIPOs: 0,
  existingRecords: 0,
  newRecordsCreated: 0,
  recordsUpdated: 0,
  failures: 0,
  duration: 1,
  timestamp: new Date(0).toISOString(),
});
const shouldRunListingPerformanceUpdateMock = vi.fn().mockReturnValue(false);
const runRegistrarHealthCheckMock = vi.fn().mockResolvedValue({ checked: 0, healthy: 0, newlyDead: [], stillDead: [] });
const shouldRunRegistrarHealthCheckMock = vi.fn().mockReturnValue(false);
const reresolveRegistrarIdsMock = vi.fn().mockResolvedValue({ candidates: 0, matched: 0, written: 0, unmatchedNames: [] });
const runDuplicateSweepJobMock = vi.fn().mockResolvedValue({ totalIpos: 0, clusters: 0, dupClusters: [] as unknown[], applied: false });
const runStageReconcilerJobMock = vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} });
const runPrimaryDocBackfillMock = vi.fn().mockResolvedValue(undefined);
const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(true);
const checkDeployDriftMock = vi.fn().mockResolvedValue([]);
const dbReturningMock = vi.fn().mockResolvedValue([]);

vi.mock('../../src/scrapers/nse-scraper-orchestrator-v2.js', () => ({
  runNSEScraper: runNSEScraperMock,
}));
vi.mock('../../src/scrapers/bse-scraper-orchestrator-v2.js', () => ({
  runBSEScraper: runBSEScraperMock,
}));
vi.mock('../../src/scrapers/moneycontrol-orchestrator-v2.js', () => ({
  runMoneycontrolScraper: runMoneycontrolScraperMock,
}));
vi.mock('../../src/scrapers/chittorgarh-orchestrator-v2.js', () => ({
  runChittorgarhScraper: runChittorgarhScraperMock,
}));
vi.mock('../../src/scrapers/ipo-alerts-fallback-orchestrator-v2.js', () => ({
  runIPOAlertsFallback: runIPOAlertsFallbackMock,
}));
vi.mock('../../src/scrapers/investorgain-gmp-orchestrator-v2.js', () => ({
  runInvestorgainGMPScraper: runInvestorgainGMPScraperMock,
}));
vi.mock('../../src/scrapers/listing-performance-updater.js', () => ({
  updateListingPerformance: updateListingPerformanceMock,
}));
vi.mock('../../src/scheduler/listing-performance-cadence.js', () => ({
  shouldRunListingPerformanceUpdate: shouldRunListingPerformanceUpdateMock,
}));
vi.mock('../../src/scheduler/jobs/registrar-health-check-job.js', () => ({
  runRegistrarHealthCheck: runRegistrarHealthCheckMock,
}));
vi.mock('../../src/scheduler/registrar-health-check-cadence.js', () => ({
  shouldRunRegistrarHealthCheck: shouldRunRegistrarHealthCheckMock,
}));
vi.mock('../../src/services/registrar-reresolve.js', () => ({
  reresolveRegistrarIds: reresolveRegistrarIdsMock,
}));
vi.mock('../../src/scheduler/jobs/duplicate-sweep-job.js', () => ({
  runDuplicateSweepJob: runDuplicateSweepJobMock,
}));
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({
  runStageReconcilerJob: runStageReconcilerJobMock,
}));
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({
  runPrimaryDocBackfill: runPrimaryDocBackfillMock,
}));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({
  shouldRunOnCatchUpCadence: shouldRunOnCatchUpCadenceMock,
}));
vi.mock('../../src/services/deploy-drift-monitor.js', () => ({
  checkDeployDrift: checkDeployDriftMock,
  getMainShaFromOrigin: vi.fn(),
  getServedShaForSlot: vi.fn(),
}));
const evaluateFreshnessMock = vi.fn().mockResolvedValue([]);
const checkCrossSourceDisagreementsMock = vi.fn().mockResolvedValue({
  openIpoCount: 0,
  disagreements: [],
  highValueCount: 0,
  otherCount: 0,
});

vi.mock('../../src/services/freshness-monitor.js', () => ({
  evaluateFreshness: evaluateFreshnessMock,
}));
vi.mock('../../src/services/cross-source-disagreement-monitor.js', () => ({
  checkCrossSourceDisagreements: checkCrossSourceDisagreementsMock,
}));
vi.mock('@ipodhan/shared', () => ({
  db: {
    delete: () => ({
      where: () => ({
        returning: dbReturningMock,
      }),
    }),
  },
  getRedisClient: () => ({}),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
  scraperSteps: {},
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
}));

describe('scraper/src/index.ts one-shot --source=all path (deploy-drift-monitor wiring)', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldRunOnCatchUpCadenceMock.mockResolvedValue(true);
    checkDeployDriftMock.mockResolvedValue([]);
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    process.env.ADMIN_API_TOKEN = 'test-admin-token'; // T-340: main() now refuses to start --source=all without this key
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
  });

  it('calls checkDeployDrift on every full scrape cycle when the cadence guard says yes', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(shouldRunOnCatchUpCadenceMock).toHaveBeenCalledWith(expect.anything(), 'deploy-drift-monitor', 60);
    expect(checkDeployDriftMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('skips checkDeployDrift when the cadence guard says no (hourly throttle)', async () => {
    shouldRunOnCatchUpCadenceMock.mockImplementation(async (_r: unknown, jobName: string) => jobName !== 'deploy-drift-monitor');

    const { main } = await import('../../src/index.js');
    await main();

    expect(checkDeployDriftMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not fail the scrape run when checkDeployDrift throws (non-fatal side effect)', async () => {
    checkDeployDriftMock.mockRejectedValueOnce(new Error('git ls-remote failed'));

    const { main } = await import('../../src/index.js');
    await main();

    expect(checkDeployDriftMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does NOT call checkDeployDrift for a single-source invocation (only source === "all")', async () => {
    process.argv = [...originalArgv.slice(0, 2), '--source=nse'];

    const { main } = await import('../../src/index.js');
    await main();

    expect(checkDeployDriftMock).not.toHaveBeenCalled();
  });
});
