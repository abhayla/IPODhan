import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T-311 regression test: proves the one-shot production path
 * (`scraper/src/index.ts --source=all`, the ONLY scraper process PM2 runs --
 * see docs/monitoring/scrape-cadence-measurement.md) actually invokes the
 * duplicate sweep, the stage reconciler, and the primary-source discovery
 * consumer. Pre-fix, none of `triggerDuplicateSweep` / `triggerStageReconciler`
 * / `triggerPrimarySourceDiscovery` exist, and the entire tiered scheduler
 * (`scraper/src/scheduler/*`) that DEFINES these jobs is imported by nothing
 * PM2 runs (T-305 P2-7) -- this test fails against that pre-fix code the same
 * way index-registrar-health-check-wiring fails pre-T-300F.
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
const runRegistrarHealthCheckMock = vi.fn().mockResolvedValue({
  checked: 14,
  healthy: 14,
  newlyDead: [] as string[],
  stillDead: [] as string[],
});
const shouldRunRegistrarHealthCheckMock = vi.fn().mockReturnValue(false);
const reresolveRegistrarIdsMock = vi.fn().mockResolvedValue({
  candidates: 0,
  matched: 0,
  written: 0,
  unmatchedNames: [] as string[],
});
const runDuplicateSweepJobMock = vi.fn().mockResolvedValue({
  totalIpos: 0,
  clusters: 0,
  dupClusters: [] as unknown[],
  applied: false,
});
const runStageReconcilerJobMock = vi.fn().mockResolvedValue({
  totalIpos: 0,
  iposWithDueFetches: 0,
  dueByKind: {},
  byStage: {},
});
const runPrimaryDocBackfillMock = vi.fn().mockResolvedValue(undefined);
const shouldRunOnCatchUpCadenceMock = vi.fn().mockResolvedValue(true);
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
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
}));

describe('scraper/src/index.ts one-shot --source=all path (scheduler-jobs wiring)', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldRunOnCatchUpCadenceMock.mockResolvedValue(true);
    shouldRunListingPerformanceUpdateMock.mockReturnValue(false);
    shouldRunRegistrarHealthCheckMock.mockReturnValue(false);
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.ENABLE_STAGE_RECONCILER;
    delete process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
  });

  it('calls runDuplicateSweepJob in dry-run mode on every full scrape cycle when cadence allows', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(runDuplicateSweepJobMock).toHaveBeenCalledTimes(1);
    expect(runDuplicateSweepJobMock).toHaveBeenCalledWith({ dryRun: true });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('skips the duplicate sweep when the catch-up cadence guard says no', async () => {
    shouldRunOnCatchUpCadenceMock.mockImplementation(async (_r: unknown, jobName: string) =>
      jobName !== 'duplicate-sweep'
    );

    const { main } = await import('../../src/index.js');
    await main();

    expect(runDuplicateSweepJobMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not fail the run when runDuplicateSweepJob throws (non-fatal side effect)', async () => {
    runDuplicateSweepJobMock.mockRejectedValueOnce(new Error('DB timeout'));

    const { main } = await import('../../src/index.js');
    await main();

    expect(runDuplicateSweepJobMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does NOT call runStageReconcilerJob when ENABLE_STAGE_RECONCILER is unset (§GATE default OFF)', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(runStageReconcilerJobMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls runStageReconcilerJob in dry-run mode when ENABLE_STAGE_RECONCILER=true and cadence allows', async () => {
    process.env.ENABLE_STAGE_RECONCILER = 'true';

    const { main } = await import('../../src/index.js');
    await main();

    expect(runStageReconcilerJobMock).toHaveBeenCalledTimes(1);
    expect(runStageReconcilerJobMock).toHaveBeenCalledWith({ dryRun: true });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does NOT call runPrimaryDocBackfill when ENABLE_PRIMARY_SOURCE_DISCOVERY is unset (closes #213 dishonesty gap)', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(runPrimaryDocBackfillMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls runPrimaryDocBackfill with execute:true when ENABLE_PRIMARY_SOURCE_DISCOVERY=true and cadence allows', async () => {
    process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY = 'true';

    const { main } = await import('../../src/index.js');
    await main();

    expect(runPrimaryDocBackfillMock).toHaveBeenCalledTimes(1);
    expect(runPrimaryDocBackfillMock).toHaveBeenCalledWith({ execute: true });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not fail the run when runPrimaryDocBackfill throws (non-fatal side effect)', async () => {
    process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY = 'true';
    runPrimaryDocBackfillMock.mockRejectedValueOnce(new Error('NSE API timeout'));

    const { main } = await import('../../src/index.js');
    await main();

    expect(runPrimaryDocBackfillMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
