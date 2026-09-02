import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipoStatusEnumMock } from '../helpers/schema-mock.js';

/**
 * T-300F regression test (fixing T-300C findings F1/F2): proves the one-shot
 * production path (`scraper/src/index.ts --source=all`, the ONLY scraper
 * process PM2 runs -- see docs/monitoring/scrape-cadence-measurement.md)
 * actually invokes the registrar health check AND the registrar_id
 * re-resolve pass. Pre-fix, both were only wired into `SchedulerService`
 * (`scheduler.ts` / `scheduler/jobs/update-statuses.ts`), which production
 * never imports (T-179/T-176 dead-path trap) -- this test fails against that
 * code because neither trigger exists / is wired into the `source === 'all'`
 * branch.
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
const shouldRunRegistrarHealthCheckMock = vi.fn().mockReturnValue(true);
const reresolveRegistrarIdsMock = vi.fn().mockResolvedValue({
  candidates: 0,
  matched: 0,
  written: 0,
  unmatchedNames: [] as string[],
});
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
  runDuplicateSweepJob: vi.fn().mockResolvedValue({ totalIpos: 0, clusters: 0, dupClusters: [], applied: false }),
}));
vi.mock('../../src/scheduler/jobs/stage-reconciler-job.js', () => ({
  runStageReconcilerJob: vi.fn().mockResolvedValue({ totalIpos: 0, iposWithDueFetches: 0, dueByKind: {}, byStage: {} }),
}));
vi.mock('../../src/scripts/backfill-primary-source-documents.js', () => ({
  runPrimaryDocBackfill: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/scheduler/catch-up-cadence.js', () => ({
  shouldRunOnCatchUpCadence: vi.fn().mockResolvedValue(true),
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
vi.mock('../../src/services/deploy-drift-monitor.js', () => ({
  checkDeployDrift: vi.fn().mockResolvedValue([]),
  getMainShaFromOrigin: vi.fn(),
  getServedShaForSlot: vi.fn(),
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
  ipoStatusEnum: ipoStatusEnumMock,
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
}));

describe('scraper/src/index.ts one-shot --source=all path (registrar wiring)', () => {
  const originalArgv = process.argv;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldRunListingPerformanceUpdateMock.mockReturnValue(false);
    shouldRunRegistrarHealthCheckMock.mockReturnValue(true);
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    // ADMIN_API_TOKEN must be set (T-340: main() now refuses to start --source=all
    // without it); fetch is globally stubbed below so triggerStatusUpdate still
    // never reaches the real network.
    process.env.ADMIN_API_TOKEN = 'test-admin-token'; // T-340: main() now refuses to start --source=all without this key
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
  });

  it('calls runRegistrarHealthCheck (via triggerRegistrarHealthCheck) on the full scrape cycle when the cadence guard says yes', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(shouldRunRegistrarHealthCheckMock).toHaveBeenCalledTimes(1);
    expect(runRegistrarHealthCheckMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('skips the health check (without failing the run) when the cadence guard says no', async () => {
    shouldRunRegistrarHealthCheckMock.mockReturnValue(false);

    const { main } = await import('../../src/index.js');
    await main();

    expect(shouldRunRegistrarHealthCheckMock).toHaveBeenCalledTimes(1);
    expect(runRegistrarHealthCheckMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not fail the scrape run when runRegistrarHealthCheck throws (non-fatal side effect)', async () => {
    runRegistrarHealthCheckMock.mockRejectedValueOnce(new Error('registrar site DNS failure'));

    const { main } = await import('../../src/index.js');
    await main();

    expect(runRegistrarHealthCheckMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls reresolveRegistrarIds (via triggerRegistrarReresolve) on every full scrape cycle', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(reresolveRegistrarIdsMock).toHaveBeenCalledTimes(1);
    expect(reresolveRegistrarIdsMock).toHaveBeenCalledWith({ dryRun: false });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not fail the scrape run when reresolveRegistrarIds throws (non-fatal side effect)', async () => {
    reresolveRegistrarIdsMock.mockRejectedValueOnce(new Error('DB connection reset'));

    const { main } = await import('../../src/index.js');
    await main();

    expect(reresolveRegistrarIdsMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
