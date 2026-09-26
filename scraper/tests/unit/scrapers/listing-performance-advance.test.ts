/**
 * #70 (with #36 / #72) — an IPO whose listing the system already knows must
 * advance to LISTED with that listing date.
 *
 * Measured on ipodhan_staging 2026-09-26 by the supervisor (read-only):
 *   glass-wall-systems-india-ltd  listing_performance.listing_date 2026-09-16, price 214.85
 *   lumino-industries-ltd         listing_performance.listing_date 2026-09-03, price 110.32
 * both with ipos.status CLOSED and ipos.listing_date NULL. The listing job
 * read LISTED rows only and wrote listing_performance only, so the listing
 * date it held never reached ipos; nothing else re-reads a closed IPO's
 * listing, so the row stayed CLOSED.
 *
 * Spec basis: data-sourcing-pull-model.md field 7 `listing_date` (T, NSE > BSE > CG,
 * "listing > close"), field 8 `status` (legal transition UPCOMING->OPEN->CLOSED->LISTED),
 * fields 176-178 / 224 (listing_performance.listing_date is a copy of ipos.listing_date).
 */
import { describe, it, expect, vi } from 'vitest';
import { planListingPerformanceUpdates } from '../../../src/scrapers/listing-performance-plan.js';
import { buildListingScrapedIPO } from '../../../src/services/listing-reconciliation.js';
import { makeListingAdvanceWriter } from '../../../src/scrapers/listing-advance-writer.js';
import type { ChittorgarhListingRow } from '../../../src/scrapers/chittorgarh-listing-scraper.js';
import type { StuckIpo } from '../../../src/services/listing-reconciliation.js';

const TODAY = '2026-09-26';

const glassWall = (over: Partial<StuckIpo> = {}): StuckIpo => ({
  id: 'glass-wall',
  companyName: 'Glass Wall Systems India Ltd.',
  slug: 'glass-wall-systems-india-ltd',
  symbol: null,
  isin: null,
  segment: 'SME',
  offeringType: 'IPO',
  status: 'CLOSED',
  openDate: '2026-09-09',
  closeDate: '2026-09-11',
  listingDate: null,
  priceRangeMax: 200,
  issueSize: 40,
  ...over,
});

const cgRow = (over: Partial<ChittorgarhListingRow> = {}): ChittorgarhListingRow => ({
  companyName: 'Glass Wall Systems India Ltd.',
  slug: 'glass-wall-systems-india-ltd',
  isin: null,
  bseScripCode: null,
  nseSymbol: 'GLASSWALL',
  listingDate: '16-Sep-2026',
  issuePrice: 200,
  listingClose: 214.85,
  listingGainPct: 7.43,
  currentBse: null,
  currentNse: 220,
  currentGainPct: 10,
  ...over,
});

describe('#70: a CLOSED IPO whose listing is known advances to LISTED', () => {
  it('plans the ipos write (LISTED + listing_date) alongside the listing row', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall()], [cgRow()], TODAY);

    expect(skipped).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0].advance).toMatchObject({ status: 'LISTED', listingDate: '2026-09-16' });
    expect(records[0].record.listingDate).toBe('2026-09-16');
    expect(records[0].record.listingPrice).toBe(214.85);
  });

  it('lumino shape: listed 2026-09-03 after a 2026-08-29 close', () => {
    const lumino = glassWall({ id: 'lumino', companyName: 'Lumino Industries Ltd.', slug: 'lumino-industries-ltd', openDate: '2026-08-27', closeDate: '2026-08-29', priceRangeMax: 100 });
    const row = cgRow({ companyName: 'Lumino Industries Ltd.', slug: 'lumino-industries-ltd', nseSymbol: 'LUMINO', listingDate: '03-Sep-2026', issuePrice: 100, listingClose: 110.32 });
    const { records } = planListingPerformanceUpdates([lumino], [row], TODAY);

    expect(records[0].advance).toMatchObject({ status: 'LISTED', listingDate: '2026-09-03' });
  });

  it('a LISTED row with no listing_date also takes it (an exchange said LISTED without a date)', () => {
    const { records } = planListingPerformanceUpdates([glassWall({ status: 'LISTED' })], [cgRow()], TODAY);
    expect(records[0].advance).toMatchObject({ listingDate: '2026-09-16' });
  });

  it('a row that already has a listing_date is never re-dated by the listing source; the listing row copies ipos', () => {
    const listed = glassWall({ status: 'LISTED', listingDate: '2026-09-15' });
    const { records } = planListingPerformanceUpdates([listed], [cgRow()], TODAY);

    expect(records[0].advance).toBeUndefined();
    expect(records[0].record.listingDate).toBe('2026-09-15');
  });

  it('refuses a listing date after today (not a listing yet)', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall()], [cgRow({ listingDate: '30-Sep-2026' })], TODAY);
    expect(records).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ ipoId: 'glass-wall', reason: 'listing-date-in-future' })]);
  });

  it('refuses a listing date on or before the close date (another offer of the same name)', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall()], [cgRow({ listingDate: '11-Sep-2026' })], TODAY);
    expect(records).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: 'listing-date-not-after-close' })]);
  });

  it('refuses a non-IPO offering (a tender or buyback never lists, spec §1.11)', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall({ offeringType: 'TENDER' })], [cgRow()], TODAY);
    expect(records).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: 'not-an-ipo' })]);
  });

  it('refuses when no today is given (cannot tell a listing from a future date)', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall()], [cgRow()]);
    expect(records).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: 'listing-date-in-future' })]);
  });

  it('a CLOSED row with a stored future listing_date gets no listing row (the status updater owns it)', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall({ listingDate: '2026-09-30' })], [cgRow()], TODAY);
    expect(records).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: 'not-listed-yet' })]);
  });

  it('an unmatched CLOSED row is skipped, never advanced', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall()], [cgRow({ companyName: 'Other Ltd', slug: 'other-ltd', nseSymbol: 'OTHER' })], TODAY);
    expect(records).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: 'no-listing-source-match' })]);
  });
});

describe('#70 round 3: the advance never invents values', () => {
  it('a CLOSED row with no close date is not advanced', () => {
    const { records, skipped } = planListingPerformanceUpdates([glassWall({ closeDate: null })], [cgRow()], TODAY);
    expect(records).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: 'no-close-date' })]);
  });

  it('never sends open/close dates the row does not hold (no open = close = listing)', () => {
    const scraped = buildListingScrapedIPO(glassWall({ openDate: null, closeDate: null }), cgRow(), 'isin');
    expect('openDate' in scraped).toBe(false);
    expect('closeDate' in scraped).toBe(false);
    expect(scraped.listingDate).toBe('2026-09-16');
  });

  it("sends the row's own open/close dates unchanged", () => {
    const scraped = buildListingScrapedIPO(glassWall(), cgRow(), 'slug');
    expect(scraped.openDate).toBe('2026-09-09');
    expect(scraped.closeDate).toBe('2026-09-11');
  });

  it.each(['slug', 'name'] as const)("a %s match never copies the listing row's symbol or ISIN", (method) => {
    const scraped = buildListingScrapedIPO(glassWall(), cgRow({ isin: 'INE0GLASS011' }), method);
    expect(scraped.symbol).toBeUndefined();
    expect(scraped.isin).toBeUndefined();
  });

  it('an identifier match may fill the missing identifier', () => {
    const scraped = buildListingScrapedIPO(glassWall({ isin: 'INE0GLASS011' }), cgRow({ isin: 'INE0GLASS011' }), 'isin');
    expect(scraped.symbol).toBe('GLASSWALL');
  });
});

describe('#70 round 3: LISTED is claimed only after the listing date is stored', () => {
  const scraped = () => buildListingScrapedIPO(glassWall(), cgRow(), 'slug');

  it('date rejected: one write, status sent as context only, no LISTED claim', async () => {
    const upsert = vi.fn().mockResolvedValue('id');
    const write = makeListingAdvanceWriter({
      resolve: async () => null,
      upsert,
      readBack: async () => ({ storedListingDate: null, storedStatus: 'CLOSED' }),
    });
    const out = await write(glassWall(), scraped());
    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload, , ctx] = upsert.mock.calls[0];
    expect(payload.status).toBe('CLOSED');
    expect(ctx).toContain('status');
    expect(ctx).not.toContain('listingDate');
    expect(out.storedListingDate).toBeNull();
  });

  it('date stored: the second write claims LISTED', async () => {
    const upsert = vi.fn().mockResolvedValue('id');
    const reads = [
      { storedListingDate: '2026-09-16', storedStatus: 'CLOSED' },
      { storedListingDate: '2026-09-16', storedStatus: 'LISTED' },
    ];
    const write = makeListingAdvanceWriter({ resolve: async () => null, upsert, readBack: async () => reads.shift()! });
    const out = await write(glassWall(), scraped());
    expect(upsert).toHaveBeenCalledTimes(2);
    const [payload2, , ctx2] = upsert.mock.calls[1];
    expect(payload2.status).toBe('LISTED');
    expect(ctx2).not.toContain('status');
    expect(out).toEqual({ storedListingDate: '2026-09-16', storedStatus: 'LISTED' });
  });
});

