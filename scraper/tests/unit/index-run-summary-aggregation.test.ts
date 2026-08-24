import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../../src/utils/logger.js';

/**
 * T-309 checker finding (T-309C, item 3 half-untested): the run-summary
 * aggregation in `main()` (`scraper/src/index.ts`) folds `smeCount`/
 * `mainboardCount` from NSE/BSE/Moneycontrol/Chittorgarh into
 * `combinedResult`, but had NO test exercising the real aggregation path —
 * `base-scraper-orchestrator*.test.ts` (cited in SUMMARY.md as covering it)
 * never touches `index.ts` at all. This test drives `main()` with typed,
 * per-source mock results in, and asserts the combined counts out via the
 * final "Scraper execution completed" log call -- the same public surface
 * index-heartbeat-wiring.test.ts already exercises for other fields.
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

const runNSEScraperMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  smeCount: 0,
  mainboardCount: 0,
});
const runBSEScraperMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  iposMerged: 0,
  smeCount: 0,
  mainboardCount: 0,
});
const runMoneycontrolScraperMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  smeCount: 0,
  mainboardCount: 0,
});
const runChittorgarhScraperMock = vi.fn().mockResolvedValue({
  ...baseScraperResult,
  smeCount: 0,
  mainboardCount: 0,
});
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
vi.mock('../../src/scheduler/jobs/registrar-health-check-job.js', () => ({
  runRegistrarHealthCheck: vi.fn().mockResolvedValue({ checked: 0, healthy: 0, newlyDead: [], stillDead: [] }),
}));
vi.mock('../../src/scheduler/registrar-health-check-cadence.js', () => ({
  shouldRunRegistrarHealthCheck: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/services/registrar-reresolve.js', () => ({
  reresolveRegistrarIds: vi.fn().mockResolvedValue({ candidates: 0, matched: 0, written: 0, unmatchedNames: [] }),
}));
vi.mock('../../src/services/owner-notify.js', () => ({
  heartbeat: heartbeatMock,
  flushOwnerNotify: flushOwnerNotifyMock,
}));
vi.mock('../../src/services/freshness-monitor.js', () => ({
  evaluateFreshness: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/services/cross-source-disagreement-monitor.js', () => ({
  checkCrossSourceDisagreements: vi.fn().mockResolvedValue({
    openIpoCount: 0,
    disagreements: [],
    highValueCount: 0,
    otherCount: 0,
  }),
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
vi.mock('@ipodhan/shared/repositories', () => ({
  DataConflictsRepository: vi.fn().mockImplementation(() => ({
    pruneResolved: vi.fn().mockResolvedValue(0),
  })),
}));
vi.mock('@ipodhan/shared/db/schema', () => ({
  scraperLogs: { createdAt: 'created_at' },
}));
vi.mock('drizzle-orm', () => ({
  lt: vi.fn(),
}));

describe('scraper/src/index.ts run-summary aggregation (smeCount/mainboardCount)', () => {
  const originalArgv = process.argv;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = [...originalArgv.slice(0, 2), '--source=all'];
    delete process.env.ADMIN_API_TOKEN;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    loggerInfoSpy = vi.spyOn(logger, 'info');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    loggerInfoSpy.mockRestore();
  });

  function finalSummary() {
    const call = loggerInfoSpy.mock.calls.find(
      (c) => c[1] === 'Scraper execution completed'
    );
    if (!call) {
      throw new Error('"Scraper execution completed" log line was never emitted');
    }
    return call[0] as { smeCount: number; mainboardCount: number };
  }

  it('sums smeCount/mainboardCount across NSE + BSE + Moneycontrol + Chittorgarh, not BSE-only', async () => {
    runNSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, smeCount: 3, mainboardCount: 2 });
    runBSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, iposMerged: 0, smeCount: 1, mainboardCount: 5 });
    runMoneycontrolScraperMock.mockResolvedValueOnce({ ...baseScraperResult, smeCount: 2, mainboardCount: 0 });
    runChittorgarhScraperMock.mockResolvedValueOnce({ ...baseScraperResult, smeCount: 4, mainboardCount: 1 });

    const { main } = await import('../../src/index.js');
    await main();

    const summary = finalSummary();
    expect(summary.smeCount).toBe(3 + 1 + 2 + 4);
    expect(summary.mainboardCount).toBe(2 + 5 + 0 + 1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('zero-initializes combinedResult.smeCount/mainboardCount when every source reports zero (no NaN, no undefined leak)', async () => {
    const { main } = await import('../../src/index.js');
    await main();

    const summary = finalSummary();
    expect(summary.smeCount).toBe(0);
    expect(summary.mainboardCount).toBe(0);
    expect(Number.isNaN(summary.smeCount)).toBe(false);
    expect(Number.isNaN(summary.mainboardCount)).toBe(false);
  });

  it('a single-source run (--source=nse) reports only that source counts, not stale accumulation', async () => {
    process.argv = [...originalArgv.slice(0, 2), '--source=nse'];
    runNSEScraperMock.mockResolvedValueOnce({ ...baseScraperResult, smeCount: 7, mainboardCount: 9 });

    const { main } = await import('../../src/index.js');
    await main();

    const summary = finalSummary();
    expect(summary.smeCount).toBe(7);
    expect(summary.mainboardCount).toBe(9);
    expect(runBSEScraperMock).not.toHaveBeenCalled();
    expect(runMoneycontrolScraperMock).not.toHaveBeenCalled();
    expect(runChittorgarhScraperMock).not.toHaveBeenCalled();
  });
});
