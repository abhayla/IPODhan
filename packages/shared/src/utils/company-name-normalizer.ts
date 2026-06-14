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
 * JS normalizer. Lowercase, trim, strip a trailing 1-2 letter status code that
 * some sources append after the legal suffix (#16), strip IPO/FPO + legal
 * suffixes, collapse whitespace.
 */
export function normalizeCompanyNameForMatching(companyName: string): string {
  if (!companyName) return '';

  return companyName
    .toLowerCase()
    .trim()
    // Strip a trailing 1-2 letter status/category code appended AFTER the legal
    // suffix (e.g. "Ltd. O", "Ltd. LT") — scrape artifacts (#16).
    .replace(/(\bltd\.?|\blimited)\s+[a-z]{1,2}$/i, '$1')
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
                        ${input},
                        '(Ltd\\.?|Limited)\\s+[A-Za-z]{1,2}$', '\\1', 'i'
                      ),
                      '\\s+(IPO|FPO)$', '', 'i'
                    ),
                    '\\s+(Limited|Ltd\\.?)$', '', 'i'
                  ),
                  '\\s+(Private\\s+Limited|Pvt\\.?\\s+Ltd\\.?)$', '', 'i'
                ),
                '\\s+(Pvt\\.?|Private)$', '', 'i'
              ),
              '\\s+(Inc\\.?|Incorporated)$', '', 'i'
            ),
            '\\s+(Corp\\.?|Corporation)$', '', 'i'
          ),
          '\\s+(LLC|LLP|PLC)$', '', 'i'
        ),
        '\\s+', ' ', 'g'
      )
    )
  )`;
}
