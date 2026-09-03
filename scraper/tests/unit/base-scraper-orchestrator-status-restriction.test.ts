/**
 * Round-3 H1 (Tier-A review of round 1): the `allowedStatuses` skip-gate — the
 * thing that stops the due-step live/aggregator refresh from creating rows or
 * touching CLOSED/LISTED IPOs — shipped with NO test at all. It is the only
 * guard between a status-restricted refresh and the write door.
 *
 * This drives four stored rows (UPCOMING / OPEN / LISTED / status-null) plus a
 * brand-new company through `run()` with `restrictToStatuses(['OPEN'])` and
 * asserts exactly one row reaches the write door and nothing is inserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertIPOMock = vi.fn(async (_repo: unknown, data: any) => `id-${data.companyName}`);
const resolveIpoRowMock = vi.fn();

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
  createFieldProtectionService: vi.fn().mockReturnValue({
    isIPOLocked: vi.fn().mockResolvedValue(false),
    filterProtectedFields: vi.fn(async (_id: string, _table: string, data: unknown) => ({ filtered: data })),
  }),
  resolveIpoRow: (...args: unknown[]) => resolveIpoRowMock(...args),
}));

vi.mock('../../src/services/data-persister.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/data-persister.js')>()),
  upsertIPO: upsertIPOMock,
  createSubscriptionSnapshot: vi.fn().mockResolvedValue(undefined),
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
  scraperFailureTracker: { recordSuccess: vi.fn(), recordFailure: vi.fn() },
}));

vi.mock('../../src/services/selector-degradation-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/selector-degradation-monitor.js')>();
  return {
    ...actual,
    evaluateAndRecordDegradation: vi.fn().mockResolvedValue({ coldStart: true, degraded: false, reasons: [] }),
  };
});

const ROWS: Record<string, { id: string; status: string | null } | null> = {
  'Upcoming Ltd': { id: 'row-upcoming', status: 'UPCOMING' },
  'Open Ltd': { id: 'row-open', status: 'OPEN' },
  'Listed Ltd': { id: 'row-listed', status: 'LISTED' },
  'Nullstatus Ltd': { id: 'row-null', status: null },
  'Brand New Ltd': null, // never seen before — must NOT be inserted
};

async function runRestricted(restrict: boolean) {
  const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

  class TestOrchestrator extends BaseScraperOrchestrator<any> {
    protected getScraperName() {
      return 'NSE' as const;
    }
    protected async scrapeData() {
      return { ipos: Object.keys(ROWS).map((companyName) => ({ companyName })), subscriptions: [] };
    }
    protected validateIPO(ipo: any) {
      return { success: true, data: { companyName: ipo.companyName, status: ROWS[ipo.companyName]?.status ?? 'UPCOMING' } };
    }
  }

  const orchestrator = new TestOrchestrator();
  if (restrict) (orchestrator as any).restrictToStatuses(['OPEN']);
  return orchestrator.run();
}

describe('BaseScraperOrchestrator — allowedStatuses skip-gate (round-3 H1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveIpoRowMock.mockImplementation(async (_repo: unknown, params: any) => ROWS[params.companyName] ?? null);
  });

  it('restrictToStatuses(["OPEN"]): only the OPEN row reaches the write door; the new company is never inserted', async () => {
    const result = await runRestricted(true);

    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const reachedWriteDoor = upsertIPOMock.mock.calls.map((call) => (call[1] as any).companyName);
    expect(reachedWriteDoor).toEqual(['Open Ltd']);
    expect(reachedWriteDoor).not.toContain('Brand New Ltd');
    // UPCOMING, LISTED, status-null and the new company: 4 skips.
    expect(result.iposSkipped).toBe(4);
    expect(result.iposInserted).toBe(0);
    expect(result.success).toBe(true);
  }, 20000);

  it('without the restriction, every row reaches the write door (proves the gate is what filters)', async () => {
    await runRestricted(false);

    expect(upsertIPOMock).toHaveBeenCalledTimes(5);
    expect(upsertIPOMock.mock.calls.map((call) => (call[1] as any).companyName)).toContain('Brand New Ltd');
  }, 20000);
});
