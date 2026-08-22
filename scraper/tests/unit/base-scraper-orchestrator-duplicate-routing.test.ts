import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T-274 / GitHub #159 — orchestrator-level proof that a duplicate-matched
 * IPO actually REACHES `upsertIPO()`.
 *
 * The bug had two halves, both on `origin/main` before this fix:
 *
 * 1. `DataValidationPipeline` (production preset) either rejected a MEDIUM+
 *    duplicate match outright, or (after the GitHub #3 fix) skipped
 *    duplicate detection entirely — either way there was no route back to
 *    an update.
 * 2. `BaseScraperOrchestrator.run()` -> `processIPO()` treats
 *    `!validation.success` as a hard stop: it pushes an error and returns
 *    BEFORE `ipoRepository.findBySlug()` / `upsertIPO()` are ever called
 *    (see the early return right after Step 1 in `processIPO`).
 *
 * `tests/unit/pipelines/data-validation-pipeline.test.ts` covers half 1 in
 * isolation. This test covers the MECHANISM end-to-end at the orchestrator
 * boundary: when the production pipeline routes a duplicate match to
 * update (`shouldCreate: true`, `isUpdate: true`), the record must actually
 * flow through `processIPO()` into `upsertIPO()` — not just report success
 * without ever reaching the persister.
 *
 * Mocking follows the established pattern in
 * `tests/unit/base-scraper-orchestrator-degradation-wiring.test.ts`.
 */

const scraperLogCreateMock = vi.fn().mockResolvedValue({});
const metricsRecordSuccessMock = vi.fn().mockResolvedValue(undefined);
const failureTrackerRecordSuccessMock = vi.fn();
const findBySlugMock = vi.fn();
const upsertIPOMock = vi.fn().mockResolvedValue('ipo-123');
const isIPOLockedMock = vi.fn().mockResolvedValue(false);
const filterProtectedFieldsMock = vi.fn(async (_ipoId: string, _table: string, data: any) => ({
  filtered: data,
}));

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
  IPORepository: vi.fn().mockImplementation(() => ({
    findBySlug: findBySlugMock,
  })),
  SubscriptionRepository: vi.fn().mockImplementation(() => ({})),
  ScraperLogRepository: vi.fn().mockImplementation(() => ({
    create: scraperLogCreateMock,
    getRecentLogs: vi.fn().mockResolvedValue([]),
  })),
  FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
  DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
  createFieldProtectionService: vi.fn().mockReturnValue({
    isIPOLocked: isIPOLockedMock,
    filterProtectedFields: filterProtectedFieldsMock,
    isFieldProtected: vi.fn().mockResolvedValue({ isProtected: false }),
  }),
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
    evaluateAndRecordDegradation: vi.fn().mockResolvedValue({ coldStart: true, degraded: false, reasons: [] }),
  };
});

// This is the one under direct scrutiny: the record must reach upsertIPO().
vi.mock('../../src/services/data-persister.js', () => ({
  upsertIPO: upsertIPOMock,
  createSubscriptionSnapshot: vi.fn().mockResolvedValue(null),
  normalizeCompanyNameForMatching: (name: string) => name.trim().toLowerCase(),
}));

describe('BaseScraperOrchestrator.run() — duplicate-matched IPO reaches upsertIPO (#159)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scraperLogCreateMock.mockResolvedValue({});
    metricsRecordSuccessMock.mockResolvedValue(undefined);
    upsertIPOMock.mockResolvedValue('ipo-123');
    isIPOLockedMock.mockResolvedValue(false);
    filterProtectedFieldsMock.mockImplementation(async (_ipoId: string, _table: string, data: any) => ({
      filtered: data,
    }));
  });

  it('a MEDIUM+ duplicate match routed by the production pipeline (isUpdate:true) reaches upsertIPO — never silently dropped', async () => {
    const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');
    const { PipelineFactory } = await import('../../src/pipelines/data-validation-pipeline.js');

    const existingIPO = { id: 'existing-ipo-1', companyName: 'Clay Craft India Limited' };
    findBySlugMock.mockResolvedValue(existingIPO);

    const validationPipeline = PipelineFactory.createProductionPipeline({} as any);
    // Stub the pipeline's own DB-backed duplicate lookup so this test never
    // touches a real database — same technique as the pipeline unit test.
    const dupSpy = vi.fn().mockResolvedValue({
      isDuplicate: true,
      confidence: 'MEDIUM',
      matchReason: `Company name "Clay Craft India Limited" closely matches existing IPO: "${existingIPO.companyName}".`,
      matchType: 'FUZZY_NAME',
      existingIPO,
    });
    (validationPipeline as any).duplicateService.checkForDuplicates = dupSpy;

    const scrapedIPO = {
      companyName: 'Clay Craft India Limited',
      lotSize: 600,
      segment: 'SME' as const,
      offeringType: 'IPO' as const,
      priceRangeMin: 193,
      priceRangeMax: 203,
      issueSize: 54.24,
      symbol: 'CLAYCRAFT',
      isin: 'INE0XYZ01234',
      openDate: '2026-06-16',
      closeDate: '2026-06-18',
      status: 'OPEN',
    };

    class TestOrchestrator extends BaseScraperOrchestrator<any> {
      protected getScraperName() {
        return 'NSE' as const;
      }
      protected async scrapeData() {
        return { ipos: [scrapedIPO], subscriptions: [] };
      }
      protected async validateIPO(ipo: any) {
        // Mirrors nse-scraper-orchestrator-v2.ts's real validateIPO: run the
        // production pipeline first, reject only if it says not to create.
        const pipelineResult = await validationPipeline.validateAndProcess(ipo, 'NSE');
        if (!pipelineResult.shouldCreate) {
          return { success: false, error: { message: pipelineResult.reason } };
        }
        return { success: true, data: ipo };
      }
    }

    const orchestrator = new TestOrchestrator();
    const result = await orchestrator.run();

    // Duplicate detection must actually run (pre-fix, the production preset
    // skipped it entirely, so this record's route never depended on the
    // duplicate match at all).
    expect(dupSpy).toHaveBeenCalledTimes(1);

    // The mechanism: a duplicate-matched IPO must reach upsertIPO — the
    // pre-fix behavior returned before findBySlug/upsertIPO were ever called.
    expect(findBySlugMock).toHaveBeenCalledTimes(1);
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    expect(upsertIPOMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyName: 'Clay Craft India Limited',
    }), 'NSE');

    // Never silently dropped: no failures, no errors, counted as an update
    // (findBySlug resolved an existing row).
    expect(result.iposFailed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.iposUpdated).toBe(1);
  }, 20000);
});
