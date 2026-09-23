/**
 * Item 7 S1 round 1 (Tier A finding, spec docs/design/data-sourcing-pull-model.md
 * §2.1 job table: the live-figures job must "never touch a document, a field
 * plan row, or any static field"). The live job reuses the NSE/BSE orchestrator
 * for its subscription read; before this fix every OPEN record also went through
 * the ipos write door (consolidatedUpsertIPO / upsertIPO), recorded document
 * hints, and an unknown OPEN record created a new ipos row.
 *
 * Class: any write from the live-figures job other than the live-figure tables,
 * for every OPEN IPO, every segment, both exchanges (NSE and BSE share this
 * base class, so one path covers both). Driven through the REAL run() /
 * processIPO path with only the persistence edges mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertIPOMock = vi.fn(async (_repo: unknown, data: any) => `id-${data.companyName}`);
const resolveIpoRowMock = vi.fn();
const consolidatedUpsertIPOMock = vi.fn(async (data: any) => ({ skipped: false, ipoId: `id-${data.companyName}`, isNew: false }));
const recordDocumentSourceHintsMock = vi.fn(async (..._a: unknown[]) => undefined);
const createSubscriptionSnapshotMock = vi.fn(async (..._a: unknown[]) => 'snap-1');
const isIPOLockedMock = vi.fn(async (_id: unknown) => false);

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
    isIPOLocked: (id: unknown) => isIPOLockedMock(id),
    isFieldProtected: vi.fn().mockResolvedValue({ isProtected: false }),
    filterProtectedFields: vi.fn(async (_id: string, _table: string, data: unknown) => ({ filtered: data })),
  }),
  resolveIpoRow: (...args: unknown[]) => resolveIpoRowMock(...args),
}));

vi.mock('../../src/services/data-persister.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/data-persister.js')>()),
  upsertIPO: upsertIPOMock,
  recordDocumentSourceHints: (...a: unknown[]) => recordDocumentSourceHintsMock(...a),
  createSubscriptionSnapshot: (...a: unknown[]) => createSubscriptionSnapshotMock(...a),
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
    consolidatedUpsertIPO: (data: any) => consolidatedUpsertIPOMock(data),
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

const ROWS: Record<string, { id: string; slug: string; status: string } | null> = {
  'Open Mainboard Ltd': { id: 'row-open-mb', slug: 'open-mainboard-ltd', status: 'OPEN' },
  'Open Sme Ltd': { id: 'row-open-sme', slug: 'open-sme-ltd', status: 'OPEN' },
  'Upcoming Ltd': { id: 'row-upcoming', slug: 'upcoming-ltd', status: 'UPCOMING' },
  'Unknown Open Ltd': null, // an OPEN record the data job has not discovered yet
};

async function runOrchestrator(opts: { liveFiguresOnly: boolean; source?: 'NSE' | 'BSE' }) {
  const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');
  const source = opts.source ?? 'NSE';

  class LiveTestOrchestrator extends BaseScraperOrchestrator<any, any> {
    protected getScraperName() {
      return source;
    }
    protected async scrapeData() {
      return {
        ipos: Object.keys(ROWS).map((companyName) => ({ companyName })),
        subscriptions: Object.keys(ROWS).map((companyName) => ({ ipoCompanyName: companyName, totalSubscription: 3.2 })),
      };
    }
    protected validateIPO(ipo: any) {
      // Every scraped record claims OPEN and carries a verifier URL and a static
      // field, so without the guard each one reaches the write door and the hint writer.
      return {
        success: true,
        data: {
          companyName: ipo.companyName,
          status: 'OPEN',
          segment: ipo.companyName.includes('Sme') ? 'SME' : 'MAINBOARD',
          verifierUrl: 'https://www.nseindia.com/ipo/x',
          issueSize: 999,
        },
      };
    }
    protected validateSubscription(sub: any) {
      return { success: true, data: sub };
    }
  }

  const orchestrator = new LiveTestOrchestrator();
  (orchestrator as any).restrictToStatuses(['OPEN']);
  if (opts.liveFiguresOnly) (orchestrator as any).liveFiguresOnlyMode();
  return orchestrator.run();
}

const snapshotRowIds = () => createSubscriptionSnapshotMock.mock.calls.map((c) => c[1] as string).sort();

describe('BaseScraperOrchestrator — liveFiguresOnly mode (item 7 S1 round 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isIPOLockedMock.mockImplementation(async () => false);
    resolveIpoRowMock.mockImplementation(async (_repo: unknown, params: any) => ROWS[params.companyName] ?? null);
  });

  for (const source of ['NSE', 'BSE'] as const) {
    it(`${source}: writes the subscription snapshot for every existing OPEN row and NOTHING else`, async () => {
      const result = await runOrchestrator({ liveFiguresOnly: true, source });

      expect(consolidatedUpsertIPOMock).not.toHaveBeenCalled();
      expect(upsertIPOMock).not.toHaveBeenCalled();
      expect(recordDocumentSourceHintsMock).not.toHaveBeenCalled();
      expect(snapshotRowIds()).toEqual(['row-open-mb', 'row-open-sme']);
      expect(result.iposInserted).toBe(0);
      expect(result.iposUpdated).toBe(0);
      expect(result.subscriptionsCreated).toBe(2);
      expect(result.success).toBe(true);
    }, 20000);
  }

  it('an OPEN record with no existing row is never created, and is NAMED in the run summary line', async () => {
    const loggerModule = await import('../../src/utils/logger.js');
    const infoSpy = vi.spyOn(loggerModule.default, 'info');
    await runOrchestrator({ liveFiguresOnly: true });

    expect(upsertIPOMock).not.toHaveBeenCalled();
    expect(consolidatedUpsertIPOMock).not.toHaveBeenCalled();
    const summary = infoSpy.mock.calls.find((c) => (c[0] as any)?.liveFiguresOnly === true);
    expect(summary?.[0]).toMatchObject({ unmatchedCount: 1, unmatched: ['Unknown Open Ltd'], unmatchedTruncated: false });
    infoSpy.mockRestore();
  }, 20000);

  it('a row whose STORED status is not OPEN gets no snapshot even when the source says OPEN', async () => {
    await runOrchestrator({ liveFiguresOnly: true });
    expect(snapshotRowIds()).not.toContain('row-upcoming');
  }, 20000);

  it('a locked IPO gets no live write', async () => {
    isIPOLockedMock.mockImplementation(async (id: unknown) => id === 'row-open-mb');
    await runOrchestrator({ liveFiguresOnly: true });
    expect(snapshotRowIds()).toEqual(['row-open-sme']);
  }, 20000);

  it('data job unchanged: WITHOUT the mode the same records reach the write door, record hints and create the unknown OPEN row', async () => {
    const result = await runOrchestrator({ liveFiguresOnly: false });

    const writes = consolidatedUpsertIPOMock.mock.calls.length + upsertIPOMock.mock.calls.length;
    expect(writes).toBe(3); // two existing OPEN rows + the new OPEN row (#351 in-scope discovery)
    expect(recordDocumentSourceHintsMock).toHaveBeenCalled();
    expect(createSubscriptionSnapshotMock).toHaveBeenCalled();
    expect(result.iposInserted + result.iposUpdated).toBe(3);
  }, 20000);
});
