/**
 * T-287F2: chittorgarh-scraper must NOT default `segment` to MAINBOARD for
 * business-trust (InvIT/REIT) rows -- it must derive/null it from the
 * company-name signal instead. Drives the REAL API scrape-parse path
 * (mocks global.fetch, not an internal helper) so the assertion exercises
 * the actual production code path, not a stubbed shortcut.
 *
 * Regression coverage for checker finding T-287C2
 * (FINDING-hold-rebounded.md): the scraper previously hardcoded
 * `segment = 'MAINBOARD'` unconditionally, which re-overwrote a
 * manually-protected segment=NULL on every 30-minute scrape cycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeChittorgarhIPOs } from '../../../src/scrapers/chittorgarh-scraper.js';

function chittorgarhRecord(overrides: Record<string, string>) {
  return {
    'Company': `<a href="/ipo/x/1/">${overrides.companyName}</a>`,
    'Opening Date': 'Tue, Oct 07, 2025',
    'Closing Date': 'Thu, Oct 09, 2025',
    'Listing Date': 'Fri, Oct 10, 2025',
    'Issue Price (Rs.)': '100.00',
    'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '500.00',
    'Listing at': 'BSE, NSE',
    'Lead Manager': '<a href="/lead-manager/x/">Some Manager</a>',
    '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
    '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
    '~ListingDate': '2025-10-10T00:00:00.000Z',
  };
}

function mockFetchOnce(records: Array<Record<string, string>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ msg: 1, sSearchWhere: '', reportTableData: records }),
    })
  );
}

describe('chittorgarh-scraper: business-trust segment/offeringType (T-287F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not default segment to MAINBOARD for a bare "...Trust" InvIT name (no InvIT/REIT keyword)', async () => {
    mockFetchOnce([chittorgarhRecord({ companyName: 'Cube Highways Trust' })]);

    const result = await scrapeChittorgarhIPOs();

    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].segment).not.toBe('MAINBOARD');
    expect(result.ipos[0].segment ?? null).toBeNull();
    expect(result.ipos[0].offeringType).toBe('INVITS');
  });

  it('does not default segment to MAINBOARD for a REIT-keyword company name', async () => {
    mockFetchOnce([chittorgarhRecord({ companyName: 'Bagmane Prime Office REIT' })]);

    const result = await scrapeChittorgarhIPOs();

    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].segment ?? null).toBeNull();
    expect(result.ipos[0].offeringType).toBe('REITS');
  });

  it('does not default segment to MAINBOARD for an "Investment Trust" mid-name shape', async () => {
    mockFetchOnce([chittorgarhRecord({ companyName: 'Property Share Investment Trust-Propshare Celestia' })]);

    const result = await scrapeChittorgarhIPOs();

    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].segment ?? null).toBeNull();
    expect(result.ipos[0].offeringType).toBe('INVITS');
  });

  it('regression: a genuine equity mainboard IPO still gets segment=MAINBOARD', async () => {
    mockFetchOnce([chittorgarhRecord({ companyName: 'ABC Company Limited' })]);

    const result = await scrapeChittorgarhIPOs();

    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].segment).toBe('MAINBOARD');
    expect(result.ipos[0].offeringType).toBe('IPO');
  });

  it('regression: a company merely containing the word "Trust" as a brand name is NOT treated as a business trust', async () => {
    mockFetchOnce([chittorgarhRecord({ companyName: 'Trust Fintech Limited' })]);

    const result = await scrapeChittorgarhIPOs();

    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].segment).toBe('MAINBOARD');
    expect(result.ipos[0].offeringType).toBe('IPO');
  });
});
