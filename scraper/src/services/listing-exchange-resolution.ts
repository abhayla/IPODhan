/**
 * W-145: `listingExchanges` as a first-class, source-ranked field.
 *
 * The rules the consolidator and the write paths share:
 *
 * 1. **Self-assertion only.** An exchange scraper is authoritative for its OWN
 *    board and nothing else: an NSE scrape proves "this issue lists on NSE",
 *    never "…and not on BSE", and never "…on BSE too". So NSE/BSE incoming
 *    payloads are narrowed to `[source]` at the boundary and the truth is the
 *    UNION of the self-assertions (the set merge in data-consolidation-service).
 * 2. **A lower source may only add an exchange it can evidence.** The page-
 *    stating sources (ADMIN/DRHP/CHITTORGARH — Chittorgarh prints "Listing At:
 *    BSE, NSE") may report a two-board value; the aggregators at the bottom
 *    (MONEYCONTROL, INVESTORGAIN_GMP, API_FALLBACK) may report a single board
 *    they name, but a 'BOTH' from them is treated as UNKNOWN, never a claim.
 *    That is the hard-coded `listingExchange: 'BOTH'` class (moneycontrol-scraper,
 *    description-backfill, historical-ipo-assembler) that stomped correct
 *    single-board SME values on the next cycle.
 * 3. **Unknown never overwrites.** `undefined` in, `undefined` out — the
 *    absent-never-overwrites-present guard then keeps the stored value.
 * 4. **SME invariant.** An SME issue lists on exactly ONE board (NSE Emerge or
 *    BSE SME). A merge that would give an SME row two exchanges is a conflict,
 *    not a write.
 */

import type { ScraperSource } from '../config/field-priority-matrix.js';

export type ListingExchange = 'NSE' | 'BSE';
export type ScrapedListingExchange = ListingExchange | 'BOTH';

/** Sources that speak for one board and may assert only themselves. */
const SELF_ASSERTING_SOURCES: ReadonlySet<ScraperSource> = new Set<ScraperSource>(['NSE', 'BSE']);

/**
 * Sources whose two-board claim is evidence (the filing or the page states the
 * board). Every other source's 'BOTH' is a default, not a fact, and is dropped.
 */
const BOTH_EVIDENCING_SOURCES: ReadonlySet<ScraperSource> = new Set<ScraperSource>([
  'ADMIN',
  'DRHP',
  'CHITTORGARH',
]);

/**
 * Map a scraper's `listingExchange` ('NSE' | 'BSE' | 'BOTH' | undefined) to the
 * canonical `listingExchanges` array for THIS source. `undefined` means unknown
 * and must be left out of the incoming record entirely so nothing is overwritten.
 */
export function toListingExchangesForSource(
  listingExchange: ScrapedListingExchange | undefined,
  source: ScraperSource
): ListingExchange[] | undefined {
  if (SELF_ASSERTING_SOURCES.has(source)) {
    return [source as ListingExchange];
  }

  if (listingExchange === 'NSE' || listingExchange === 'BSE') {
    return [listingExchange];
  }

  if (listingExchange === 'BOTH' && BOTH_EVIDENCING_SOURCES.has(source)) {
    return ['NSE', 'BSE'];
  }

  return undefined;
}

/**
 * SME invariant: `segment === 'SME'` implies exactly one listing exchange.
 * Returns true when writing `exchanges` for `segment` would violate it.
 */
export function violatesSmeSingleExchange(
  segment: string | null | undefined,
  exchanges: unknown
): boolean {
  return segment === 'SME' && Array.isArray(exchanges) && exchanges.length > 1;
}

/** Named reason recorded on the `data_conflicts` row the invariant raises. */
export const SME_SINGLE_EXCHANGE_CONFLICT_REASON = 'SME_SINGLE_EXCHANGE_INVARIANT';
