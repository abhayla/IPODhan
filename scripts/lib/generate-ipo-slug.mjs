/**
 * Plain-JS port of generateIPOSlug (packages/shared/src/utils/slug.ts).
 *
 * This repo's audit scripts run with `node scripts/*.mjs` directly — no
 * `npm ci`, no build step for @ipodhan/shared (packages/shared/dist is not
 * checked in and this worktree has no node_modules). The same pattern
 * already exists in scripts/lib/seo-surface-checks.mjs (which re-derives
 * the legal-suffix stripping rule rather than importing the TS source).
 * This file mirrors the FULL function body verbatim so a drift in the SSOT
 * is a diff a reviewer can spot line-for-line, not a silent behavior split.
 *
 * SSOT: packages/shared/src/utils/slug.ts — keep this in lockstep with it.
 */
export function generateIPOSlug(companyName, options = {}) {
  if (!companyName) return '';
  const { suffix = '', maxLength = 100 } = options;

  let slug = companyName
    .toLowerCase()
    .trim()
    .replace(/\s+ipo$/i, '')
    .replace(/\s+fpo$/i, '')
    .replace(/\s+limited$/i, '-ltd')
    .replace(/\s+ltd\.?$/i, '-ltd')
    .replace(/\s+private\s+limited$/i, '-private-ltd')
    .replace(/\s+pvt\.?\s+ltd\.?$/i, '-pvt-ltd')
    .replace(/\s+pvt\.?$/i, '-pvt')
    .replace(/\s+private$/i, '-private')
    .replace(/\s+inc\.?$/i, '-inc')
    .replace(/\s+incorporated$/i, '-incorporated')
    .replace(/\s+corp\.?$/i, '-corp')
    .replace(/\s+corporation$/i, '-corporation')
    .replace(/\s+llc$/i, '-llc')
    .replace(/\s+llp$/i, '-llp')
    .replace(/\s+plc$/i, '-plc')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/@/g, ' at ')
    .replace(/%/g, ' percent ')
    .replace(/₹/g, ' rs ')
    .replace(/\$/g, ' dollar ')
    .replace(/€/g, ' euro ')
    .replace(/£/g, ' pound ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  if (suffix) slug = `${slug}${suffix}`;
  if (slug.length > maxLength) slug = slug.substring(0, maxLength).replace(/-+$/, '');
  return slug;
}
