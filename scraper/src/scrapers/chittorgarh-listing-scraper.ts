/**
 * Chittorgarh Listing-Performance Scraper (B1)
 *
 * WHY: listing_performance is 0/91. NSE /api/public-past-issues has NO listingPrice; BSE has no
 * day-1 price endpoint. Chittorgarh report 25 (ipo-listing-date-check-status-price-bse-nse) DOES
 * publish the real day-1 "Close Price on Listing" + listing gain% + current BSE/NSE price +
 * current gain%, with ISIN / scrip code / symbol — for mainboard AND SME. This module discovers
 * + parses those rows; the backfill matches them to our IPOs and writes listing_performance.
 *
 * NOTE: like report 20, this report's JSON only honours small perPage (5/10) and ignores
 * pagination, so coverage is fetched per fiscal-year × category and deduped.
 */
import logger from '../utils/logger.js';

export interface ChittorgarhListingRow {
  companyName: string;
  slug: string | null;
  isin: string | null;
  bseScripCode: string | null;
  nseSymbol: string | null;
  listingDate: string | null;
  issuePrice: number | null;
  listingClose: number; // real day-1 close (required)
  listingGainPct: number | null;
  currentBse: number | null;
  currentNse: number | null;
  currentGainPct: number | null;
}

const API_BASE = 'https://webnodejs.chittorgarh.com/cloud/report/data-read';
const REPORT_ID = '25';

/** Extract a signed number from a styled `<span>…</span>` (or a bare number). */
export function parseGainSpan(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const text = String(v).replace(/<[^>]*>/g, '').trim();
  if (!text) return null;
  const m = text.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function parseListingReportRows(rows: any[] | null | undefined): ChittorgarhListingRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ChittorgarhListingRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const listingClose = num(row['Close Price on Listing (Rs.)']);
    if (listingClose == null) continue; // require the real day-1 close (NOT-NULL listing_price)
    out.push({
      companyName: str(row['Company']) ?? '',
      slug: str(row['~urlrewrite_folder_name']),
      isin: str(row['~isin']) ?? str(row['ISIN']),
      bseScripCode: str(row['~bse_script_code']) ?? str(row['BSE Scrip Code']),
      nseSymbol: str(row['~nse_symbol']) ?? str(row['NSE Symbol']),
      listingDate: str(row['Listing Date']),
      issuePrice: num(row['Issue Price (Rs.)']),
      listingClose,
      listingGainPct: parseGainSpan(row['% Gain/Loss (Issue price v/s close price on Listing)']),
      currentBse: num(row['Current Price <br>at BSE (Rs.)']),
      currentNse: num(row['Current Price <br>at NSE (Rs.)']),
      currentGainPct: parseGainSpan(row['Gain / Loss (%)']),
    });
  }
  return out;
}

async function fetchPage(cat: string, year: number, range: string, perPage: number, page = 1): Promise<any[]> {
  const url = `${API_BASE}/${REPORT_ID}/${page}/${perPage}/${year}/${range}/0/${cat}/0?search=&v=15-11`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.chittorgarh.com/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Chittorgarh report ${REPORT_ID} HTTP ${res.status}`);
  const data: any = await res.json();
  return data?.reportTableData ?? [];
}

/** Fetch listing rows across fiscal years × categories, deduped by ISIN (then slug). */
export async function fetchChittorgarhListingRows(
  fiscalYears: Array<{ year: number; range: string }>,
  perPage = 10
): Promise<ChittorgarhListingRow[]> {
  const seen = new Set<string>();
  const all: ChittorgarhListingRow[] = [];
  const MAX_PAGES = 40; // safety cap (report-25 ignores perPage>10 but paginates via the page param)
  for (const cat of ['mainboard', 'sme']) {
    for (const fy of fiscalYears) {
      let fetchedForFy = 0;
      // Paginate: report-25 honours only small perPage but pages correctly; walk
      // pages until one returns no rows. (page=1 alone misses everything but the
      // most-recent ~5 listings — the gap behind #36/#70's "0 matches".)
      for (let page = 1; page <= MAX_PAGES; page++) {
        let rows: any[];
        try {
          rows = await fetchPage(cat, fy.year, fy.range, perPage, page);
        } catch (err) {
          logger.warn({ cat, fy: fy.range, page, error: err instanceof Error ? err.message : String(err) }, 'Chittorgarh listing report fetch failed (continuing)');
          break;
        }
        if (!rows.length) break; // end of this fiscal-year × category
        const parsed = parseListingReportRows(rows);
        for (const r of parsed) {
          const key = (r.isin || r.slug || `${r.companyName}|${r.listingClose}`).toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(r);
          fetchedForFy++;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      logger.info({ cat, fy: fy.range, added: fetchedForFy }, 'Chittorgarh listing report fetched (paginated)');
    }
  }
  return all;
}
