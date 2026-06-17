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

/**
 * Extract the IPO registrar from a Chittorgarh detail page. The value is rendered
 * under the "IPO Registrar" heading as:
 *   <a ... class="registrar-name" href="/report/ipo-registrar-review/...">Kfin Technologies Ltd.</a>
 * Returns the whitespace-normalized name, or null when absent/implausible. The
 * report-link variants ("Registrar- List of Issues Managed") are NOT the value
 * and are deliberately not matched (the class="registrar-name" anchor is unique).
 */
export function extractRegistrarFromDetailHtml(html: string): string | null {
  if (!html) return null;

  const m = html.match(/class="registrar-name"[^>]*>([^<]+)<\/a>/i);
  if (!m) return null;

  const name = m[1]
    .replace(/\s+/g, ' ')
    // Fix the common missing-space smell Chittorgarh renders ("Pvt.Ltd." ->
    // "Pvt. Ltd.") so the displayed registrar is canonical (#8 registrar norm).
    .replace(/\bPvt\.(?=[A-Za-z])/g, 'Pvt. ')
    .trim();
  // Plausibility: a real registrar name has letters and a sane length; reject
  // empty, numeric-only, or boilerplate placeholders.
  if (name.length < 3 || name.length > 120) return null;
  if (!/[A-Za-z]/.test(name)) return null;
  if (/^(n\/?a|tbd|tba|-+)$/i.test(name)) return null;
  return name;
}
