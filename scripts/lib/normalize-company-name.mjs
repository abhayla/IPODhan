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

export function normalizeCompanyNameForMatching(companyName) {
  if (!companyName) return '';

  return companyName
    .toLowerCase()
    .trim()
    .replace(/(\bltd\.?|\blimited)\s+[a-z]{1,2}$/i, '$1')
    .replace(/\s+(o|p|lt|ct)$/i, '')
    .replace(/\./g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
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
