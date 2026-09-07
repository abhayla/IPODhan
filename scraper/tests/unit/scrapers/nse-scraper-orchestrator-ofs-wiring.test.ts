/**
 * T-478 (issue #225): the NSE OFS API endpoint (`fetchAllIPOs('ofs')`,
 * nse-api-client.ts ~line 1069) has been implemented since before this
 * fixture's capture date, but nothing in the live cadence ever called it —
 * so `/ofs` has been frozen at 19 rows since 2026-06-08. This test drives
 * the REAL `NSEScraperOrchestratorV2` (not a test double) through
 * `run()` with a real captured NSE payload, and asserts an
 * `offering_type='OFS'` row reaches the write door via the exact same
 * consolidation/priority path as every other NSE row.
 *
 * Fixture provenance: tests/fixtures/nse/ofs-ipo-shaped-unverified-2026-09-07.json —
 * UNVERIFIED-LIVE (round 2, issue #225 follow-up): this fixture's raw item is
 * IPO-shaped, not OFS-shaped — no real live OFS payload has ever been
 * captured/observed (category=ofs returned zero rows on capture day). The
 * NSE OFS wiring is gated behind ENABLE_NSE_OFS (default false) until a real
 * OFS book is observed on staging and its true payload shape captured — see
 * the follow-up issue linked from PR #362. —
 * `category=ofs` was fetched live on 2026-09-07 and genuinely returned zero
 * rows (itself real-data confirmation of the issue: no live OFS book exists
 * right now). The fixture's raw item was captured from the SAME live NSE
 * session/endpoint under `category=ipo` (identical payload schema — see the
 * fixture's `_fixtureNote`) and is run through the real `transformIPOData()`
 * with `category='ofs'`, exactly the transform `fetchAllIPOs('ofs')` applies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from '../../fixtures/nse/ofs-ipo-shaped-unverified-2026-09-07.json';

const upsertIPOMock = vi.fn(async (_repo: unknown, data: any) => `id-${data.companyName}`);
const resolveIpoRowMock = vi.fn(async () => null); // every row is brand-new for this test

const fetchAllIPOsMock = vi.fn();

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

vi.mock('../../../src/services/data-persister.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-persister.js')>()),
  upsertIPO: upsertIPOMock,
  createSubscriptionSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({
    invalidateAfterScrape: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/services/scraper-metrics-tracker.js', () => ({
  ScraperMetricsTracker: vi.fn().mockImplementation(() => ({
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    shouldSendAlert: vi.fn().mockResolvedValue({ sendAlert: false, reason: null }),
    getMetrics: vi.fn().mockResolvedValue({ success: 0, failure: 0, rate: 100 }),
    getConsecutiveFailures: vi.fn().mockResolvedValue(0),
    markAlertSent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/services/alerting-service.js', () => ({
  AlertingService: vi.fn().mockImplementation(() => ({
    getRecentErrors: vi.fn().mockReturnValue([]),
    sendAlert: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/services/data-consolidation-orchestrator.js', () => ({
  DataConsolidationOrchestrator: vi.fn().mockImplementation(() => ({
    consolidatedUpsertIPO: vi.fn(),
  })),
}));

vi.mock('../../../src/services/scraper-failure-tracker.js', () => ({
  scraperFailureTracker: { recordSuccess: vi.fn(), recordFailure: vi.fn() },
}));

vi.mock('../../../src/services/selector-degradation-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/selector-degradation-monitor.js')>();
  return {
    ...actual,
    evaluateAndRecordDegradation: vi.fn().mockResolvedValue({ coldStart: true, degraded: false, reasons: [] }),
  };
});

// The HTML "current issues" scrape never returns OFS rows (root cause #1 in
// the issue) — isolate the test to the OFS wiring path alone.
vi.mock('../../../src/scrapers/nse-scraper.js', () => ({
  scrapeNSEIPOs: vi.fn().mockResolvedValue({ ipos: [], subscriptions: [] }),
}));

// Real transformIPOData is used (imported un-mocked below); only fetchAllIPOs
// is replaced, so the wiring itself — not the transform — is under test.
vi.mock('../../../src/scrapers/nse-api-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/scrapers/nse-api-client.js')>()),
  fetchAllIPOs: fetchAllIPOsMock,
}));

// Duplicate detection needs no real DB for this test — every row is new.
vi.mock('../../../src/services/duplicate-detection-service.js', () => ({
  DuplicateDetectionService: vi.fn().mockImplementation(() => ({
    checkForDuplicates: vi.fn().mockResolvedValue({ isDuplicate: false }),
  })),
}));

describe('NSEScraperOrchestratorV2 — OFS wiring (T-478, issue #225)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveIpoRowMock.mockResolvedValue(null);
  });

  it('enableOFS(): fetchAllIPOs("ofs") result reaches the write door as offering_type=OFS, through the real validation pipeline', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    const ofsIpo = transformIPOData(fixture.rawItem, 'ofs');
    expect(ofsIpo.offeringType).toBe('OFS');

    fetchAllIPOsMock.mockResolvedValue({
      ipos: [ofsIpo],
      subscriptions: [],
      source: 'api',
      timestamp: new Date().toISOString(),
    });

    const { NSEScraperOrchestratorV2 } = await import('../../../src/scrapers/nse-scraper-orchestrator-v2.js');
    const orchestrator = new NSEScraperOrchestratorV2();
    orchestrator.enableOFS();

    const result = await orchestrator.run();

    expect(fetchAllIPOsMock).toHaveBeenCalledWith('ofs');
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const written = upsertIPOMock.mock.calls[0][1] as any;
    expect(written.companyName).toBe('Kanohar Electricals Limited');
    expect(written.offeringType).toBe('OFS');
    expect(result.iposInserted).toBe(1);
  }, 20000);

  it('without enableOFS(), fetchAllIPOs is never called — the OPEN-only "live" step and every other caller are unaffected (opt-in only)', async () => {
    fetchAllIPOsMock.mockResolvedValue({ ipos: [], subscriptions: [], source: 'api', timestamp: new Date().toISOString() });

    const { NSEScraperOrchestratorV2 } = await import('../../../src/scrapers/nse-scraper-orchestrator-v2.js');
    const orchestrator = new NSEScraperOrchestratorV2();
    // enableOFS() deliberately NOT called.
    const result = await orchestrator.run();

    expect(fetchAllIPOsMock).not.toHaveBeenCalled();
    expect(upsertIPOMock).not.toHaveBeenCalled();
    expect(result.iposInserted).toBe(0);
  }, 20000);

  it('an OFS row never takes the IPO-only NON_IPO_* shape guards (offering_type guard from T-329/#140-141 stays IPO-scoped)', async () => {
    // Shape modeled on the real guard-triggering rows documented in
    // data-validation.ts (ADVENZYMES/LIGHT OF LIFE TRUST): a >10-day window,
    // no lot size, no issue size. Under offeringType='IPO' this is REJECTED
    // by Rule 8 (NON_IPO_WINDOW_TOO_LONG); under 'OFS' it must NOT be.
    const longWindowNoSubstanceRaw = {
      companyName: 'Guard Probe Trust',
      issueStartDate: '01-Jan-2026',
      issueEndDate: '01-Apr-2026', // ~90 days
      issuePrice: '',
      issueSize: '',
      series: 'EQ',
      status: 'Active',
      symbol: 'GUARDPROBE',
    };

    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');

    const asIpo = transformIPOData(longWindowNoSubstanceRaw, 'ipo');
    expect(asIpo.offeringType).toBe('IPO');
    const asOfs = transformIPOData(longWindowNoSubstanceRaw, 'ofs');
    expect(asOfs.offeringType).toBe('OFS');

    const { validateIPOData } = await import('../../../src/utils/data-validation.js');
    const ipoValidation = validateIPOData(asIpo, 'NSE');
    expect(ipoValidation.valid).toBe(false); // guard fires for offeringType='IPO'

    fetchAllIPOsMock.mockResolvedValue({
      ipos: [asOfs],
      subscriptions: [],
      source: 'api',
      timestamp: new Date().toISOString(),
    });

    const { NSEScraperOrchestratorV2 } = await import('../../../src/scrapers/nse-scraper-orchestrator-v2.js');
    const orchestrator = new NSEScraperOrchestratorV2();
    orchestrator.enableOFS();
    const result = await orchestrator.run();

    // The IPO-only guard must NOT reject this row now that it is OFS.
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    expect((upsertIPOMock.mock.calls[0][1] as any).offeringType).toBe('OFS');
    expect(result.iposInserted).toBe(1);
  }, 20000);
});
