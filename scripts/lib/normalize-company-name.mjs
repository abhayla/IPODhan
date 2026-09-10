/**
 * Plain-JS port of normalizeCompanyNameForMatching AND rowKeyForName
 * (packages/shared/src/utils/company-name-normalizer.ts).
 *
 * This repo's CI gate scripts run with plain `node scripts/*.mjs` — no
 * `npm ci`, no @ipodhan/shared build step (see scripts/lib/generate-ipo-slug.mjs
 * for the same pattern already in use). This file mirrors the function bodies
 * verbatim so a drift from the SSOT is a diff a reviewer can spot line-for-line
 * rather than a silent behavior split. Parity is enforced by
 * scripts/tests/normalize-company-name-parity.test.mjs, which imports BOTH
 * this copy and the SSOT .ts file directly (Node 22.10+ strips erasable
 * TypeScript syntax on import) and asserts identical output on a name set.
 *
 * SSOT: packages/shared/src/utils/company-name-normalizer.ts — keep in lock-step.
 */
import { createHash } from 'node:crypto';

// Each `.replace(...)` below is tagged RULE <n> in a trailing comment and
// carries the SSOT's own comment condensed. The tags are load-bearing for
// scripts/tests/normalize-company-name-parity.test.mjs's per-rule mutation
// proof (delete ONE tagged rule, the parity test must go red naming it) —
// do not renumber existing tags when adding a rule; append a new number.
export function normalizeCompanyNameForMatching(companyName) {
  if (!companyName) return '';

  return companyName
    .toLowerCase()
    .trim()
    // RULE 1: strip a trailing 1-2 letter status/category code appended
    // AFTER the legal suffix ("Ltd. O", "Ltd. LT") — scrape artifact.
    .replace(/(\bltd\.?|\blimited)\s+[a-z]{1,2}$/i, '$1')
    // RULE 2: strip a trailing KNOWN status code even when it trails a
    // redundant parenthetical ("Ltd. (X IPO) O").
    .replace(/\s+(o|p|lt|ct)$/i, '')
    // RULE 3: periods to spaces (do this before the suffix chain).
    .replace(/\./g, ' ')
    // RULE 4: "&" to " and " so "&"-vs-"and" variants line up.
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
    // RULE 5: strip a trailing parenthetical block ("(Company Name IPO)")
    // BEFORE the legal-suffix chain.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    // RULE 6: fold parens to spaces (separators, not semantic content) —
    // BEFORE the corporate-word strip so a mid-string "(India)" doesn't
    // block an end-anchored corporate-suffix match.
    .replace(/[()]/g, ' ')
    // RULE 7: fold hyphens to spaces — same separators-first reasoning;
    // "Hy-Tech Engineers Limited" and "Hy Tech Engineers Ltd" must reach
    // one key.
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // RULE 8: strip a trailing " ipo" token.
    .replace(/\s+ipo$/i, '')
    // RULE 9: strip a trailing " fpo" token.
    .replace(/\s+fpo$/i, '')
    // RULE 10: WHOLE-WORD (not end-anchored) corporate-form strip, ONE
    // combined regex — a corporate-form word carries no identity wherever
    // it appears ("IC Electricals Co.Ltd." / "IC Electricals Company" ->
    // one key). Longer forms precede their prefixes so "private limited" is
    // consumed as a unit. \b is load-bearing (else "co" matches inside
    // "Cocoa"). Deliberately absent: "india", "and", "the", "of" — those
    // belong to the coarser foldCompanyIdentity key, not this one.
    .replace(
      /\b(?:private\s+limited|pvt\.?\s+ltd\.?|limited|ltd|private|pvt|incorporated|inc|corporation|corp|company|co|llc|llp|plc)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
    // RULE 11: strip a TRAILING "india"/"indian" token only (not leading or
    // medial — "Indian Railway Finance", "East India Drums" keep their
    // identity), guarded so "bank of india" -> "bank of", never "bank".
    .replace(/(?<!of)(?<!for)\s+(india|indian)$/i, '')
    .trim();
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
 *
 * SSOT: packages/shared/src/utils/company-name-normalizer.ts — keep in lock-step.
 */
export const JUNK_NAME_KEY_PREFIX = 'junk:';

/**
 * The ONE row-key function used by BOTH the backfill
 * (`scraper/scripts/backfill-normalized-name.ts`) and every write path for
 * `promoters`, `peer_companies` and `ipo_intermediaries`: depends ONLY on the
 * name, never a row id (write paths are delete-then-insert, so an id-derived
 * key can never be reproduced by a re-scrape of the same name).
 *
 * - Normal path (byte-identical to `normalizeCompanyNameForMatching` today):
 *   a name that normalizes to a non-empty string returns that string.
 * - Junk path: a name that normalizes to '' but still has non-whitespace raw
 *   content returns a STABLE key derived only from the TRIMMED RAW NAME —
 *   `${JUNK_NAME_KEY_PREFIX}<sha1 hex of the trimmed raw name>`.
 * - No-identity path: null, undefined, empty, or whitespace-only input
 *   returns `null` — the row carries no identity and the caller MUST skip
 *   writing it rather than invent one.
 *
 * SSOT: packages/shared/src/utils/company-name-normalizer.ts — keep in lock-step.
 */
export function rowKeyForName(rawName) {
  const normalized = normalizeCompanyNameForMatching(rawName ?? '');
  if (normalized !== '') return normalized;

  const trimmedRaw = (rawName ?? '').trim();
  if (trimmedRaw === '') return null;

  const digest = createHash('sha1').update(trimmedRaw).digest('hex');
  return `${JUNK_NAME_KEY_PREFIX}${digest}`;
}
