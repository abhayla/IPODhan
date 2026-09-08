/**
 * Plain-JS port of normalizeCompanyNameForMatching
 * (packages/shared/src/utils/company-name-normalizer.ts).
 *
 * This repo's CI gate scripts run with plain `node scripts/*.mjs` — no
 * `npm ci`, no @ipodhan/shared build step (see scripts/lib/generate-ipo-slug.mjs
 * for the same pattern already in use). This file mirrors the function body
 * verbatim so a drift from the SSOT is a diff a reviewer can spot line-for-line
 * rather than a silent behavior split. Parity is enforced by
 * scripts/tests/normalize-company-name-parity.test.mjs, which imports BOTH
 * this copy and the SSOT .ts file directly (Node 22.10+ strips erasable
 * TypeScript syntax on import) and asserts identical output on a name set.
 *
 * SSOT: packages/shared/src/utils/company-name-normalizer.ts — keep in lock-step.
 */
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
