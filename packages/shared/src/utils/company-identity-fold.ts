/**
 * The single TypeScript home for the COMPANY-IDENTITY FOLD.
 *
 * WHAT THIS IS. A compact identity key: corporate-form words and the country
 * carry no identity, so "Asset Reconstruction Co.(India) Ltd." and "ASSET
 * RECONSTRUCTION COMPANY (INDIA) LIMITED" fold to one string (F-55 — "Company"
 * vs "Co." never collided under the binding normaliser at the time).
 *
 * WHAT THIS IS NOT, and this distinction is load-bearing. This is NOT
 * `normalizeCompanyNameForMatching` in `company-name-normalizer.ts`. That one
 * is the BINDING key: it keeps spaces, its suffix chain is END-ANCHORED, and
 * its word list differs. The two are deliberately independent so that a change
 * to the binding normaliser (item 12 slice B) does not silently change what a
 * data-repair tool considers "the same company" — a repair tool that quietly
 * widens its notion of sameness deletes rows it should not.
 *
 * Item 12 slice A extracted this body VERBATIM from
 * `duplicate-ipo-merge.ts:26` (`foldCompanyName`), which now re-exports it.
 * There is no behaviour change in this slice.
 *
 * `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs` keeps its own hand
 * copy as `foldName` because it is a plain-node script that cannot import
 * TypeScript. `scripts/tests/company-identity-fold-parity.test.mjs` asserts the
 * two agree over `IDENTITY_FOLD_FIXTURE`, so the copy cannot drift unnoticed.
 */

/** Corporate-form words and country words that carry no company identity. */
const NON_IDENTITY_WORDS =
  /\b(private|pvt|limited|ltd|company|co|corporation|corp|incorporated|inc|and|the|of|india|indian)\b/g;

/** Punctuation folded to a space BEFORE the word strip, so "Co.(India)" splits into words. */
const PUNCTUATION = /[.,()&'"-]/g;

/**
 * Fold a company name to its identity key. Null-safe; always returns a string.
 * Two names folding equal are treated as the same company by the duplicate-row
 * repair class — so this erring wide DELETES real rows, and every change here
 * must be proven against real names by `scripts/audit/fold-collision-report.mjs`.
 */
export function foldCompanyIdentity(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .replace(NON_IDENTITY_WORDS, ' ')
    .replace(/\s+/g, '');
}

/**
 * The shared name set the `.mjs` parity test folds through BOTH implementations.
 * Real Indian IPO names, chosen to cover the cases that matter: the ARCIL
 * suffix pair, near-miss names that must stay apart, embedded keywords, and
 * punctuation shapes. Kept here so the fixture has one home, not two.
 */
export const IDENTITY_FOLD_FIXTURE: readonly string[] = [
  'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED',
  'Asset Reconstruction Co.(India) Ltd.',
  'Sun Pharmaceutical Industries Ltd',
  'Sunrise Pharmaceutical Industries Ltd',
  'Atharva Polyplast Limited',
  'Atharva Polymers Limited',
  'Coal India Limited',
  'Vikran Engineering Ltd',
  'Neochem Bio Ventures Limited',
  'ESDS Software Solution Limited',
  'Indo-MIM Limited',
  'INDO MIM LTD',
  'Kwality Walls (India) Ltd',
  'Morganite Crucible India Ltd',
  'Windlas Biotech Ltd',
  'CMS Info Systems Ltd',
  'Muthoot Fincorp Limited',
  'Nirbhay Colours India Ltd',
  'Sanmitra Commercial Ltd',
  'Shipwaves Online Limited',
  'Western Overseas Study Abroad Limited',
  'Maruti Interior Products Ltd',
  'Twinkle Papers',
  'Jay Bee Laminations Ltd. O',
  'Tata Consultancy Services Private Limited',
];
