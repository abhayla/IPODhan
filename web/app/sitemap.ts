import { MetadataRoute } from 'next';
import { IPORepository } from '@/lib/repositories/ipo-repository';

/**
 * Dynamic sitemap generation for SEO
 *
 * Generates XML sitemap with all public pages:
 * - Homepage
 * - IPO listing page
 * - All IPO detail pages (dynamic from database)
 * - Tools pages (calculator, comparison)
 * - Registrars directory
 * - Market holidays calendar
 * - Historical IPOs page
 *
 * Next.js automatically serves this at /sitemap.xml
 */
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

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/dashboard`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/tools/lot-calculator`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/tools/compare`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/registrars`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/market-holidays`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/history`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // Dynamic IPO detail pages
  const ipoPages: MetadataRoute.Sitemap = allIPOs.map((ipo) => ({
    url: `${baseUrl}/ipos/${ipo.slug}`,
    lastModified: ipo.updatedAt || new Date(),
    changeFrequency: 'hourly' as const, // IPO data updates frequently
    priority: 0.8,
  }));

  return [...staticPages, ...ipoPages];
}
