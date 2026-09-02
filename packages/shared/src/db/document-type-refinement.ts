/**
 * Which `document_type` values may REPLACE which, when the same URL is seen
 * again with a better classification (T-403 M6).
 *
 * THE PROBLEM. `DocumentRepository.upsertDocument` dedups by URL and, on a hit,
 * only touched `updated_at`/`is_active` — it never updated `type`. So the T-403
 * classifier fix was forward-only: every row already stored under the wrong type
 * (a final Prospectus filed as RHP, a corrigendum and a price-band ad both filed
 * as ADDENDUM) stayed wrong forever, and a second document type resolving to a
 * URL already held under another type silently adopted the first type's row.
 *
 * THE RULE. A re-type is allowed only when it is strictly MORE SPECIFIC. This is
 * intentionally a small, closed allowlist rather than "newest classification
 * wins": a classifier regression must not be able to relabel the corpus. Every
 * entry corresponds to a mis-classification the T-403 review actually found.
 *
 * Lives in `packages/shared` because the repository does the write, and shared
 * must not import from `scraper` (`shared-package-build.md`).
 */

/** `from` -> the set of types that are a legitimate refinement of it. */
export const DOCUMENT_TYPE_REFINEMENTS: Record<string, readonly string[]> = {
  // The Skyways trap: `Prospectus_GID` serves the RHP before close and the FINAL
  // Prospectus after, and the old classifier called both RHP.
  RHP: ['PROSPECTUS'],
  // A corrigendum outranks the RHP for the dates it carries and a price-band ad
  // carries the band; collapsing both into ADDENDUM lost each of those.
  ADDENDUM: ['CORRIGENDUM', 'PRICE_BAND_AD'],
  // The advertisement is a distinct document from the allotment basis itself.
  BASIS_OF_ALLOTMENT: ['BASIS_OF_ALLOTMENT_AD'],
};

/**
 * True when `next` is a permitted refinement of `current`.
 *
 * Deliberately NOT symmetric and NOT transitive-by-accident: PROSPECTUS never
 * degrades back to RHP, and an unrelated pair (say RHP -> BIDDING_CENTERS) is
 * refused outright — a URL resolving to a wholly different type means the
 * classifier or the source changed, which a human should look at.
 */
export function isMoreSpecificDocumentType(current: string, next: string): boolean {
  if (!current || !next || current === next) return false;
  return (DOCUMENT_TYPE_REFINEMENTS[current] ?? []).includes(next);
}
