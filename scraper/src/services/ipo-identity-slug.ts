/**
 * Item 12 (type-check:scripts fix): `computeIpoIdentitySlug` and its
 * `ofsSlugYear` helper, split out of `data-persister.ts` so a caller that
 * needs ONLY the pure slug computation (e.g. `scripts/repair-decorated-
 * slugs.ts`) does not transitively pull in `data-persister.ts`'s heavy
 * import graph (repositories, scrapers, `financial-data-scraper.ts`'s
 * latent type errors) into `tsconfig.scripts.json`'s compilation.
 *
 * This module imports NOTHING heavy: no repositories, no scrapers, no DB
 * client. `data-persister.ts` re-exports both names so every existing
 * caller (`BaseScraperOrchestrator.ts`, `index.ts`,
 * `data-consolidation-orchestrator.ts`, tests) keeps working unchanged.
 */
import logger from '../utils/logger.js';
import { generateSlug } from '../utils/validators.js';
import { stripIdentityNameDecoration, stripIdentitySlugSuffix } from '@ipodhan/shared/utils/identity-decoration';

/**
 * T-478 round 2: the calendar year used in an OFS row's `-ofs-<year>` slug
 * suffix. Prefers openDate (the year the offering actually opened — stable
 * once known and the field this resolver already treats as the corroborating
 * identity key), falling back to closeDate, then the current UTC year for
 * the rare case a brand-new OFS row has neither yet.
 */
export function ofsSlugYear(scrapedIPO: { openDate?: string | Date | null; closeDate?: string | Date | null }): number | null {
  const candidate = scrapedIPO.openDate ?? scrapedIPO.closeDate;
  if (candidate) {
    const parsed = candidate instanceof Date ? candidate : new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getUTCFullYear();
    }
  }
  // T-478 round 3: deliberately NEVER new Date().getUTCFullYear() here — a
  // wall-clock fallback is exactly the round-2 bug (a Dec/Jan re-scrape of
  // the same still-dateless OFS row would compute a DIFFERENT slug each
  // year boundary). Callers must use a stable, non-time-dependent fallback.
  return null;
}

/** T-478 round 3: observability counter for `ofsSlugYear` returning null (non-fatal, never gates the write). */
export const ofsSlugYearMissingCount = { count: 0 };

/**
 * T-478 round 3 (issue #225 follow-up, item 3): the ONE place that computes
 * an OFS row's slug — shared by every caller that needs it (upsertIPO's own
 * insert, and the identity-resolution `slug` passed into `resolveIpoRow` by
 * BaseScraperOrchestrator.ts / data-consolidation-orchestrator.ts) so tier 4
 * (slug) can also find an already-created OFS row on a repeat scrape,
 * independent of the offering_type-filtered key/name retry (item 2). A
 * defaulted (non-explicit) 'IPO' record, or any non-OFS type, gets the plain
 * company slug — unchanged, legacy behavior.
 */
export function computeIpoIdentitySlug(scrapedIPO: {
  companyName: string;
  offeringType?: string;
  openDate?: string | Date | null;
  closeDate?: string | Date | null;
  offeringTypeExplicit?: boolean;
}): string {
  // OD-68 S1/S3: the slug is computed from the name with its page-status suffix
  // and page-title text stripped — "Rays of Belief Ltd. O" minted
  // `rays-of-belief-ltd-o` on 2026-09-01 because the slug was taken from the raw
  // name while the stored display name was sanitised.
  const baseSlug = stripIdentitySlugSuffix(generateSlug(stripIdentityNameDecoration(scrapedIPO.companyName) || scrapedIPO.companyName));
  const isExplicitOfs = scrapedIPO.offeringType === 'OFS' && scrapedIPO.offeringTypeExplicit === true;
  if (!isExplicitOfs) {
    return baseSlug;
  }
  const year = ofsSlugYear(scrapedIPO);
  if (year == null) {
    logger.warn(
      { companyName: scrapedIPO.companyName },
      '[T-478] OFS row has no derivable open/close date for its slug year - using a stable -ofs-unknown marker (never Date.now())'
    );
    ofsSlugYearMissingCount.count += 1;
    return `${baseSlug}-ofs-unknown`;
  }
  return `${baseSlug}-ofs-${year}`;
}
