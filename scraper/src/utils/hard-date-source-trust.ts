/**
 * Hard-date source trust for a brand-new IPO row (T-292 P2-5).
 *
 * A row's first insert has no history to corroborate against — whichever source
 * happens to run first gets to assert open/close/listing dates unopposed. Only the
 * exchanges themselves (NSE/BSE), the regulatory filing (DRHP), or a manual admin
 * override are authoritative enough to do that alone. A mid-trust aggregator
 * (Moneycontrol, Chittorgarh, the generic API fallback) asserting dates on a row
 * nobody else has touched yet is exactly the Priority Jewels shape: December 2026
 * open/close dates rendered as fact from a single uncorroborated source, on a page
 * where every other unknown honestly renders TBA/N/A.
 */

const AUTHORITATIVE_HARD_DATE_SOURCES_ON_CREATE = ['NSE', 'BSE', 'DRHP', 'ADMIN'] as const;

/**
 * @returns true when `source` may assert open/close/listing dates on a FIRST
 *          insert without a second corroborating source. False for any other
 *          source — its hard dates should be dropped (left null → renders TBA)
 *          until an authoritative source, or a later corroborating update,
 *          supplies them.
 */
export function isAuthoritativeForHardDatesOnCreate(source: string): boolean {
  return (AUTHORITATIVE_HARD_DATE_SOURCES_ON_CREATE as readonly string[]).includes(source);
}
