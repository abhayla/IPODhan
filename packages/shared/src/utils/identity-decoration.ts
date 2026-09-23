/**
 * OD-68 (docs/design/data-sourcing-pull-model.md §0.0.1, §2.3.3.2 S1/S3):
 * "Before any identity match, page-status suffixes (-o, -p, -lt, -ct) and
 * page-title text ((... IPO), -<name>-ipo) are stripped from the incoming
 * name and slug."
 *
 * The ONE implementation of that stripping. `scripts/lib/detection-floor-checks.mjs`
 * (the nightly `i_same_ipo_two_rows` check) keeps a plain-JS copy because a
 * plain-node script cannot import TypeScript at runtime on the VPS;
 * `scripts/tests/identity-decoration-parity.test.mjs` imports BOTH and fails on
 * any divergence, so the matching rule and the check that audits it cannot
 * drift apart. Same pattern as company-identity-fold-parity.test.mjs.
 *
 * Deliberately import-free and erasable-TS only, so that parity test can load
 * it through Node's type-stripping.
 *
 * RCA it serves (2026-09-01, live on prod and staging): an aggregator row
 * arrived as "Rays of Belief Ltd. O"; its slug was computed from the raw name
 * (`rays-of-belief-ltd-o`) and its name matched nothing, so a second row was
 * created beside `rays-of-belief-ltd` ("Rays of Belief Limited- For Profit
 * Social Enterprise") for the same offering.
 */

const IDENTITY_STOPWORDS = new Set([
  'limited', 'ltd', 'company', 'co', 'private', 'pvt', 'india', 'the', 'ipo',
]);

/** Page-status codes some sources append after the legal suffix ("Ltd. O"). */
const STATUS_TOKEN = /\s+(o|p|lt|ct)$/i;

/**
 * S1: a page-status suffix (-o/-p/-lt/-ct) on an otherwise identical slug.
 * An OFS slug (`-ofs-2026`, `-ofs-unknown`) never ends in one of these, so it
 * passes through untouched.
 */
export function stripIdentitySlugSuffix(slug: string | null | undefined): string {
  if (!slug) return '';
  return String(slug).replace(/-(o|p|lt|ct)$/i, '');
}

/**
 * S3 + S1 on a NAME, keeping it readable (legal suffix and case kept), so the
 * result can be slugged and stored: drops a trailing parenthetical title
 * ("Ltd. (Pernia's Pop-Up Studio IPO)"), everything after a " - " / "- "
 * separator ("Limited- For Profit Social Enterprise"), a trailing page-status
 * token ("Ltd. O") and a trailing " IPO"/" FPO".
 *
 * A hyphen WITHOUT a following space ("Indo-MIM", "Hi-Tech") is part of the
 * name and survives; so does a mid-string "(India)".
 */
export function stripIdentityNameDecoration(name: string | null | undefined): string {
  if (!name) return '';
  let s = String(name).trim();
  // Trailing parenthetical, possibly followed by a status token: "Ltd. (X IPO) O".
  s = s.replace(STATUS_TOKEN, '').trim();
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  s = s.split(/\s+-\s+|-\s+(?=[A-Za-z])/)[0].trim();
  s = s.replace(STATUS_TOKEN, '').trim();
  s = s.replace(/\s+(IPO|FPO)$/i, '').trim();
  return s;
}

/**
 * The identity fold (OD-68 "normalised name"): decoration stripped, bracketed
 * text dropped, punctuation folded, corporate-form stopwords dropped.
 * "Rays of Belief Limited- For Profit Social Enterprise" and
 * "Rays of Belief Ltd. O" both fold to "rays of belief"; "Himalayan Solar Ltd."
 * and "Himalaya Nutravedics India Ltd." do not meet (S6).
 */
export function normalizeIdentityCompanyName(name: string | null | undefined): string {
  if (!name) return '';
  const s = stripIdentityNameDecoration(name).replace(/\([^)]*\)/g, ' ');
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !IDENTITY_STOPWORDS.has(t))
    .join(' ');
}
