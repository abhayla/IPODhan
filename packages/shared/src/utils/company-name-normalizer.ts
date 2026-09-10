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
import { createHash } from 'node:crypto';

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
    // Strip a trailing KNOWN status code even when it trails a redundant
    // parenthetical ("Ltd. (X IPO) O") — the ltd-anchored rule above only
    // fires when the code sits immediately after the legal suffix (#42, P3-1).
    // Enumerated (not a blanket 1-2 letter strip) to avoid over-stripping a
    // genuine short trailing word.
    .replace(/\s+(O|P|LT|CT)$/i, '')
    // Strip a redundant trailing parenthetical descriptor ("Ltd. (Company Name
    // IPO)") once it is at the absolute end of the string — a scrape artifact
    // (#42, P3-1). A genuine parenthetical ("Horizon Reclaim (India) Ltd.")
    // precedes the legal suffix, so it is never at the end and survives.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
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
    // Strip a trailing KNOWN status code even when it trails a redundant
    // parenthetical ("Ltd. (X IPO) O") — the ltd-anchored rule above only
    // fires when the code sits immediately after the legal suffix (P3-1;
    // keep in lock-step with `sanitizeDisplayCompanyName` and the SQL twin).
    .replace(/\s+(o|p|lt|ct)$/i, '')
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
    // SEPARATORS FIRST (item 12 slice B). Parens and hyphens are separators,
    // not semantic content, and they used to be folded AFTER the corporate-word
    // strip. That ordering is exactly what let "ASSET RECONSTRUCTION COMPANY
    // (INDIA) LIMITED" and "Asset Reconstruction Co.(India) Ltd." keep two
    // identities: the strip was END-ANCHORED, so a mid-string "(India)" sat
    // between "company"/"co" and the end of the string and blocked it. Folding
    // the separators first removes the blocker.
    .replace(/[()]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+ipo$/i, '')
    .replace(/\s+fpo$/i, '')
    // WHOLE-WORD, not end-anchored. A corporate-form word carries no identity
    // wherever it appears, so "IC Electricals Co.Ltd." and "IC Electricals
    // Company" reach one key. Longer forms precede their prefixes so "private
    // limited" is consumed as a unit instead of leaving a stray word.
    //
    // THE \b IS LOAD-BEARING. Without it "co" matches inside "Cocoa" and
    // "corp" inside "Corporate"; an earlier draft of this very change lost the
    // word boundaries to a string-escaping bug and would have merged unrelated
    // companies. Any edit here re-runs the collision report below.
    //
    // DELIBERATELY ABSENT: "india", "and", "the", "of". Those belong to
    // `foldCompanyIdentity`, a COARSER key used by the duplicate-row repair
    // class. Adding them here would quietly turn the binding key into the fold
    // and merge companies that differ only by a country word.
    //
    // Proven over real names BEFORE it shipped: production 333 rows -> 333
    // distinct identities (ZERO merges, no behaviour change at all); staging
    // merges exactly ONE group, the ARCIL pair this slice exists for.
    .replace(
      /\b(?:private\s+limited|pvt\.?\s+ltd\.?|limited|ltd|private|pvt|incorporated|inc|corporation|corp|company|co|llc|llp|plc)\b/gi,
      ' '
    )
    // Item 12 slice E's closing fix: a TRAILING country token only.
    //
    // The grey-market source writes "Jindal Supreme" where we store "Jindal
    // Supreme (India) Ltd." - four live IPOs lost their GMP binding to exactly
    // this and nothing else. By here the parens are already spaces and the
    // corporate words are gone, so the country word is simply the last token.
    //
    // TRAILING ONLY, and the narrowing is load-bearing: a leading or medial
    // "India" is part of the identity, not decoration - INDIAN RAILWAY FINANCE,
    // INDIAN OVERSEAS BANK, EAST INDIA DRUMS, STALLION INDIA FLUOROCHEMICALS,
    // Sampark India Logistics all exist in production and must keep it. An
    // anywhere-rule measures identically on today's data and would merge the
    // first "X India" / "X" pair that ever appears.
    //
    // KNOWN LIMIT, stated rather than discovered later: a name whose LAST word
    // is genuinely part of the identity ("Bank of India") is also trailing and
    // would be stripped to "bank of". No such name exists in either database
    // today, and it only does harm if the stripped form collides with another
    // company - but that is the case to watch, not a case this rule handles.
    //
    // Measured before shipping: production 333 names -> 333 identities, ZERO
    // newly merged; staging 349 -> 349 with ONE, the ARCIL pair, which is the
    // same company and the merge this slice exists to make.
    // Collapse and trim FIRST: the corporate strip above replaces words with
    // SPACES, so at this point the string still ends in whitespace and a
    // $-anchored match would silently never fire. The code read correctly and
    // did nothing - caught by running it, not by reading it.
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(india|indian)$/i, '')
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
  // Item 12 slice B. Step order mirrors normalizeCompanyNameForMatching exactly.
  // The INNERMOST REGEXP_REPLACE runs FIRST, so relative to the JS chain this
  // reads bottom-up: trailing-status-code strip innermost, whitespace collapse
  // outermost.
  //
  // Two changes, matching the JS side:
  //   1. paren and hyphen folds moved ABOVE the corporate-word strip - a
  //      mid-string parenthetical used to block an END-ANCHORED strip;
  //   2. ten end-anchored suffix replaces collapse into ONE word-bounded global
  //      replace. Postgres spells the word boundary \\y and it is load-bearing:
  //      without it Co matches inside Cocoa and Corp inside Corporate.
  //
  // EVERY backslash below is DOUBLED because this is a template literal: JS
  // collapses the pair to one before Postgres sees it. A single backslash is
  // silently eaten, and a single-backslash 1 backreference is an illegal octal
  // escape that truncates the literal. BOTH happened on the first attempt.
  //
  // Agreement with the JS side is gated by
  // scraper/tests/integration/normalizer-sql-agreement.integration.test.ts.
  return sql`REGEXP_REPLACE(
  LOWER(
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
      ${input},
      '(Ltd\\.?|Limited)\\s+[A-Za-z]{1,2}$',
      '\\1',
      'i'
    ),
      '\\s+(O|P|LT|CT)$',
      '',
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
      '',
      'g'
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
    ),
      '^\\s+|\\s+$',
      '',
      'g'
    ),
      '\\s+(IPO|FPO)$',
      '',
      'i'
    ),
      '\\y(Private\\s+Limited|Pvt\\.?\\s+Ltd\\.?|Limited|Ltd|Private|Pvt|Incorporated|Inc|Corporation|Corp|Company|Co|LLC|LLP|PLC)\\y',
      ' ',
      'gi'
    ),
      '\\s+',
      ' ',
      'g'
    )
  )
),
  '\\s+(india|indian)$',
  '',
  'i'
)`;
}

/**
 * Prefix for the derived key `rowKeyForName` mints when a name is non-empty
 * junk (pure punctuation/symbols, e.g. "----", "(())") that normalizes to
 * ''. `normalizeCompanyNameForMatching` only strips `.` `&` `(` `)` `-` (plus
 * whitespace collapse and lowercasing) — it does NOT strip other punctuation,
 * so a genuine normalized key can contain colons, commas, slashes, quotes,
 * etc. alongside lowercase letters/digits/spaces. This prefix therefore
 * collides with a genuine normalized key only in the practically-impossible
 * case where a real company name normalizes to EXACTLY `junk:` followed by
 * 40 lowercase hex characters (the sha1 hex alphabet) — no real company name
 * takes that shape. Greppable: `grep -r "junk:" ` finds every call site that
 * reads or writes this shape.
 */
export const JUNK_NAME_KEY_PREFIX = 'junk:';

/**
 * The ONE row-key function used by BOTH the backfill
 * (`scraper/scripts/backfill-normalized-name.ts`) and every write path for
 * `promoters`, `peer_companies` and `ipo_intermediaries` (Tier A round-2
 * finding, 2026-09-09): the backfill previously minted `__empty__:<row id>`
 * for a junk name, but the write paths are delete-then-insert — row ids are
 * regenerated on every scrape, so an id-derived key can never be reproduced
 * by a re-scrape of the same name. This function depends ONLY on the name.
 *
 * - Normal path (byte-identical to `normalizeCompanyNameForMatching` today
 *   — no existing key changes): a name that normalizes to a non-empty
 *   string returns that string.
 * - Junk path: a name that normalizes to '' but still has non-whitespace
 *   raw content returns a STABLE key derived only from the TRIMMED RAW
 *   NAME — `${JUNK_NAME_KEY_PREFIX}<sha1 hex of the trimmed raw name>` —
 *   never a row id, a timestamp, or anything a delete-then-insert write
 *   path regenerates. Two rows with the SAME junk name intentionally
 *   collide on this key (they are the same name — that is what the
 *   slice-s2 `UNIQUE (ipo_id, normalized_name)` constraint is for).
 * - No-identity path: null, undefined, empty, or whitespace-only input
 *   returns `null` — the row carries no identity and the caller MUST skip
 *   writing it rather than invent one.
 */
export function rowKeyForName(rawName: string | null | undefined): string | null {
  const normalized = normalizeCompanyNameForMatching(rawName ?? '');
  if (normalized !== '') return normalized;

  const trimmedRaw = (rawName ?? '').trim();
  if (trimmedRaw === '') return null;

  const digest = createHash('sha1').update(trimmedRaw).digest('hex');
  return `${JUNK_NAME_KEY_PREFIX}${digest}`;
}
