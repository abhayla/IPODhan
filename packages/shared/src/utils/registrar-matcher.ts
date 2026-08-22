/**
 * Registrar name -> registrars.id resolver (P3-2, T-278).
 *
 * `ipos.registrar` (free-text) has always been populated by every scraper
 * write path; `ipos.registrar_id` (the FK to the 15-row `registrars`
 * reference table) has NEVER been written by any write path — verified 0/328
 * rows populated in prod, 2026-08-22. This is the pure matching core: exact
 * normalized-name matching only (strip legal suffix, case, punctuation), plus
 * a small alias table for known corporate renames a normalizer cannot bridge
 * (e.g. Link Intime India Pvt Ltd rebranded to MUFG Intime India Pvt Ltd —
 * different words, same registrar). An unmatched name returns null and is
 * NEVER guessed at with a fuzzy/partial match — a wrong registrar_id would
 * point a user's allotment check at someone else's registrar.
 */

export interface RegistrarLookupRow {
  id: string;
  name: string;
  shortName: string | null;
}

/** Known post-rename aliases that a legal-suffix normalizer cannot bridge. */
const REGISTRAR_ALIASES: Record<string, string> = {
  // MUFG Intime India Pvt Ltd is Link Intime India Pvt Ltd's post-2023 rebrand.
  'mufg intime india': 'link intime india',
  // Single-letter-drop typo ("Servies" for "Services") seen in prod scrape data —
  // an explicit alias, not fuzzy matching, so it never risks a wrong guess (T-278F).
  'bigshare servies': 'bigshare services',
};

function normalizeRegistrarName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Drop an address/contact block riding on the same string, delimited by '^'
    // (a known scrape-pollution artifact — see scraper's sanitizeRegistrar) —
    // MUST run before the parenthetical strip so an address containing '(' text
    // doesn't confuse it (T-278F).
    .replace(/\^.*$/, '')
    .trim()
    // Drop a parenthetical rename note ("(formerly known as ...)").
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    // Drop curly/straight quotes some sources wrap the old name in.
    .replace(/["“”]/g, '')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Re-insert a space where a legal suffix got glued to the preceding word
    // with no separating whitespace ("TechnologiesLimited") — a scrape
    // artifact seen in prod (T-278F), otherwise the trailing-suffix strip
    // below (anchored on `\s+`) never fires.
    .replace(/([a-z])(limited|ltd|private)\b/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(private\s+limited|pvt\.?\s+ltd\.?|private\s+ltd\.?|pvt\.?|limited|ltd\.?)$/i, '')
    .trim();
}

/** Whitespace-stripped fallback key, so "Big Share" and "Bigshare" converge —
 *  mirrors `compactCompanyNameKey`'s established word-break-fold precedent
 *  for company names (company-name-normalizer.ts). */
function compactKey(name: string): string {
  return normalizeRegistrarName(name).replace(/\s+/g, '');
}

/**
 * Resolve a free-text registrar name to a `registrars.id`, or null if it does
 * not match exactly one reference row. `registrars` is normally the full
 * result of `RegistrarRepository.findAll()` (15 rows, 7-day cached — cheap to
 * pass on every call).
 */
export function resolveRegistrarId(
  registrarName: string | null | undefined,
  registrars: RegistrarLookupRow[]
): string | null {
  if (!registrarName) return null;

  const normalizedInput = normalizeRegistrarName(registrarName);
  if (!normalizedInput) return null;

  const aliasedInput = REGISTRAR_ALIASES[normalizedInput] ?? normalizedInput;
  const compactInput = REGISTRAR_ALIASES[normalizedInput]
    ? REGISTRAR_ALIASES[normalizedInput].replace(/\s+/g, '')
    : compactKey(registrarName);

  let matches = registrars.filter((r) => {
    const normalizedName = normalizeRegistrarName(r.name);
    const normalizedShort = r.shortName ? normalizeRegistrarName(r.shortName) : null;
    return normalizedName === aliasedInput || normalizedShort === aliasedInput;
  });

  // Fallback tier: fold remaining whitespace differences ("Big Share" vs
  // "Bigshare") — only reached when the exact-normalized tier found nothing.
  if (matches.length === 0) {
    matches = registrars.filter((r) => {
      const compactName = compactKey(r.name);
      const compactShort = r.shortName ? compactKey(r.shortName) : null;
      return compactName === compactInput || compactShort === compactInput;
    });
  }

  // Ambiguous (0 or 2+) matches are never guessed at — only an unambiguous
  // exact match populates the FK.
  return matches.length === 1 ? matches[0].id : null;
}
