import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T-195 regression test: proves the one-shot production path
 * (`scraper/src/index.ts --source=all`, the ONLY scraper process PM2 runs --
 * see docs/monitoring/scrape-cadence-measurement.md) actually invokes the
 * data-quality watchdog core (freshness SLO evaluation + cross-source
 * disagreement report) once per cycle. Pre-fix, `triggerDataQualityWatchdog`
 * does not exist / is never wired into the `source === 'all'` branch -- this
 * test fails against that code the same way index-listing-performance-wiring
 * and index-heartbeat-wiring fail their respective pre-fix states.
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
const shouldRunListingPerformanceUpdateMock = vi.fn().mockReturnValue(true);
const dbReturningMock = vi.fn().mockResolvedValue([]);
const heartbeatMock = vi.fn();
const flushOwnerNotifyMock = vi.fn().mockResolvedValue(undefined);
const evaluateFreshnessMock = vi.fn().mockResolvedValue([]);
const checkCrossSourceDisagreementsMock = vi.fn().mockResolvedValue({
  openIpoCount: 0,
  disagreements: [],
  highValueCount: 0,
  otherCount: 0,
});

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
vi.mock('../../src/services/owner-notify.js', () => ({
  heartbeat: heartbeatMock,
  flushOwnerNotify: flushOwnerNotifyMock,
}));
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

describe('scraper/src/index.ts one-shot --source=all path -- data-quality watchdog (T-195)', () => {
  const originalArgv = process.argv;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    delete process.env.ADMIN_API_TOKEN;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
  });

  it('calls evaluateFreshness and checkCrossSourceDisagreements exactly once on the full scrape cycle', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(evaluateFreshnessMock).toHaveBeenCalledTimes(1);
    expect(checkCrossSourceDisagreementsMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('still runs checkCrossSourceDisagreements and completes the cycle when evaluateFreshness throws (non-fatal)', async () => {
    evaluateFreshnessMock.mockRejectedValueOnce(new Error('scraper_logs read failed'));

    const { main } = await import('../../src/index.js');
    await main();

    expect(evaluateFreshnessMock).toHaveBeenCalledTimes(1);
    expect(checkCrossSourceDisagreementsMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not fail the scrape run when checkCrossSourceDisagreements throws (non-fatal)', async () => {
    checkCrossSourceDisagreementsMock.mockRejectedValueOnce(new Error('DB unreachable'));

    const { main } = await import('../../src/index.js');
    await main();

    expect(checkCrossSourceDisagreementsMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does NOT run the watchdog for a single-source invocation (only source === "all")', async () => {
    process.argv = [...originalArgv.slice(0, 2), '--source=nse'];

    const { main } = await import('../../src/index.js');
    await main();

    expect(evaluateFreshnessMock).not.toHaveBeenCalled();
    expect(checkCrossSourceDisagreementsMock).not.toHaveBeenCalled();
  });
});
