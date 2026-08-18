import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T-194 regression test: proves the one-shot production path
 * (`scraper/src/index.ts --source=all`, the ONLY scraper process PM2 runs --
 * see docs/monitoring/scrape-cadence-measurement.md) actually invokes the
 * Notifier heartbeat with the interval that matches the MEASURED 30-min
 * cadence (not the undeployed IST-tier config). Pre-fix, this path never
 * called `heartbeat()` -- this test fails against that code the same way
 * index-listing-performance-wiring.test.ts fails T-179's revert.
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
vi.mock('@ipodhan/shared', () => ({
  db: {
    delete: () => ({
      where: () => ({
        returning: dbReturningMock,
      }),
    }),
  },
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
}));

describe('scraper/src/index.ts one-shot --source=all Notifier heartbeat wiring', () => {
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

  it('calls heartbeat("watchdog", 30) on the full scrape cycle -- 30min matches the MEASURED cadence, not a 15min config default', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock).toHaveBeenCalledWith('watchdog', 30);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('flushes in-flight Notifier sends before process.exit(0)', async () => {
    const { main } = await import('../../src/index.js');

    await main();

    expect(flushOwnerNotifyMock).toHaveBeenCalled();
    // flush must happen before exit, not after (exit ends the process)
    const flushCallOrder = flushOwnerNotifyMock.mock.invocationCallOrder[0];
    const exitCallOrder = exitSpy.mock.invocationCallOrder[0];
    expect(flushCallOrder).toBeLessThan(exitCallOrder);
  });

  it('still fires the heartbeat when a source failed (job-completion, not job-success)', async () => {
    runNSEScraperMock.mockResolvedValueOnce({
      ...baseScraperResult,
      success: false,
      errors: ['NSE fetch timed out'],
    });

    const { main } = await import('../../src/index.js');
    await main();

    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock).toHaveBeenCalledWith('watchdog', 30);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not fail the scrape run when heartbeat() throws (non-fatal side effect)', async () => {
    heartbeatMock.mockImplementationOnce(() => {
      throw new Error('unexpected Notifier client error');
    });

    const { main } = await import('../../src/index.js');
    await main();

    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not call heartbeat for a single-source run (--source=nse)', async () => {
    process.argv = [...originalArgv.slice(0, 2), '--source=nse'];

    const { main } = await import('../../src/index.js');
    await main();

    expect(heartbeatMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
