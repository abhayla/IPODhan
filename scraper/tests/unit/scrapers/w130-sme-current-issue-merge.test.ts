/**
 * W-130 / W-131 — NSE current-issue SME rows must survive into the live
 * result, and the zero-yield anomaly must count only attachable snapshots.
 *
 * Root cause (verified on production, 2026-09-04, Qualiance International):
 * `/api/all-upcoming-issues?category=ipo` (fetchAllIPOs) only ever returns
 * mainboard (series EQ) rows - there is no SME variant of that list.
 * `/api/ipo-current-issue` (fetchCurrentIPOs) is the ONLY endpoint that
 * reports SME issues while they are live. `scrapeNSEAPI()` merged the
 * *subscription* fetched from fetchCurrentIPOs into the final result but
 * never merged its *IPO rows* - so an SME-only active window (Qualiance,
 * NSE Emerge, open 4-8 Sep) produced an IPO row + a subscription from
 * fetchCurrentIPOs (iposFound 1, subscriptionsFound 1) that both vanished
 * before the final NSE result reached the orchestrator (5 mainboard rows,
 * none OPEN) - so nothing reached the persister and a P1 zero-yield alert
 * fired even though NSE was actively reporting a live IPO.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const jsonResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      getSetCookie: () => ['nsit=abc; Path=/', 'nseappid=def; Path=/', 'bm_sv=ghi; Path=/'],
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const htmlResponse = () =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'text/html', getSetCookie: () => ['nsit=abc; Path=/', 'nseappid=def; Path=/', 'bm_sv=ghi; Path=/'] },
    json: async () => ({}),
    text: async () => '<html></html>',
  }) as unknown as Response;

const failResponse = (status = 500) =>
  ({
    ok: false,
    status,
    statusText: 'Server Error',
    headers: { get: () => null, getSetCookie: () => [] },
    json: async () => ({}),
    text: async () => '',
  }) as unknown as Response;

// Mainboard rows as served by /api/all-upcoming-issues?category=ipo - series
// EQ only, both still "Forthcoming" (there is no SME variant of this list).
const ALL_UPCOMING = [
  {
    companyName: 'Mainco One Limited',
    issueStartDate: '10-Sep-2026',
    issueEndDate: '12-Sep-2026',
    issuePrice: 'Rs.100 to Rs.110',
    series: 'EQ',
    status: 'Forthcoming',
    symbol: 'MAINCO1',
    issueSize: '1000000',
    noOfSharesOffered: '1000000',
  },
  {
    // This symbol is ALSO reported (live) by /api/ipo-current-issue below -
    // the dedup case: it must appear exactly once in the final result, and
    // the current-issue row (the live feed) must win.
    companyName: 'Dupco Limited',
    issueStartDate: '01-Sep-2026',
    issueEndDate: '03-Sep-2026',
    issuePrice: 'Rs.200 to Rs.210',
    series: 'EQ',
    status: 'Forthcoming',
    symbol: 'DUPCO',
    issueSize: '500000',
    noOfSharesOffered: '500000',
  },
];

// Current issues as served by /api/ipo-current-issue - carries the one SME
// row the upcoming list never will, plus the live (Active) view of DUPCO.
const CURRENT_ISSUES = [
  {
    companyName: 'Qualiance International Limited',
    issueStartDate: '04-Sep-2026',
    issueEndDate: '08-Sep-2026',
    issuePrice: 'Rs.90 to Rs.95',
    series: 'SME',
    status: 'Active',
    symbol: 'QUALIANCE',
    isBse: '1',
    noOfsharesBid: '12919000',
    noOfSharesOffered: '2543000',
    noOfTime: '5.08',
  },
  {
    companyName: 'Dupco Limited',
    issueStartDate: '01-Sep-2026',
    issueEndDate: '03-Sep-2026',
    issuePrice: 'Rs.200 to Rs.210',
    series: 'EQ',
    status: 'Active',
    symbol: 'DUPCO',
    noOfSharesOffered: '500000',
    noOfTime: '2.10',
  },
];

async function withNSEModule(fn: (mod: typeof import('../../../src/scrapers/nse-api-client.js')) => Promise<void>) {
  vi.resetModules();
  const mod = await import('../../../src/scrapers/nse-api-client.js');
  await fn(mod);
}

describe('W-130: scrapeNSEAPI merges current-issue IPO rows into the final result', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes('/api/ipo-active-category')) {
          // Force the fallback path so both rows resolve as EXCHANGE_ONLY -
          // this test is about IPO-row survival, not consolidation.
          return failResponse();
        }
        if (url.includes('/api/all-upcoming-issues')) {
          const parsed = new URL(url);
          if (parsed.searchParams.get('category') !== 'ipo') {
            return jsonResponse([]);
          }
          return jsonResponse(ALL_UPCOMING);
        }
        if (url.includes('/api/ipo-current-issue')) {
          return jsonResponse(CURRENT_ISSUES);
        }
        return htmlResponse();
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('(a) surfaces the SME current-issue row with status OPEN, segment SME, and its EXCHANGE_ONLY subscription', async () => {
    await withNSEModule(async ({ scrapeNSEAPI }) => {
      const promise = scrapeNSEAPI();
      await vi.runAllTimersAsync();
      const result = await promise;

      const qualiance = result.ipos.find(i => i.symbol === 'QUALIANCE');
      expect(qualiance).toBeDefined();
      expect(qualiance!.status).toBe('OPEN');
      expect(qualiance!.segment).toBe('SME');

      const sub = result.subscriptions.find(s => s.ipoSymbol === 'QUALIANCE');
      expect(sub).toBeDefined();
      expect(sub!.coverage).toBe('EXCHANGE_ONLY');
      expect(sub!.totalSubscription).toBeCloseTo(5.08, 6);
    });
  });

  it('(b) a symbol present in both the upcoming list and current-issue appears exactly once, with the live current-issue status winning', async () => {
    await withNSEModule(async ({ scrapeNSEAPI }) => {
      const promise = scrapeNSEAPI();
      await vi.runAllTimersAsync();
      const result = await promise;

      const dupcoRows = result.ipos.filter(i => i.symbol === 'DUPCO');
      expect(dupcoRows).toHaveLength(1);
      // The upcoming list said "Forthcoming" (-> UPCOMING); the live
      // current-issue feed says "Active" (-> OPEN) and must win.
      expect(dupcoRows[0].status).toBe('OPEN');
    });
  });

  it('every mainboard row from the upcoming list still survives untouched', async () => {
    await withNSEModule(async ({ scrapeNSEAPI }) => {
      const promise = scrapeNSEAPI();
      await vi.runAllTimersAsync();
      const result = await promise;

      const mainco1 = result.ipos.find(i => i.symbol === 'MAINCO1');
      expect(mainco1).toBeDefined();
      expect(mainco1!.status).toBe('UPCOMING');
    });
  });
});

describe('W-131: the zero-yield anomaly counts only ATTACHABLE subscriptions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does NOT raise an anomaly for an SME-only window with one active row and its attached EXCHANGE_ONLY snapshot', async () => {
    vi.doMock('../../../src/utils/logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    const notify = vi.fn();
    vi.doMock('../../../src/services/owner-notify.js', () => ({ notifyOwner: notify }));

    const { reportSubscriptionYield } = await import('../../../src/scrapers/nse-scraper.js');
    const logger = (await import('../../../src/utils/logger.js')).default as any;

    reportSubscriptionYield(
      {
        ipos: [
          {
            companyName: 'Qualiance International Limited',
            openDate: '2026-09-04',
            closeDate: '2026-09-08',
            listingExchange: 'NSE',
            segment: 'SME',
            offeringType: 'IPO',
            status: 'OPEN',
            symbol: 'QUALIANCE',
          } as any,
        ],
        subscriptions: [
          {
            ipoSymbol: 'QUALIANCE',
            totalSubscription: 5.08,
            coverage: 'EXCHANGE_ONLY',
          } as any,
        ],
      },
      'api'
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('DOES raise the anomaly for an active row with no attached subscription', async () => {
    vi.doMock('../../../src/utils/logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    const notify = vi.fn();
    vi.doMock('../../../src/services/owner-notify.js', () => ({ notifyOwner: notify }));

    const { reportSubscriptionYield } = await import('../../../src/scrapers/nse-scraper.js');
    const logger = (await import('../../../src/utils/logger.js')).default as any;

    reportSubscriptionYield(
      {
        ipos: [
          {
            companyName: 'Qualiance International Limited',
            openDate: '2026-09-04',
            closeDate: '2026-09-08',
            listingExchange: 'NSE',
            segment: 'SME',
            offeringType: 'IPO',
            status: 'OPEN',
            symbol: 'QUALIANCE',
          } as any,
        ],
        subscriptions: [],
      },
      'api'
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ openIPOs: 1, subscriptionsFound: 0 }),
      expect.stringContaining('ZERO-YIELD ANOMALY')
    );
    expect(notify).toHaveBeenCalled();
  });

  it('DOES raise the anomaly when a subscription exists but for a symbol that never made it into the final IPO list (the W-130 bug shape)', async () => {
    vi.doMock('../../../src/utils/logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    const notify = vi.fn();
    vi.doMock('../../../src/services/owner-notify.js', () => ({ notifyOwner: notify }));

    const { reportSubscriptionYield } = await import('../../../src/scrapers/nse-scraper.js');
    const logger = (await import('../../../src/utils/logger.js')).default as any;

    reportSubscriptionYield(
      {
        ipos: [
          {
            companyName: 'Qualiance International Limited',
            openDate: '2026-09-04',
            closeDate: '2026-09-08',
            listingExchange: 'NSE',
            segment: 'SME',
            offeringType: 'IPO',
            status: 'OPEN',
            symbol: 'QUALIANCE',
          } as any,
        ],
        // Orphan subscription for a symbol not present in `ipos` - this is
        // exactly what the pre-fix scrapeNSEAPI() produced. It must NOT be
        // counted as coverage for QUALIANCE.
        subscriptions: [
          { ipoSymbol: 'SOMEOTHER', totalSubscription: 1.2, coverage: 'EXCHANGE_ONLY' } as any,
        ],
      },
      'api'
    );

    expect(logger.error).toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });
});
