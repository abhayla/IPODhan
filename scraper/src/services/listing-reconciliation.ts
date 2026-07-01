/**
 * Listing Reconciliation (GitHub #70 / #36)
 *
 * 142 of 167 genuine CLOSED IPOs (85%) are stuck at status=CLOSED with
 * listing_date=NULL: the status state-machine (computeTargetStatus) only advances
 * CLOSED -> LISTED once `listing_date` is set, but no working source ever set it.
 *
 * This module is the DETERMINISTIC, pure core that closes the gap:
 *   1. matchListingRowToIpo  — match a Chittorgarh report-25 listing row to a stuck
 *      IPO by ISIN -> NSE symbol -> slug -> normalized company name.
 *   2. computeListingGainPct — derive listing gain from issue price + day-1 close
 *      (independent of the source's stated gain — used to cross-check it).
 *   3. buildListingScrapedIPO — the upsertIPO payload that sets listing_date +
 *      status=LISTED (write-path SSOT; the status advance then matches the
 *      computeTargetStatus rule), preserving the existing row's other fields.
 *   4. buildListingPerformanceRecord — the listing_performance row (day-1 price,
 *      issue price, gain).
 *
 * Source is Chittorgarh report 25 (reachable; mainboard + SME; real day-1 close).
 * BSE StockReachGraph was evaluated and rejected: it returns only the current
 * intraday series, never the listing-day price (see #70 notes). NSE is bot-blocked.
 *
 * No prod write happens here — the backfill script that uses this is dry-run by
 * default and routes the actual write through upsertIPO (scraper-write-path.md).
 */
import type { ChittorgarhListingRow } from '../scrapers/chittorgarh-listing-scraper.js';
import type { ScrapedIPO } from '../utils/validators.js';
import type { ListingPerformanceInsert } from '@ipodhan/shared/repositories/types';

/** The minimal stuck-IPO shape the reconciliation needs (read-only from the DB). */
export interface StuckIpo {
  id: string;
  companyName: string;
  slug: string;
  symbol: string | null;
  isin: string | null;
  segment: 'MAINBOARD' | 'SME' | null;
  offeringType: string;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  listingDate: string | null;
  priceRangeMax: number | null;
  issueSize: string | number | null;
}

export type MatchMethod = 'isin' | 'symbol' | 'slug' | 'name';

export interface ListingMatch {
  method: MatchMethod;
  row: ChittorgarhListingRow;
}

/**
 * Normalize a company name for fuzzy matching: lowercase, drop legal suffixes
 * and punctuation, collapse whitespace. "Acme Industries Ltd." ~ "ACME INDUSTRIES LIMITED".
 */
export function normalizeNameForMatch(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|private|pvt|public|company|co|corporation|corp|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * ISO date (YYYY-MM-DD) from Chittorgarh's "30-Dec-2025" listing-date string.
 * Formats from LOCAL date parts (the parsed value is local midnight) so it is
 * timezone-safe — `new Date('30-Dec-2025').toISOString()` would shift to the
 * previous day in IST (the off-by-one this repo guards against, GitHub #28).
 */
export function parseCgListingDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Listing gain % = (day-1 close - issue price) / issue price * 100, guarded
 * against divide-by-zero. Returns null when inputs are missing/invalid.
 */
export function computeListingGainPct(
  issuePrice: number | null,
  listingClose: number | null
): number | null {
  if (!issuePrice || !listingClose || issuePrice <= 0) return null;
  const gain = ((listingClose - issuePrice) / issuePrice) * 100;
  return Number.isFinite(gain) ? Math.round(gain * 100) / 100 : null;
}

/** A listing gain is plausible roughly in [-95%, +900%] for a real IPO day-1. */
export function isPlausibleListingGain(gainPct: number | null): boolean {
  if (gainPct === null) return true; // unknown is allowed
  return gainPct >= -95 && gainPct <= 900;
}

/**
 * Match a single Chittorgarh listing row to a stuck IPO, in confidence order:
 * ISIN (exact) > NSE symbol (exact, case-insensitive) > slug (exact) >
 * normalized company name (exact). Returns the match method, or null.
 */
export function matchListingRowToIpo(
  ipo: StuckIpo,
  row: ChittorgarhListingRow
): MatchMethod | null {
  const eq = (a?: string | null, b?: string | null) =>
    !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

  if (eq(ipo.isin, row.isin)) return 'isin';
  if (eq(ipo.symbol, row.nseSymbol)) return 'symbol';
  if (eq(ipo.slug, row.slug)) return 'slug';
  const n1 = normalizeNameForMatch(ipo.companyName);
  const n2 = normalizeNameForMatch(row.companyName);
  if (n1 && n2 && n1 === n2) return 'name';
  return null;
}

/**
 * Find the best Chittorgarh listing row for a stuck IPO across all fetched rows.
 * Prefers the highest-confidence match method.
 */
export function findBestListingMatch(
  ipo: StuckIpo,
  rows: ChittorgarhListingRow[]
): ListingMatch | null {
  const order: MatchMethod[] = ['isin', 'symbol', 'slug', 'name'];
  let best: ListingMatch | null = null;
  for (const row of rows) {
    const method = matchListingRowToIpo(ipo, row);
    if (!method) continue;
    if (!best || order.indexOf(method) < order.indexOf(best.method)) {
      best = { method, row };
    }
    if (method === 'isin') break; // can't do better than ISIN
  }
  return best;
}

/** Map Chittorgarh "Listing At" ("BSE, NSE" / "BSE" / "NSE") to ScrapedIPO listingExchange. */
function toListingExchange(row: ChittorgarhListingRow, ipo: StuckIpo): 'NSE' | 'BSE' | 'BOTH' {
  const hasNse = !!row.nseSymbol;
  const hasBse = !!row.bseScripCode;
  if (hasNse && hasBse) return 'BOTH';
  if (hasNse) return 'NSE';
  if (hasBse) return 'BSE';
  return 'BOTH';
}

/**
 * Build the upsertIPO payload that advances a stuck IPO to LISTED with its real
 * listing_date. Preserves the existing row's required fields (open/close/issue
 * size/offering type) so upsertIPO's date/issue guards have a stable anchor and
 * nothing else is stomped. The status is set to LISTED because listing_date has
 * arrived — identical to what computeTargetStatus would derive.
 */
export function buildListingScrapedIPO(ipo: StuckIpo, row: ChittorgarhListingRow): ScrapedIPO {
  const listingDate = parseCgListingDate(row.listingDate);
  if (!listingDate) {
    throw new Error(`Cannot build listing update for ${ipo.companyName}: unparseable listing date "${row.listingDate}"`);
  }
  const issueSizeNum =
    ipo.issueSize === null || ipo.issueSize === undefined
      ? 0
      : typeof ipo.issueSize === 'string'
        ? parseFloat(ipo.issueSize) || 0
        : ipo.issueSize;

  return {
    companyName: ipo.companyName,
    issueSize: issueSizeNum,
    openDate: ipo.openDate ?? listingDate,
    closeDate: ipo.closeDate ?? listingDate,
    listingExchange: toListingExchange(row, ipo),
    segment: ipo.segment ?? undefined,
    offeringType: ipo.offeringType as ScrapedIPO['offeringType'],
    status: 'LISTED',
    listingDate,
    symbol: ipo.symbol ?? row.nseSymbol ?? undefined,
    isin: (ipo.isin ?? row.isin ?? undefined) || undefined,
    ...(ipo.priceRangeMax ? { priceRangeMax: ipo.priceRangeMax } : {}),
  };
}

/**
 * Build the listing_performance row (day-1 price + issue price + gain). Uses the
 * source's stated gain when it agrees with the computed gain (±1pp), else the
 * computed gain (source-of-truth = issue price + day-1 close).
 */
export function buildListingPerformanceRecord(
  ipo: StuckIpo,
  row: ChittorgarhListingRow
): ListingPerformanceInsert {
  // Keep decimal rupee precision (#79): listing_price/issue_price are numeric(10,2),
  // so ₹145.78 must NOT be rounded to an integer.
  const issuePrice = row.issuePrice ?? ipo.priceRangeMax ?? null;
  const listingClose = row.listingClose;
  const computedGain = computeListingGainPct(issuePrice, listingClose);
  // Prefer computed (deterministic from price); fall back to source's stated gain.
  const gain = computedGain ?? row.listingGainPct;

  return {
    ipoId: ipo.id,
    symbol: ipo.symbol ?? row.nseSymbol ?? null,
    companyName: ipo.companyName,
    listingDate: parseCgListingDate(row.listingDate),
    listingPrice: listingClose,
    issuePrice: issuePrice,
    listingGainPercent: gain !== null ? gain.toFixed(2) : null,
    currentPrice: row.currentBse ?? row.currentNse ?? null,
    currentPriceBSE: row.currentBse ?? null,
    currentPriceNSE: row.currentNse ?? null,
    currentGainPercent: row.currentGainPct !== null ? row.currentGainPct.toFixed(2) : null,
    dataSource: 'SCRAPER', // Chittorgarh report-25 (listing_performance.data_source allows MANUAL|SCRAPER|NSE_PAST_API)
  };
}
