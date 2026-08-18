import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T-195 fix-round regression test (checker finding item 3): proves that
 * `BaseScraperOrchestrator.run()` — the template method EVERY concrete
 * scraper orchestrator inherits — actually invokes the selector-degradation
 * evaluator (`evaluateAndRecordDegradation`) once per scrape, with the
 * per-source sample computed from this run's raw scraped records.
 *
 * Pre-fix (wiring hunk reverted), `evaluateAndRecordDegradation` is never
 * called from `run()` and this test fails the same way
 * `index-watchdog-wiring.test.ts` fails against its own pre-fix state.
 *
 * Mocking follows the established pattern in
 * `tests/unit/index-watchdog-wiring.test.ts`: every module BaseScraperOrchestrator
 * imports is vi.mock'd so `run()` can execute end-to-end without a real DB/Redis.
 */

const scraperLogCreateMock = vi.fn().mockResolvedValue({});
const metricsRecordSuccessMock = vi.fn().mockResolvedValue(undefined);
const failureTrackerRecordSuccessMock = vi.fn();
const evaluateAndRecordDegradationMock = vi.fn().mockResolvedValue({
  coldStart: true,
  degraded: false,
  reasons: [],
});

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
  IPORepository: vi.fn().mockImplementation(() => ({})),
  SubscriptionRepository: vi.fn().mockImplementation(() => ({})),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({
    create: scraperLogCreateMock,
    getRecentLogs: vi.fn().mockResolvedValue([]),
  })),
  FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
  DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
  createFieldProtectionService: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({
    invalidateAfterScrape: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/scraper-metrics-tracker.js', () => ({
  ScraperMetricsTracker: vi.fn().mockImplementation(() => ({
    recordSuccess: metricsRecordSuccessMock,
    recordFailure: vi.fn().mockResolvedValue(undefined),
    shouldSendAlert: vi.fn().mockResolvedValue({ sendAlert: false, reason: null }),
    getMetrics: vi.fn().mockResolvedValue({ success: 0, failure: 0, rate: 100 }),
    getConsecutiveFailures: vi.fn().mockResolvedValue(0),
    markAlertSent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/alerting-service.js', () => ({
  AlertingService: vi.fn().mockImplementation(() => ({
    getRecentErrors: vi.fn().mockReturnValue([]),
    sendAlert: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/data-consolidation-orchestrator.js', () => ({
  DataConsolidationOrchestrator: vi.fn().mockImplementation(() => ({
    consolidatedUpsertIPO: vi.fn(),
  })),
}));

vi.mock('../../src/services/scraper-failure-tracker.js', () => ({
  scraperFailureTracker: {
    recordSuccess: failureTrackerRecordSuccessMock,
    recordFailure: vi.fn(),
  },
}));

vi.mock('../../src/services/selector-degradation-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/selector-degradation-monitor.js')>();
  return {
    ...actual,
    // Keep computeBlankFieldStats real (pure function) so the test asserts
    // the actual per-source sample, not a stubbed value.
    computeBlankFieldStats: actual.computeBlankFieldStats,
    evaluateAndRecordDegradation: evaluateAndRecordDegradationMock,
  };
});

describe('BaseScraperOrchestrator.run() — selector-degradation wiring (T-195 checker finding item 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scraperLogCreateMock.mockResolvedValue({});
    metricsRecordSuccessMock.mockResolvedValue(undefined);
    evaluateAndRecordDegradationMock.mockResolvedValue({
      coldStart: true,
      degraded: false,
      reasons: [],
    });
  });

  it('invokes evaluateAndRecordDegradation once per run, with this run\'s redis client, source name, and computed blank-field sample', async () => {
    // Explicit timeout: this test transforms BaseScraperOrchestrator's full
    // import graph (repositories, consolidation orchestrator, alerting, etc.)
    // via vi.mock — under full-suite parallel load (many scraper test files
    // running concurrently) that transform can exceed the 5000ms default,
    // even though the mocked run() itself completes in ~1s standalone.
    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

    const rawIPOs = [
      { companyName: 'Acme Ltd', gmp: null, issuePrice: '' },
      { companyName: 'Beta Corp', gmp: 42, issuePrice: '100' },
    ];

    class TestOrchestrator extends BaseScraperOrchestrator<any> {
      protected getScraperName() {
        return 'NSE' as const;
      }
      protected async scrapeData() {
        return { ipos: rawIPOs, subscriptions: [] };
      }
      protected validateIPO() {
        // Fail validation for every IPO so run() never needs to touch
        // ipoRepository/fieldProtectionService — keeps this test scoped to
        // the degradation-wiring path per the checker's finding, not a
        // full processIPO integration test.
        return { success: false, error: { issues: ['stubbed failure'] } };
      }
    }

    const orchestrator = new TestOrchestrator();
    const result = await orchestrator.run();

    expect(evaluateAndRecordDegradationMock).toHaveBeenCalledTimes(1);
    expect(evaluateAndRecordDegradationMock).toHaveBeenCalledWith(
      expect.any(Object), // this.redis (the mocked getRedisClient() return value)
      'NSE',
      { rowCount: 2, blankFieldRate: 2 / 6 } // 2 blank values (null, '') out of 6 total field reads
    );
    expect(result.errors.length).toBe(2); // both IPOs failed validation as stubbed
  }, 20000);
});
