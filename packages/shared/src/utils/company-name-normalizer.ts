/**
 * Canonical company-name normalizer (A3 / #6 #8 #16).
 *
 * ONE source of truth for normalizing a company name so the same name expressed
 * differently ("Midwest Ltd", "Midwest Limited", "Midwest Ltd. IPO") collapses to
 * a single key for matching GMP/subscription rows to IPOs.
 *
 * Two faces of the SAME rules:
 *  - `normalizeCompanyNameForMatching` — the JS path (scraper data-persister).
 *  - `normalizedCompanyNameSql`        — the SQL path (ipo-repository query-time).
 *
 * They MUST stay in lock-step. `company-name-normalizer.agreement` integration
 * test runs a ≥30-name fixture through BOTH and fails on any divergence.
 */

import { sql, type SQL } from 'drizzle-orm';

/**
 * Canonical DISPLAY-name sanitizer (#42). Unlike `normalizeCompanyNameForMatching`
 * (which strips the legal suffix to build a dedup key), this KEEPS the legal
 * suffix but removes scrape artifacts: HTML tags/angle brackets, surrounding
 * whitespace, and a trailing 1-2 letter status/category code appended after the
 * legal suffix ("Ltd. O", "Ltd. P", "Ltd. LT", "Ltd. CT"). Length-capped at 200.
 *
 * This is the SINGLE source of truth for the stored display name. It is applied
 * at the `IPORepository` write choke point so every write path (create / update /
 * consolidation) persists a clean name, and the scraper's `sanitizeCompanyName`
 * delegates to it. Keep this regex in lock-step with the trailing-token rule in
 * `normalizeCompanyNameForMatching` / `normalizedCompanyNameSql`.
 */
export function sanitizeDisplayCompanyName(name: string | null | undefined): string {
  if (!name) return '';

  return name
    .replace(/<\/?[a-z][a-z0-9]*[^>]*>/g, '') // strip HTML tags (lowercase only)
    .replace(/[<>]/g, '') // strip remaining angle brackets
    .trim()
    // Strip a trailing 1-2 letter status/category code appended AFTER the legal
    // suffix ("Ltd. O", "Ltd. P", "Ltd. LT") — a scrape artifact (#16/#42). Keep
    // the suffix itself.
    .replace(/(\bLtd\.?|\bLimited)\s+[A-Za-z]{1,2}$/i, '$1')
    // Strip a trailing " IPO"/" FPO" — Chittorgarh display names arrive as
    // "Twinkle Papers IPO"; the instrument label is not part of the company
    // name (#42; matching normalizer already strips it — keep in lock-step).
    .replace(/\s+(IPO|FPO)$/i, '')
    .trim()
    .slice(0, 200);
}

/**
 * JS normalizer. Lowercase, trim, strip a trailing 1-2 letter status code that
 * some sources append after the legal suffix (#16), strip IPO/FPO + legal
 * suffixes, collapse whitespace.
 *
 * P2-1 (round-2 review): a period-joined suffix ("Engg.Ltd."), an ampersand
 * variant ("X & Y" vs "X and Y"), a redundant trailing parenthetical
 * ("Ltd. (Company Name IPO)"), or a mid-string paren/hyphen ("(India)",
 * "Indo-MIM" vs "INDO MIM") must NOT mint a second identity for the same
 * company — fold all of these to a common token before the legal-suffix
 * chain runs, so a re-scrape's slug/normalized-name lookup finds the
 * existing row instead of inserting a duplicate.
 */
export function normalizeCompanyNameForMatching(companyName: string): string {
  if (!companyName) return '';

  return companyName
    .toLowerCase()
    .trim()
    // Strip a trailing 1-2 letter status/category code appended AFTER the legal
    // suffix (e.g. "Ltd. O", "Ltd. LT") — scrape artifacts (#16).
    .replace(/(\bltd\.?|\blimited)\s+[a-z]{1,2}$/i, '$1')
    // Punctuation normalization (P2-1) — do this BEFORE the suffix chain so a
    // period-joined suffix or an "&"-vs-"and" variant lines up with its sibling.
    .replace(/\./g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
    // Strip a trailing parenthetical block ("(Company Name IPO)") BEFORE the
    // legal-suffix chain — scrapers sometimes append a redundant descriptive
    // suffix in parens after the real legal suffix.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .replace(/\s+ipo$/i, '')
    .replace(/\s+fpo$/i, '')
    .replace(/\s+limited$/i, '')
    .replace(/\s+ltd\.?$/i, '')
    .replace(/\s+private\s+limited$/i, '')
    .replace(/\s+pvt\.?\s+ltd\.?$/i, '')
    .replace(/\s+pvt\.?$/i, '')
    .replace(/\s+private$/i, '')
    .replace(/\s+inc\.?$/i, '')
    .replace(/\s+incorporated$/i, '')
    .replace(/\s+corp\.?$/i, '')
    .replace(/\s+corporation$/i, '')
    .replace(/\s+llc$/i, '')
    .replace(/\s+llp$/i, '')
    .replace(/\s+plc$/i, '')
    // Any remaining parens (mid-string, e.g. "(India)") and hyphens are
    // separators, not semantic content — fold to spaces so "Indo-MIM" and
    // "INDO MIM", or "Gulf Lloyds (India)" and "Gulf Lloyds India", agree.
    .replace(/[()]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SQL normalizer — the same rules applied to a SQL expression (a column or a
 * bound literal) at query time. Uses `\s+` for the inter-token gaps so it agrees
 * with the JS path on multi-space input too (the JS path uses `\s+` throughout).
 *
 * @param input a drizzle `sql` expression yielding the raw company name
 */
/**
 * Word-break fold for DEDUP MATCHING only (P2-1 checker finding, T-277F). A
 * hyphenated compound ("Atharva Poly-Plast") and its run-together sibling
 * ("Atharva Polyplast") land on different tokens under the primary
 * normalizer — "atharva poly plast" (hyphen -> space) vs "atharva polyplast"
 * (no separator at all) — and never converge on the spaced identity alone.
 *
 * This is a SEPARATE, coarser identity: strip every remaining space from the
 * already-normalized key. It is used only as a duplicate-match FALLBACK (see
 * `ipo-repository.ts findByNormalizedName`), never as the primary/display
 * key — every existing consumer of the spaced `normalizeCompanyNameForMatching`
 * output is unaffected, and two names that already agree on the spaced key
 * trivially agree here too (exact match is a subset of compact match).
 *
 * Because this only removes whitespace (never merges letters across an
 * actual semantic boundary), two names that differ in their letters still
 * produce different compact keys — e.g. "Atharva Polyplast" vs
 * "Atharva Polymers" stay "atharvapolyplast" vs "atharvapolymers".
 */
export function compactCompanyNameKey(companyName: string): string {
  return normalizeCompanyNameForMatching(companyName).replace(/\s+/g, '');
}

/**
 * SQL twin of `compactCompanyNameKey` — strips all whitespace from the
 * SQL-normalized key so the fallback match in `findByNormalizedName` agrees
 * with the JS path.
 */
export function compactNormalizedCompanyNameSql(input: SQL): SQL {
  return sql`REGEXP_REPLACE(${normalizedCompanyNameSql(input)}, '\\s+', '', 'g')`;
}

export function normalizedCompanyNameSql(input: SQL): SQL {
  return sql`LOWER(
  TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    REGEXP_REPLACE(
                      REGEXP_REPLACE(
                        REGEXP_REPLACE(
                          REGEXP_REPLACE(
                            REGEXP_REPLACE(
                              REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                  REGEXP_REPLACE(
                                    ${input},
                                      '(Ltd\\.?|Limited)\\s+[A-Za-z]{1,2}$',
                                      '\\1',
                                      'i'
                                  ),
                                    '\\.',
                                    ' ',
                                    'g'
                                ),
                                  '&',
                                  ' and ',
                                  'g'
                              ),
                                '\\s+',
                                ' ',
                                'g'
                            ),
                              '^\\s+|\\s+$',
                              '',
                              'g'
                          ),
                            '\\s*\\([^)]*\\)\\s*$',
                            ''
                        ),
                          '\\s+(IPO|FPO)$',
                          '',
                          'i'
                      ),
                        '\\s+(Limited|Ltd\\.?)$',
                        '',
                        'i'
                    ),
                      '\\s+(Private\\s+Limited|Pvt\\.?\\s+Ltd\\.?)$',
                      '',
                      'i'
                  ),
                    '\\s+(Pvt\\.?|Private)$',
                    '',
                    'i'
                ),
                  '\\s+(Inc\\.?|Incorporated)$',
                  '',
                  'i'
              ),
                '\\s+(Corp\\.?|Corporation)$',
                '',
                'i'
            ),
              '\\s+(LLC|LLP|PLC)$',
              '',
              'i'
          ),
            '[()]',
            ' ',
            'g'
        ),
          '-',
          ' ',
          'g'
      ),
        '\\s+',
        ' ',
        'g'
    )
  )
)`;
}
