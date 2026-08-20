import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseGMP,
  parseGMPTimestamp,
  isParseRateHealthy,
  scrapeInvestorgainGMPs,
  financialYearLabel,
  readPrice,
} from '../../../src/scrapers/investorgain-gmp-scraper.js';

/**
 * Unit tests for the InvestorGain GMP scraper hardening (G3/G4/G6).
 * Covers: parse resilience, parse-rate guard, year-boundary timestamp, SME fetch.
 */

function apiRecord(over: Record<string, unknown> = {}) {
  return {
    '~id': 1,
    '~ipo_name': 'Acme Industries',
    'Name': '<a>Acme</a>',
    'GMP': '&#8377;<b>110</b> (10.33%)',
    '~gmp_percent_calc': '10.33',
    'Price': '1065',
    'Updated-On': "<small><b>18-Oct 7:33</b></small>",
    'Open': '15-Oct',
    'Close': '17-Oct',
    'Listing': '24-Oct',
    '~Srt_Open': '2026-10-15',
    '~Srt_Close': '2026-10-17',
    '~Str_Listing': '2026-10-24',
    '~urlrewrite_folder_name': '/gmp/acme-industries/1501/',
    '~IPO_Category': 'IPO',
    'IPO Size': '451.00 ',
    'Sub': '92.36x',
    ...over,
  };
}

describe('parseGMP — resilience to markup drift (G4)', () => {
  it('parses the value inside the <b> tag', () => {
    expect(parseGMP('&#8377;<b>110</b> (10.33%)')).toBe(110);
    expect(parseGMP('&#8377;<b>-3</b> (-2.22%)')).toBe(-3);
  });

  it('returns null for the "--" no-GMP placeholder, not 0', () => {
    expect(parseGMP('&#8377;<b>--</b> (0.00%)')).toBeNull();
  });

  it('returns null for empty/undefined input', () => {
    expect(parseGMP('')).toBeNull();
    // @ts-expect-error testing defensive path
    expect(parseGMP(undefined)).toBeNull();
  });

  it('still extracts the GMP (not the %) when the <b> wrapper is dropped (markup drift)', () => {
    // wrapper gone but value present — fallback must grab 110, never the 10.33%
    expect(parseGMP('₹110 (10.33%)')).toBe(110);
  });
});

describe('parseGMPTimestamp — year inference across the Dec→Jan boundary (G6)', () => {
  it('keeps the current year for an in-range date', () => {
    const now = new Date(2026, 9, 18, 12, 0, 0); // 18-Oct-2026
    const d = parseGMPTimestamp('<small><b>18-Oct 7:33</b></small>', now);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9); // Oct
    expect(d.getDate()).toBe(18);
  });

  it('rolls a 31-Dec record back to the previous year when "now" is 1-Jan', () => {
    const now = new Date(2026, 0, 1, 8, 0, 0); // 1-Jan-2026
    const d = parseGMPTimestamp('<small><b>31-Dec 23:30</b></small>', now);
    // a current-year guess (31-Dec-2026) would be ~1yr in the FUTURE → must use 2025
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11); // Dec
    expect(d.getDate()).toBe(31);
  });

  it('falls back to "now" on unparseable input', () => {
    const now = new Date(2026, 5, 1, 0, 0, 0);
    expect(parseGMPTimestamp('garbage', now).getTime()).toBe(now.getTime());
  });
});

describe('isParseRateHealthy — loud failure on markup breakage (G4)', () => {
  it('is healthy when >=50% of fetched rows yield a GMP', () => {
    expect(isParseRateHealthy(10, 6)).toBe(true);
    expect(isParseRateHealthy(10, 5)).toBe(true);
  });
  it('is UNHEALTHY when <50% parse (markup likely broke)', () => {
    expect(isParseRateHealthy(10, 4)).toBe(false);
    expect(isParseRateHealthy(10, 0)).toBe(false);
  });
  it('treats an empty fetch as not-a-parse-failure (separate concern)', () => {
    expect(isParseRateHealthy(0, 0)).toBe(true);
  });
});

describe('scrapeInvestorgainGMPs — fetches mainboard AND SME (G3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the API for both ipo and sme categories and merges the rows', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      const isSme = url.endsWith('/sme') || url.includes('/sme');
      const rec = isSme
        ? apiRecord({ '~id': 2, '~ipo_name': 'Tiny SME', '~IPO_Category': 'SME', '~urlrewrite_folder_name': '/gmp/tiny-sme/9/' })
        : apiRecord();
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ msg: 1, sSearchWhere: '', reportTableData: [rec] }),
      } as any;
    });

    const result = await scrapeInvestorgainGMPs();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /\/ipo(\b|$)/.test(u))).toBe(true);
    expect(urls.some((u) => /\/sme(\b|$)/.test(u))).toBe(true);

    const names = result.gmps.map((g) => g.companyName);
    expect(names).toContain('Tiny SME'); // SME row was fetched, parsed, merged
    expect(result.gmps.length).toBeGreaterThanOrEqual(2);
  });

  it('raises a parse-rate failure when the markup breaks (no extractable GMP)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      const broken = Array.from({ length: 5 }, (_, i) =>
        apiRecord({ '~id': 100 + i, 'GMP': '<span>n/a</span>' }),
      );
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ msg: 1, sSearchWhere: '', reportTableData: broken }),
      } as any;
    });

    const result = await scrapeInvestorgainGMPs();
    expect(result.gmps.length).toBe(0);
    expect(result.errors.some((e) => /parse rate|parse-rate/i.test(e))).toBe(true);
  });
});

describe('financialYearLabel — India FY starts in April (T-228)', () => {
  it('maps Apr-Dec to the FY beginning that calendar year', () => {
    expect(financialYearLabel(new Date(2026, 3, 1))).toBe('2026-27');  // 1-Apr-2026
    expect(financialYearLabel(new Date(2026, 7, 20))).toBe('2026-27'); // 20-Aug-2026
    expect(financialYearLabel(new Date(2026, 11, 31))).toBe('2026-27');
  });

  it('maps Jan-Mar to the FY that began the PREVIOUS calendar year', () => {
    expect(financialYearLabel(new Date(2026, 0, 1))).toBe('2025-26');  // 1-Jan-2026
    expect(financialYearLabel(new Date(2026, 2, 31))).toBe('2025-26'); // 31-Mar-2026
  });

  it('zero-pads the second component across a century rollover', () => {
    expect(financialYearLabel(new Date(2099, 5, 1))).toBe('2099-00');
  });
});

describe('readPrice — tolerates the v1→v2 "Price" rename (T-228)', () => {
  it('reads the v2 "Price (₹)" column', () => {
    expect(readPrice({ 'Price (₹)': '988' } as any)).toBe('988');
  });

  it('falls back to the legacy "Price" column', () => {
    expect(readPrice({ 'Price': '1065' } as any)).toBe('1065');
  });

  it('returns an empty string when neither is present (never undefined)', () => {
    expect(readPrice({} as any)).toBe('');
  });
});

describe('scrapeInvestorgainGMPs — v2 endpoint + HTTP-200 error bodies (T-228)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the /v2/ path with the month in slot 3 and the category last', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ msg: 1, sSearchWhere: '', reportTableData: [apiRecord()] }),
    }) as any);

    await scrapeInvestorgainGMPs();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toContain('/cloud/v2/report/data-read/');
      // {reportId}/{page}/{month}/{year}/{fy}/{sort}/{category}
      expect(u).toMatch(/\/data-read\/331\/\d+\/\d{1,2}\/\d{4}\/\d{4}-\d{2}\/0\/(ipo|sme)\?/);
    }
  });

  it('parses the price from the renamed v2 column (not 0)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        msg: 1,
        sSearchWhere: '',
        // v2 record: no plain "Price" key at all
        reportTableData: [(() => { const r: any = apiRecord(); delete r['Price']; r['Price (₹)'] = '988'; return r; })()],
      }),
    }) as any);

    const result = await scrapeInvestorgainGMPs();
    expect(result.gmps.length).toBeGreaterThan(0);
    expect(result.gmps[0].price).toBe(988);
  });

  it('treats an HTTP-200 "API not found" body as a hard error, not an empty success', async () => {
    // This is the exact shape that hid the v1 retirement: ok=true, 200, error in the body.
    vi.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ msg: 'API not found', error: '/cloud/report/... API NOT FOUND' }),
    }) as any);

    // The failure path retries with real 1s/2s/4s backoff; drive it with fake
    // timers so the assertion is deterministic instead of racing wall-clock.
    vi.useFakeTimers();
    try {
      const pending = scrapeInvestorgainGMPs();
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.gmps.length).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => /unhealthy|not found/i.test(e))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
