import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P2-2 (T-287): every scrape cycle logged `success:false` + a level-50 error
 * even when the ONLY rejections were the Non-IPO Shape Guard correctly
 * refusing known InvIT/REIT rows (e.g. "Cube Highways Trust") — the guard
 * doing its job, not a genuine failure. This made the run-health signal
 * useless: real failures and expected rejections were indistinguishable.
 *
 * This test proves `BaseScraperOrchestrator.run()` now classifies a
 * validation failure carrying `error.expected === true` as a SKIP (not a
 * FAILED), so a cycle with only expected rejections reports `success:true`
 * and `iposFailed:0` — see `processIPO`'s validation branch and
 * `isExpectedRejection` in `utils/data-validation.ts`.
 *
 * Mocking follows the established pattern in
 * `base-scraper-orchestrator-degradation-wiring.test.ts`.
 */

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
  IPORepository: vi.fn().mockImplementation(() => ({})),
  SubscriptionRepository: vi.fn().mockImplementation(() => ({})),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({}),
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
    recordSuccess: vi.fn().mockResolvedValue(undefined),
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
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  },
}));

vi.mock('../../src/services/selector-degradation-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/selector-degradation-monitor.js')>();
  return {
    ...actual,
    evaluateAndRecordDegradation: vi.fn().mockResolvedValue({
      coldStart: true,
      degraded: false,
      reasons: [],
    }),
  };
});

describe('BaseScraperOrchestrator.run() — expected-rejection classification (P2-2, T-287)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a cycle with only expected (guard) rejections reports success:true, iposFailed:0, and skips instead of fails', async () => {
    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

    const rawIPOs = [
      { companyName: 'Cube Highways Trust' },
      { companyName: 'Raajmarg Infra Investment Trust' },
    ];

    class TestOrchestrator extends BaseScraperOrchestrator<any> {
      protected getScraperName() {
        return 'NSE' as const;
      }
      protected async scrapeData() {
        return { ipos: rawIPOs, subscriptions: [] };
      }
      protected validateIPO() {
        // Simulate the Non-IPO Shape Guard's expected rejection shape
        // (nse-scraper-orchestrator-v2.ts's validateIPO error return).
        return {
          success: false,
          error: {
            message: 'Critical validation errors: NON_IPO_TRUST_SHAPE',
            issues: [{ field: 'offeringType', rule: 'NON_IPO_TRUST_SHAPE', severity: 'ERROR', message: 'trust shape', expected: true }],
            expected: true,
          },
        };
      }
    }

    const orchestrator = new TestOrchestrator();
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.iposFailed).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.iposSkipped).toBe(2);
  }, 20000);

  it('a cycle with a genuine (non-expected) validation failure still reports success:false and counts it as failed', async () => {
    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

    const rawIPOs = [{ companyName: 'Some Ltd' }];

    class TestOrchestrator extends BaseScraperOrchestrator<any> {
      protected getScraperName() {
        return 'NSE' as const;
      }
      protected async scrapeData() {
        return { ipos: rawIPOs, subscriptions: [] };
      }
      protected validateIPO() {
        return {
          success: false,
          error: {
            message: 'Critical validation errors: LOT_SIZE_INVALID',
            issues: [{ field: 'lotSize', rule: 'LOT_SIZE_INVALID', severity: 'ERROR', message: 'lot size invalid' }],
            // no `expected` flag — a genuine data-quality bug
          },
        };
      }
    }

    const orchestrator = new TestOrchestrator();
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.iposFailed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.iposSkipped).toBe(0);
  }, 20000);
});
