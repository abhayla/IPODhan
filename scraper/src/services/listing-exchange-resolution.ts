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

/** Which evidence decided an SME collapse (recorded in the log line). */
export type SmeCollapseTier =
  | 'LISTING_RECORD'
  | 'FIELD_SOURCE_PROVENANCE'
  | 'INCOMING_SELF_ASSERTION';

export interface SmeCollapseEvidence {
  /** `listing_performance.exchange` for this IPO ('BOTH' is not evidence). */
  listingRecordExchange?: ListingExchange | 'BOTH' | null;
  /** Sources of the `symbol` / `listingExchanges` provenance rows on this IPO. */
  trackedExchangeSources?: ScraperSource[];
  /** The self-asserting exchange scraper writing in THIS run, if any. */
  incomingSource?: ScraperSource;
}

/**
 * W-145 round 2. A union never shrinks, so an SME row already stored as
 * ['NSE','BSE'] (5 such rows in prod) would stay wrong forever: the invariant
 * only refuses to WIDEN. This collapses such a row back to the single board
 * that has EVIDENCE, in a fixed order — a listing record for that exchange,
 * then the exchange whose own scraper owns provenance on this IPO, then the
 * exchange asserting itself in this run. With no evidence it returns null and
 * the caller keeps the stored pair plus its CRITICAL conflict row: a guess is
 * worse than a visible, tracked disagreement.
 */
export function collapseSmeExchanges(
  stored: unknown,
  evidence: SmeCollapseEvidence
): { exchange: ListingExchange; tier: SmeCollapseTier } | null {
  if (!Array.isArray(stored) || stored.length < 2) return null;
  const members = stored.filter(
    (value): value is ListingExchange => value === 'NSE' || value === 'BSE'
  );
  if (members.length < 2) return null;

  const listed = evidence.listingRecordExchange;
  if ((listed === 'NSE' || listed === 'BSE') && members.includes(listed)) {
    return { exchange: listed, tier: 'LISTING_RECORD' };
  }

  const tracked = (evidence.trackedExchangeSources ?? []).filter(
    (source): source is ListingExchange => source === 'NSE' || source === 'BSE'
  );
  const distinctTracked = Array.from(new Set(tracked)).filter((exchange) =>
    members.includes(exchange)
  );
  // Provenance from BOTH exchanges is not evidence for either one.
  if (distinctTracked.length === 1) {
    return { exchange: distinctTracked[0], tier: 'FIELD_SOURCE_PROVENANCE' };
  }

  const incoming = evidence.incomingSource;
  if (
    (incoming === 'NSE' || incoming === 'BSE') &&
    members.includes(incoming)
  ) {
    return { exchange: incoming, tier: 'INCOMING_SELF_ASSERTION' };
  }

  return null;
}
