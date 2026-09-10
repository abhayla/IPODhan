/**
 * Which fixed pages a scraper cycle refreshes, and which it deliberately does
 * not — every page route in the app classified, with a reason for each
 * exclusion.
 *
 * §2.11 names four: `/`, `/mainboard-ipos`, `/sme-ipos`, the sitemap. This app
 * has 29 page routes and far more than four are driven by IPO rows. Shipping
 * only the named four would leave a corrected IPO fixed on its own page and
 * stale on the calendar and the listings page that link to it — the exact
 * "correction reaches the reader late" problem this item exists to remove.
 *
 * A longer guess fails the same way one release later, when somebody adds a
 * page. So this file is exhaustive by construction and a test enforces it:
 * every route must appear in one of the two lists, and a new page cannot be
 * added without someone deciding which. The reasons below are the point of the
 * exclusion list — "not in the list" tells a later reader nothing, "static
 * legal text, no IPO row can change it" tells them everything.
 */

/** Refreshed once per cycle when that cycle wrote to any IPO. */
export const REVALIDATED_PATHS: readonly string[] = [
  '/',
  '/mainboard-ipos',
  '/sme-ipos',
  '/mainboard-ipo-listings',
  '/sme-ipo-listings',
  '/mainboard-ipo-calendar',
  '/sme-ipo-calendar',
  '/mainboard-ipo-performance-tracker',
  '/sme-ipo-performance-tracker',
  '/mainboard-ipo-prospectus',
  '/sme-ipo-prospectus',
  '/mainboard-ipo-reviews',
  '/sme-ipo-reviews',
  '/fpo-listings',
  '/ofs',
  '/ncd',
  '/rights-issues',
  '/history',
  '/sitemap.xml',
];

/**
 * Deliberately NOT refreshed. The reason matters more than the entry: it is
 * what stops a later reader "fixing an oversight" and putting a static legal
 * page into a per-cycle refresh.
 */
export const NOT_REVALIDATED: Readonly<Record<string, string>> = {
  '/about': 'static editorial copy; no IPO row appears on it and none can change it',
  '/privacy': 'static legal text, changed by a human edit and a deploy, never by a cycle',
  '/terms': 'static legal text, changed by a human edit and a deploy, never by a cycle',
  '/disclaimer': 'static legal text, changed by a human edit and a deploy, never by a cycle',
  '/affiliates': 'static partner copy; affiliate links are configuration, not scraped IPO rows',
  '/resources': 'static explainer index; its content is written, not scraped',
  '/tools': 'a landing page listing the tools; the tools themselves are classified separately',
  '/registrars':
    'reference data on a 7-day cache by design (CacheTTL.REFERENCE); a per-cycle refresh would fight that deliberate choice',
  '/market-holidays':
    'reference data on the same 7-day REFERENCE cache; holidays are not written by an IPO cycle',
  '/dashboard': 'reads live per-request for an operator, not cached, so there is nothing to invalidate',
  '/components-test': 'a development-only component harness, never served to a reader',
  '/tools/compare':
    "client-rendered ('use client') and fetches at request time, so nothing is cached under a key or a rebuilt page to invalidate - revalidatePath here would be a no-op that reads like coverage",
  '/tools/lot-calculator':
    'pure arithmetic in the browser from values the reader types; it reads no IPO row at all',
};
