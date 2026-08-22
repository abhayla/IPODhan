import path from 'path';
import { MetadataRoute } from 'next';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { discoverStaticRoutes } from '@/lib/seo/route-discovery';

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

  const now = new Date();
  const staticRoutes = discoverStaticRoutes(path.join(process.cwd(), 'app'));
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
