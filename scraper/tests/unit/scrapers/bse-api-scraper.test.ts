import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parsePriceBand,
  parseBSEDate,
  parseLeadManagers,
  computeBSEIssueSize,
  deriveBSEStatus,
  parseIssuePeriod,
  mapBSEToScrapedIPO,
  mapBSEDetailToScrapedIPO,
  scrapeBSEViaAPI,
  summarizeBSEApiResult,
  type BSEListRow,
  type BSEDetailRow,
  type BSEApiScrapeResult,
} from '../../../src/scrapers/bse-api-scraper.js';
import { validateIPOData } from '../../../src/utils/validators.js';

/** Real-shaped fixtures from the live BSE JSON API (Susan Electricals, IPO_NO 7770). */
const LIST_ROW: BSEListRow = {
  Scrip_name: 'SUSAN ELECTRICALS INDIA LIMITED',
  Start_Dt: '2026-06-11T00:00:00',
  End_Dt: '2026-06-15T00:00:00',
  Status: 'L',
  IR_flag: 'IPO',
  IR_FLAG_FULL: 'Book Building',
  IPO_NO: 7770,
  Scrip_cd: 4627,
};
const DETAIL_ROW: BSEDetailRow = {
  IPO_NO: '7770',
  ScripCode: '4627',
  ScripName: 'SUSAN ELECTRICALS INDIA LIMITED',
  Symbol: 'SUSAN',
  Issue_Period: '11 Jun 2026 to 15 Jun 2026',
  Issue_Size_No_of_shares: '4019000',
  Price_Band: '120.00-127.00',
  Face_Value: '10.00',
  Market_Lot: '1000',
  Minimum_Bid_Quantity: '1000',
  Registrar: 'Bigshare Services Pvt Ltd',
  Book_Running_Lead_Manager: 'Beeline Capital Advisors Pvt Ltd',
  Co_Book_Running_Lead_Manager: '',
};

describe('parsePriceBand', () => {
  it('parses "120.00-127.00" → {min:120, max:127}', () => {
    expect(parsePriceBand('120.00-127.00')).toEqual({ min: 120, max: 127 });
  });
  it('returns empty object for blank / fixed-price dash', () => {
    expect(parsePriceBand('')).toEqual({});
    expect(parsePriceBand('-')).toEqual({});
  });
  it('handles a single (fixed) price', () => {
    expect(parsePriceBand('95.00')).toEqual({ min: 95, max: 95 });
  });
});

describe('parseBSEDate', () => {
  it('takes the date part of an ISO-ish BSE date', () => {
    expect(parseBSEDate('2026-06-11T00:00:00')).toBe('2026-06-11');
  });
  it('returns null for empty', () => {
    expect(parseBSEDate('')).toBeNull();
  });
});

describe('parseLeadManagers', () => {
  it('combines BRLM + co-managers, splits, trims, dedups', () => {
    expect(parseLeadManagers('A Capital, B Securities', 'A Capital')).toEqual(['A Capital', 'B Securities']);
  });
  it('returns [] when none', () => {
    expect(parseLeadManagers('', '')).toEqual([]);
  });
});

describe('computeBSEIssueSize', () => {
  it('shares × top-band price (in rupees), guarded', () => {
    expect(computeBSEIssueSize(4019000, 127)).toBe(510413000);
  });
  it('0 when shares or price missing/zero', () => {
    expect(computeBSEIssueSize(0, 127)).toBe(0);
    expect(computeBSEIssueSize(4019000, undefined)).toBe(0);
  });
});

describe('deriveBSEStatus', () => {
  it('UPCOMING before the window, OPEN inside, CLOSED after', () => {
    expect(deriveBSEStatus('2026-06-11', '2026-06-15', '2026-06-10')).toBe('UPCOMING');
    expect(deriveBSEStatus('2026-06-11', '2026-06-15', '2026-06-11')).toBe('OPEN');
    expect(deriveBSEStatus('2026-06-11', '2026-06-15', '2026-06-13')).toBe('OPEN');
    expect(deriveBSEStatus('2026-06-11', '2026-06-15', '2026-06-15')).toBe('OPEN');
    expect(deriveBSEStatus('2026-06-11', '2026-06-15', '2026-06-16')).toBe('CLOSED');
  });
  it('defaults to UPCOMING when a date is missing', () => {
    expect(deriveBSEStatus(null, '2026-06-15', '2026-06-13')).toBe('UPCOMING');
    expect(deriveBSEStatus('2026-06-11', null, '2026-06-13')).toBe('UPCOMING');
  });
});

describe('mapBSEToScrapedIPO', () => {
  it('maps the full Susan detail to a valid ScrapedIPO', () => {
    const ipo = mapBSEToScrapedIPO(LIST_ROW, DETAIL_ROW);
    expect(ipo.companyName).toBe('SUSAN ELECTRICALS INDIA LIMITED');
    expect(ipo.offeringType).toBe('IPO');
    expect(ipo.listingExchange).toBe('BSE');
    expect(ipo.status).toMatch(/UPCOMING|OPEN|CLOSED|LISTED/);
    expect(ipo.segment).toBe('MAINBOARD');
    expect(ipo.openDate).toBe('2026-06-11');
    expect(ipo.closeDate).toBe('2026-06-15');
    expect(ipo.priceRangeMin).toBe(120);
    expect(ipo.priceRangeMax).toBe(127);
    expect(ipo.lotSize).toBe(1000);
    expect(ipo.faceValue).toBe(10);
    expect(ipo.symbol).toBe('SUSAN');
    expect(ipo.registrar).toBe('Bigshare Services Pvt Ltd');
    expect(ipo.leadManagers).toContain('Beeline Capital Advisors Pvt Ltd');
    expect(ipo.issueSize).toBe(510413000); // 4019000 × 127
  });

  it('produces a row the real ScrapedIPO validator accepts (persister gate)', () => {
    const result = validateIPOData(mapBSEToScrapedIPO(LIST_ROW, DETAIL_ROW));
    expect(result.success).toBe(true);
  });
});

describe('parseIssuePeriod — detail-only date source (historical IPOs have no list row)', () => {
  it('parses "DD Mon YYYY to DD Mon YYYY"', () => {
    expect(parseIssuePeriod('01 Jun 2026 to 03 Jun 2026')).toEqual({ open: '2026-06-01', close: '2026-06-03' });
    expect(parseIssuePeriod('17 Sep 2025 to 19 Sep 2025')).toEqual({ open: '2025-09-17', close: '2025-09-19' });
  });
  it('ignores a trailing "|extension note"', () => {
    expect(parseIssuePeriod('20 Mar 2026 to 06 Apr 2026|Rights Issue extended...')).toEqual({
      open: '2026-03-20',
      close: '2026-04-06',
    });
  });
  it('returns nulls for unparseable input', () => {
    expect(parseIssuePeriod('')).toEqual({ open: null, close: null });
    expect(parseIssuePeriod('whenever')).toEqual({ open: null, close: null });
  });
});

describe('mapBSEDetailToScrapedIPO — build a ScrapedIPO from detail alone (backfill)', () => {
  const MERRITRONIX: BSEDetailRow = {
    IPO_NO: '7740',
    ScripCode: '0',
    ScripName: 'Merritronix Limited',
    Symbol: 'MERRITRONIX',
    Issue_Period: '01 Jun 2026 to 03 Jun 2026',
    Issue_Size_No_of_shares: '3364000',
    Price_Band: '141.00-149.00',
    Face_Value: '10.00',
    Market_Lot: '1000',
    Registrar: 'Bigshare Services Pvt Ltd',
    Book_Running_Lead_Manager: 'GYR Capital Advisors Pvt Ltd',
  };

  it('maps a book-built historical IPO to a valid ScrapedIPO that passes the Zod gate', () => {
    const ipo = mapBSEDetailToScrapedIPO(MERRITRONIX);
    expect(ipo).not.toBeNull();
    expect(ipo!.companyName).toBe('Merritronix Limited');
    expect(ipo!.openDate).toBe('2026-06-01');
    expect(ipo!.closeDate).toBe('2026-06-03');
    expect(ipo!.priceRangeMin).toBe(141);
    expect(ipo!.priceRangeMax).toBe(149);
    expect(ipo!.lotSize).toBe(1000);
    expect(ipo!.issueSize).toBe(501236000); // 3364000 × 149
    expect(ipo!.listingExchange).toBe('BSE');
    expect(validateIPOData(ipo!).success).toBe(true);
  });

  it('returns null for a non-book-built archive row (empty band — NCD/rights/OFS, not an IPO)', () => {
    const ncd: BSEDetailRow = { ...MERRITRONIX, Price_Band: '', Market_Lot: '1', ScripName: 'Some NCD Ltd' };
    expect(mapBSEDetailToScrapedIPO(ncd)).toBeNull();
  });

  it('returns null when the issue period cannot be parsed', () => {
    expect(mapBSEDetailToScrapedIPO({ ...MERRITRONIX, Issue_Period: '' })).toBeNull();
  });
});

describe('summarizeBSEApiResult — orchestrator ScrapedData shape + segment counts', () => {
  const ipo = (segment: 'MAINBOARD' | 'SME'): any => ({ companyName: 'X', segment });

  it('counts MAINBOARD and SME separately and carries an empty subscriptions array', () => {
    const result: BSEApiScrapeResult = {
      ipos: [ipo('MAINBOARD'), ipo('MAINBOARD'), ipo('SME')],
      errors: [],
    };
    const s = summarizeBSEApiResult(result);
    expect(s.mainboardCount).toBe(2);
    expect(s.smeCount).toBe(1);
    expect(s.ipos).toHaveLength(3);
    expect(s.subscriptions).toEqual([]);
  });

  it('a null/blank segment counts as MAINBOARD (BSE IPO board default)', () => {
    const result: BSEApiScrapeResult = { ipos: [{ companyName: 'Y', segment: null } as any], errors: [] };
    const s = summarizeBSEApiResult(result);
    expect(s.mainboardCount).toBe(1);
    expect(s.smeCount).toBe(0);
  });
});

describe('scrapeBSEViaAPI — fetch list + detail, map only IR_flag=IPO', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches the list then a detail per IPO and returns mapped ScrapedIPOs', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('IPO_HomePageDetail')) {
        return { ok: true, status: 200, json: async () => [LIST_ROW, { ...LIST_ROW, IR_flag: 'TO', Scrip_name: 'A Takeover Ltd' }] } as any;
      }
      // detail endpoint
      return { ok: true, status: 200, json: async () => [DETAIL_ROW] } as any;
    });

    const res = await scrapeBSEViaAPI();
    expect(res.ipos.length).toBe(1); // the takeover (IR_flag!=IPO) is excluded
    expect(res.ipos[0].companyName).toBe('SUSAN ELECTRICALS INDIA LIMITED');
    expect(res.ipos[0].issueSize).toBeGreaterThan(0);
    expect(res.ipos[0].lotSize).toBe(1000);
  });
});
