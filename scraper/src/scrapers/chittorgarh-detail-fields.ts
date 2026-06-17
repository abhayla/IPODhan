/**
 * Pure extractors for the Chittorgarh per-IPO detail page (#8 data-completeness).
 *
 * The bulk Chittorgarh JSON reports do NOT carry lot size — it lives only on the
 * per-IPO detail page (`/ipo/<slug>/<id>/`), rendered as:
 *   <a title="Lot Size" ...>Lot Size</a></span></td>
 *   <td class="text-end"><span class="text-end">400 Shares</span></td>
 *
 * These are pure (html -> value) functions so they unit-test without network and
 * carry an output-plausibility gate: a value outside the domain-sane range is
 * rejected (returns null) rather than persisted.
 */

/** Plausible application-lot bounds for an Indian IPO (mainboard + SME). */
const MIN_LOT = 1;
const MAX_LOT = 1_000_000;

/**
 * Extract the application lot size (shares per lot) from a Chittorgarh detail
 * page. Returns null when not found or implausible. A lot of exactly 1 is
 * rejected (it is the known "lot size unknown" placeholder, mirroring
 * validateLotSize in the scraper validators).
 */
export function extractLotSizeFromDetailHtml(html: string): number | null {
  if (!html) return null;

  // Anchor on the "Lot Size" label, then take the nearest "<N> Shares" value
  // that follows it within the same detail row.
  const m = html.match(/Lot\s*Size\s*<\/a>[\s\S]{0,160}?([\d,]+)\s*Shares/i)
    // Fallback: label without the keyword-popup anchor wrapper.
    ?? html.match(/Lot\s*Size[\s\S]{0,120}?([\d,]+)\s*Shares/i);
  if (!m) return null;

  const lot = parseInt(m[1].replace(/,/g, ''), 10);
  if (!Number.isFinite(lot)) return null;
  if (lot <= MIN_LOT || lot > MAX_LOT) return null; // reject 1 and absurd values
  return lot;
}
