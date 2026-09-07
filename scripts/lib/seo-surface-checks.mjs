/**
 * Pure predicates for SEO-surface completeness (issue #190, T-464).
 *
 * IPODhan's business model is SEO lead-gen to broker affiliate links, so a
 * surface gap (a live page missing from the sitemap, two indexed URLs for
 * the same company, two page types sharing a <title>) is a direct revenue
 * leak. Each defect only exists in the RELATIONSHIP between the route
 * inventory, the sitemap, and the rendered head — never visible from any
 * one signal alone, which is why these three checks exist as a group.
 *
 * Kept HTTP-agnostic and dependency-free on purpose: scripts/audit-prod.mjs
 * fetches the live data and passes plain arrays/objects in; the mutation-proof
 * self-test (scripts/tests/seo-surface-checks.test.mjs) drives these same
 * functions against fixtures, so weakening a predicate turns the fixture red
 * without needing a live HTTP call.
 */

// Legal-entity suffix tokens that generateIPOSlug()
// (packages/shared/src/utils/slug.ts) appends to a slug. Two sitemap
// entries for the same company differing only in this trailing token (or
// missing it) are two indexed URLs for one company — the T-291 P2-2 class.
const LEGAL_SUFFIX_RE =
  /-(private-ltd|pvt-ltd|pvt|private|ltd|inc|incorporated|corp|corporation|llc|llp|plc)$/;

/**
 * Strip one trailing legal-suffix token from a slug to get its base identity.
 * Only strips ONE token (a slug never carries two), so "xyz-tech-pvt-ltd"
 * strips to "xyz-tech" in one pass ("-pvt-ltd" matches before "-ltd" would).
 */
export function stripLegalSuffix(slug) {
  return String(slug).replace(LEGAL_SUFFIX_RE, '');
}

/**
 * Sub-check 1: every live 200-returning route must appear in the sitemap.
 * The T-272 P2-4 class (four segment landing pages 200'd but were absent
 * from the sitemap) — comparing against LIVE 200s (not a hardcoded list) is
 * the whole point, so the caller passes routes it has already verified 200.
 *
 * @param {string[]} liveRoutes - paths that returned HTTP 200 (the ROUTES
 *   SSOT filtered to live 200s by the caller)
 * @param {string[]} sitemapPaths - paths extracted from sitemap.xml <loc>
 * @returns {{ pass: boolean, missing: string[] }}
 */
export function checkSitemapCompleteness(liveRoutes, sitemapPaths) {
  const sitemapSet = new Set(sitemapPaths);
  const missing = liveRoutes.filter((route) => !sitemapSet.has(route));
  return { pass: missing.length === 0, missing };
}

/**
 * Sub-check 2: no two /ipos/* sitemap entries resolve to the same company
 * after stripping the legal-entity suffix. The T-291 P2-2 class — duplicate
 * IPO pairs with contradictory dates, both slugs in the sitemap, both indexed.
 *
 * @param {string[]} ipoSlugs - the slug segment of every /ipos/<slug> sitemap entry
 * @returns {{ pass: boolean, duplicateGroups: Array<{ base: string, slugs: string[] }> }}
 */
export function checkDuplicateSlugs(ipoSlugs) {
  const groups = new Map();
  for (const slug of ipoSlugs) {
    const base = stripLegalSuffix(slug) || slug;
    if (!groups.has(base)) groups.set(base, new Set());
    groups.get(base).add(slug);
  }
  const duplicateGroups = [];
  for (const [base, slugSet] of groups) {
    if (slugSet.size > 1) {
      duplicateGroups.push({ base, slugs: [...slugSet].sort() });
    }
  }
  duplicateGroups.sort((a, b) => a.base.localeCompare(b.base));
  return { pass: duplicateGroups.length === 0, duplicateGroups };
}

/**
 * Sub-check 3: no two page TYPES share a <title>, and no page type serves
 * the homepage's title verbatim. The T-264 P3-5 / T-272 P2-3 class —
 * /mainboard-ipo-reviews and its SME twin served the generic homepage
 * <title>, contradicting web-seo-metadata-and-jsonld.md.
 *
 * @param {Record<string,string>} titlesByType - page-type label -> rendered <title>
 * @param {string} homepageTitle - the <title> fetched from '/'
 * @returns {{ pass: boolean, collisions: Array<{ type: string, otherType: string|null, title: string, matchesHomepage: boolean }> }}
 */
export function checkTitleCollisions(titlesByType, homepageTitle) {
  const collisions = [];
  const entries = Object.entries(titlesByType);

  const seenByTitle = new Map();
  for (const [type, title] of entries) {
    if (type === 'home') continue; // homepage title is the reference, not a peer to dedupe against

    const normalized = (title || '').trim();
    const matchesHomepage = normalized.length > 0 && normalized === (homepageTitle || '').trim();
    if (matchesHomepage) {
      collisions.push({ type, otherType: 'home', title: normalized, matchesHomepage: true });
      continue; // already flagged this type — don't double-report it as a peer collision too
    }
    if (normalized) {
      if (seenByTitle.has(normalized)) {
        const otherType = seenByTitle.get(normalized);
        collisions.push({ type, otherType, title: normalized, matchesHomepage: false });
      } else {
        seenByTitle.set(normalized, type);
      }
    }
  }

  return { pass: collisions.length === 0, collisions };
}
