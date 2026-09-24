/**
 * Item 7 S4 (spec docs/design/data-sourcing-pull-model.md §2.1 job table,
 * "Opening-day check": "it writes identity and status, nothing else").
 * Review finding 2 (MAJOR): the check must never carry a price band, lot
 * size, issue size, subscription count or any other field through to the
 * `ipos` write door, even when the fetched row carries them.
 *
 * Class: any write from the opening-day check's discoveryOnly mode, for
 * every segment (MAINBOARD/SME), both exchanges (NSE and BSE share this
 * base class), a brand-new row and an existing row. Driven through the REAL
 * run() / processIPO path with only the persistence edges mocked, mirroring
 * base-scraper-orchestrator-live-figures-only.test.ts's harness shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertIPOMock = vi.fn(async (_repo: unknown, data: any) => `id-${data.companyName}`);
const resolveIpoRowMock = vi.fn();
const consolidatedUpsertIPOMock = vi.fn(async (data: any) => ({ skipped: false, ipoId: `id-${data.companyName}`, isNew: !ROWS[data.companyName] }));
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

// Review finding 2 class coverage: a brand-new row (no prior match) AND an
// existing row, both MAINBOARD and SME, both exchanges (via the `source`
// param the harness passes through).
const ROWS: Record<string, { id: string; slug: string; status: string } | null> = {
  'Existing Mainboard Ltd': { id: 'row-existing-mb', slug: 'existing-mainboard-ltd', status: 'UPCOMING' },
  'Existing Sme Ltd': { id: 'row-existing-sme', slug: 'existing-sme-ltd', status: 'UPCOMING' },
  'Brand New Ltd': null,
};

async function runOrchestrator(opts: { discoveryOnly: boolean; source?: 'NSE' | 'BSE' }) {
  const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');
  const source = opts.source ?? 'NSE';

  class DiscoveryTestOrchestrator extends BaseScraperOrchestrator<any, any> {
    protected getScraperName() {
      return source;
    }
    protected async scrapeData() {
      return {
        ipos: Object.keys(ROWS).map((companyName) => ({ companyName })),
        subscriptions: [],
      };
    }
    protected validateIPO(ipo: any) {
      // Every scraped record carries a full payload — price band, lot size,
      // issue size, registrar — exactly what a real NSE/BSE list row can
      // include. Without the guard every one of these reaches the write door.
      return {
        success: true,
        data: {
          companyName: ipo.companyName,
          status: 'OPEN',
          segment: ipo.companyName.includes('Sme') ? 'SME' : 'MAINBOARD',
          offeringType: 'IPO',
          openDate: '2026-09-24',
          closeDate: '2026-09-28',
          symbol: 'BRNW',
          isin: 'INE000X01011',
          verifierUrl: 'https://www.nseindia.com/ipo/x',
          issueSize: 999,
          priceRangeMin: 100,
          priceRangeMax: 110,
          lotSize: 100,
          faceValue: 10,
          registrar: 'Some Registrar Pvt Ltd',
          leadManagers: ['Some Bank'],
          sector: 'IT',
          cin: 'U12345MH2026PLC000001',
        },
      };
    }
    protected validateSubscription(sub: any) {
      return { success: true, data: sub };
    }
  }

  const orchestrator = new DiscoveryTestOrchestrator();
  if (opts.discoveryOnly) (orchestrator as any).discoveryOnlyMode();
  return orchestrator.run();
}

describe('BaseScraperOrchestrator — discoveryOnly mode (item 7 S4, OD-31, review finding 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isIPOLockedMock.mockImplementation(async () => false);
    resolveIpoRowMock.mockImplementation(async (_repo: unknown, params: any) => ROWS[params.companyName] ?? null);
  });

  // FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION is env-gated and false by default
  // in this test process, so processIPO takes the fallback `upsertIPO(...)`
  // path (BaseScraperOrchestrator.ts Step 5) rather than
  // `consolidatedUpsertIPO`. `filteredIPOData` — the narrowed payload this
  // test asserts on — is identical on both paths (it is built once, above
  // the branch), so reading it off whichever mock actually fired covers the
  // real write door in either configuration.
  const capturedPayloads = () => [
    ...consolidatedUpsertIPOMock.mock.calls.map((c) => c[0] as Record<string, unknown>),
    ...upsertIPOMock.mock.calls.map((c) => c[1] as Record<string, unknown>),
  ];

  for (const source of ['NSE', 'BSE'] as const) {
    it(`${source}: writes ONLY identity + status + dates for a brand-new AND an existing row (MAINBOARD + SME)`, async () => {
      await runOrchestrator({ discoveryOnly: true, source });

      const payloads = capturedPayloads();
      expect(payloads).toHaveLength(3);
      for (const payload of payloads) {
        // Identity (companyName/symbol/isin/segment/offeringType) + status +
        // the two date columns — spec finding 2's exact allow-list.
        expect(Object.keys(payload).sort()).toEqual(
          ['closeDate', 'companyName', 'isin', 'offeringType', 'openDate', 'segment', 'status', 'symbol'].sort()
        );
        // The explicit non-goal: none of the excluded (non-identity,
        // non-status, non-date) fields ever reach the write door, even
        // though validateIPO() above supplied every one.
        for (const excluded of ['issueSize', 'priceRangeMin', 'priceRangeMax', 'lotSize', 'faceValue', 'registrar', 'leadManagers', 'sector', 'cin', 'verifierUrl']) {
          expect(payload).not.toHaveProperty(excluded);
        }
      }
      // Never the subscription/document write doors either.
      expect(createSubscriptionSnapshotMock).not.toHaveBeenCalled();
      expect(recordDocumentSourceHintsMock).not.toHaveBeenCalled();
    }, 20000);
  }

  it('data job unchanged: WITHOUT discoveryOnly the same records carry every field through to the write door', async () => {
    await runOrchestrator({ discoveryOnly: false });

    const anyCallHasIssueSize = capturedPayloads().some((payload) => 'issueSize' in payload);
    expect(anyCallHasIssueSize).toBe(true);
  }, 20000);
});
