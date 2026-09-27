/**
 * #1228 (refs #70): the field walk logged NO_MAPPING for `ipos.listingDate` from
 * NSE, BSE and CHITTORGARH on every attempt (glass-wall-systems-india-ltd,
 * 2026-09-22..09-25), so no web source could ever supply field 7 through the
 * pull model.
 *
 * Spec field 7 (`listing_date`, E-1): MAINBOARD NSE > BSE > CG; SME-BSE BSE > CG;
 * SME-NSE NSE > CG. NSE and CHITTORGARH boards carry a listing date and are now
 * mapped. BSE is NOT: its board/detail endpoints carry no listing date
 * (bse-api-scraper.ts, "LISTED needs a listing date this endpoint doesn't
 * carry"), so it stays an honest NO_MAPPING gap rather than an invented value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrapeNSEIPOsMock = vi.fn();
const scrapeChittorgarhIPOsMock = vi.fn();

vi.mock('../../../src/scrapers/nse-scraper.js', () => ({
  scrapeNSEIPOs: (...args: unknown[]) => scrapeNSEIPOsMock(...args),
}));
vi.mock('../../../src/scrapers/chittorgarh-scraper.js', () => ({
  scrapeChittorgarhIPOs: (...args: unknown[]) => scrapeChittorgarhIPOsMock(...args),
}));

import { buildNseFetcher, NseFieldFetcherState, NSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-nse-fetcher.js';
import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
  CHITTORGARH_SERVEABLE_FIELDS,
} from '../../../src/services/field-plan-walk-chittorgarh-fetcher.js';
import { BSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-bse-fetcher.js';
import { DOC_READABLE_TABLES } from '../../../src/services/field-plan-walk-doc-fetcher.js';
import { listManifestRankCoverageGaps } from '../../../src/config/manifest-rank-coverage-gaps.js';

const IPO_ID = '00000000-0000-4000-8000-000000001228';
const GLASS_WALL = { companyName: 'Glass Wall Systems India Ltd', symbol: 'GLASSWALL', isin: null };
const repo = { findById: vi.fn(async () => GLASS_WALL) } as never;

beforeEach(() => {
  scrapeNSEIPOsMock.mockReset();
  scrapeChittorgarhIPOsMock.mockReset();
});

describe('#1228: listing_date is served by the field walk', () => {
  it('CHITTORGARH supplies listing_date from its list row (glass-wall 2026-09-16)', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({
      ipos: [{ companyName: 'Glass Wall Systems India Ltd', listingDate: '2026-09-16' }],
      errors: [],
    });
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: repo, isChittorgarhCapable: () => true },
      new ChittorgarhFieldFetcherState()
    );
    expect(await fetcher(IPO_ID, 'ipos', '', 'listing_date')).toEqual({ outcome: 'SUPPLIED', value: '2026-09-16' });
  });

  it('CHITTORGARH row without a listing date answers NOT_AVAILABLE_YET (re-asked), never SUPPLIED empty', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({
      ipos: [{ companyName: 'Glass Wall Systems India Ltd', listingDate: '' }],
      errors: [],
    });
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: repo, isChittorgarhCapable: () => true },
      new ChittorgarhFieldFetcherState()
    );
    expect(await fetcher(IPO_ID, 'ipos', '', 'listing_date')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('NSE supplies listing_date from its board row', async () => {
    scrapeNSEIPOsMock.mockResolvedValue({
      ipos: [{ companyName: 'Glass Wall Systems India Ltd', symbol: 'GLASSWALL', listingDate: '2026-09-16' }],
      subscriptions: [],
    });
    const fetcher = buildNseFetcher({ ipoRepository: repo, isNseCapable: () => true }, new NseFieldFetcherState());
    expect(await fetcher(IPO_ID, 'ipos', '', 'listing_date')).toEqual({ outcome: 'SUPPLIED', value: '2026-09-16' });
  });

  it('NSE board row without a listing date (the live current-issue shape) answers NOT_AVAILABLE_YET, so the walk tries the next rank', async () => {
    scrapeNSEIPOsMock.mockResolvedValue({
      ipos: [{ companyName: 'Glass Wall Systems India Ltd', symbol: 'GLASSWALL', listingDate: undefined }],
      subscriptions: [],
    });
    const fetcher = buildNseFetcher({ ipoRepository: repo, isNseCapable: () => true }, new NseFieldFetcherState());
    expect(await fetcher(IPO_ID, 'ipos', '', 'listing_date')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('the real manifest: listing_date has no NSE or CHITTORGARH NO_MAPPING gap left; BSE stays a named gap', () => {
    const scraperRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const manifest = JSON.parse(readFileSync(path.join(scraperRoot, 'config', 'field-manifest.json'), 'utf8'));
    const gaps = listManifestRankCoverageGaps(
      manifest,
      ['DOC', 'BSE', 'NSE', 'CHITTORGARH'],
      { BSE: BSE_SERVEABLE_FIELDS, NSE: new Set(NSE_SERVEABLE_FIELDS.keys()), CHITTORGARH: CHITTORGARH_SERVEABLE_FIELDS },
      DOC_READABLE_TABLES
    ).filter((g) => g.startsWith('ipos.listing_date '));
    expect(gaps).toEqual(['ipos.listing_date BSE NO_MAPPING']);
  });
});
