import path from 'path';
import { MetadataRoute } from 'next';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { discoverStaticRoutes } from '@/lib/seo/route-discovery';
import * as schema from '@ipodhan/shared/db/schema';
import { CacheTTL } from '@/lib/cache/cache-keys';

// F2 (T-302C checker finding): this route has no `revalidate`, so Next.js
// generates it ONCE at build time and serves that snapshot from cache
// (`x-nextjs-cache: HIT`) until the next deploy. A slug retired between
// deploys (merged/renamed IPO) keeps 308-ing from the sitemap for the whole
// gap — the `redirectedOldSlugs` filter below only ever runs against the data
// available at the build that produced the cached snapshot, so it can't
// remove a slug retired AFTER that build. Revalidating on the same cadence as
// the underlying IPO-list cache (`CacheTTL.IPO_LIST`, used by
// `ipoRepository.findAll` below) means a slug retired in prod drops out of
// the sitemap within one cache window instead of waiting for a redeploy.
// Next.js requires route-segment config exports to be static literals, not
// member expressions — CacheTTL.IPO_LIST is 900s; keep this literal in sync
// with that constant (see cache-key-and-ttl-ssot.md).
export const revalidate = 900;

/**
 * Dynamic sitemap generation for SEO
 *
 * Generates XML sitemap with all public pages:
 * - Every static public page (discovered by walking `app/`, not a
 *   hand-maintained list — P2-4, round-2 review: `/mainboard-ipos`,
 *   `/sme-ipos`, `/ncd`, `/ofs` were live 200s a hardcoded array had
 *   silently dropped)
 * - All IPO detail pages (dynamic from database)
 *
 * Next.js automatically serves this at /sitemap.xml
 */

// Per-route SEO weighting overrides. A route NOT listed here still appears in
// the sitemap (discovered from the filesystem) with the DEFAULT weighting —
// this map only tunes priority/frequency for pages that need it; it does not
// gate inclusion.
const ROUTE_OVERRIDES: Record<string, { changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }> = {
  '/': { changeFrequency: 'daily', priority: 1.0 },
  '/dashboard': { changeFrequency: 'hourly', priority: 0.9 },
  '/mainboard-ipos': { changeFrequency: 'hourly', priority: 0.9 },
  '/sme-ipos': { changeFrequency: 'hourly', priority: 0.9 },
  '/history': { changeFrequency: 'weekly', priority: 0.8 },
  '/ncd': { changeFrequency: 'daily', priority: 0.7 },
  '/ofs': { changeFrequency: 'daily', priority: 0.7 },
  '/tools/lot-calculator': { changeFrequency: 'weekly', priority: 0.7 },
  '/tools/compare': { changeFrequency: 'weekly', priority: 0.7 },
  '/registrars': { changeFrequency: 'monthly', priority: 0.6 },
  '/market-holidays': { changeFrequency: 'monthly', priority: 0.6 },
};
const DEFAULT_WEIGHT: { changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number } = {
  changeFrequency: 'weekly',
  priority: 0.6,
};

// P3-16: these static pages are intentional "coming soon" placeholders
// (ipo_reviews/ipo_scores have zero production rows — see the pages'
// own doc comments) — real, crawlable 200s, but nothing worth indexing yet.
// discoverStaticRoutes finds every page.tsx by design (P2-4); exclude these
// explicitly rather than making discovery itself content-aware.
const PLACEHOLDER_ROUTES = new Set(['/mainboard-ipo-reviews', '/sme-ipo-reviews']);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';

  // Fetch all IPOs for dynamic routes
  const { db } = await import('@/lib/db');
  const { getRedisClient } = await import('@/lib/redis-client');
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);
  let allIPOs: Array<{ slug: string; updatedAt: Date | null }> = [];

  try {
    const response = await ipoRepository.findAll({ limit: 1000 });
    allIPOs = response.data.map((ipo) => ({
      slug: ipo.slug,
      updatedAt: ipo.updatedAt,
    }));
  } catch (error) {
    console.error('Error fetching IPOs for sitemap:', error);
    // Continue with empty array if database fetch fails
  }

  // P3-14: a retired/redirected old slug (e.g. `ic-electricals-co-ltd` -> 308)
  // must never appear as a sitemap URL — crawling it just bounces through a
  // redirect. `ipos.slug` is always the CURRENT canonical slug, so this only
  // guards against a slug value that somehow coincides with a recorded
  // `old_slug` (e.g. a not-yet-cleaned-up duplicate row).
  let redirectedOldSlugs = new Set<string>();
  try {
    const redirectRows = await db.select({ oldSlug: schema.ipoSlugRedirects.oldSlug }).from(schema.ipoSlugRedirects);
    redirectedOldSlugs = new Set(redirectRows.map((r) => r.oldSlug));
  } catch (error) {
    console.error('Error fetching IPO slug redirects for sitemap:', error);
    // Continue with an empty exclusion set if the redirects table can't be read
  }
  allIPOs = allIPOs.filter((ipo) => !redirectedOldSlugs.has(ipo.slug));

  const now = new Date();
  const staticRoutes = discoverStaticRoutes(path.join(process.cwd(), 'app')).filter(
    (route) => !PLACEHOLDER_ROUTES.has(route)
  );
  const staticPages: MetadataRoute.Sitemap = staticRoutes.map((route) => {
    const weight = ROUTE_OVERRIDES[route] ?? DEFAULT_WEIGHT;
    return {
      url: route === '/' ? baseUrl : `${baseUrl}${route}`,
      lastModified: now,
      changeFrequency: weight.changeFrequency,
      priority: weight.priority,
    };
  });

  // Dynamic IPO detail pages
  const ipoPages: MetadataRoute.Sitemap = allIPOs.map((ipo) => ({
    url: `${baseUrl}/ipos/${ipo.slug}`,
    lastModified: ipo.updatedAt || new Date(),
    changeFrequency: 'hourly' as const, // IPO data updates frequently
    priority: 0.8,
  }));

  return [...staticPages, ...ipoPages];
}
