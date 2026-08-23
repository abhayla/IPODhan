/**
 * Unit tests for the dynamic sitemap generator (T-302 / P3-14, P3-16)
 *
 * P3-14: a retired/redirected slug (an `ipo_slug_redirects.old_slug`) must
 * never be published in the sitemap — crawling it just bounces through a 308.
 * P3-16: the "coming soon" review placeholder pages must not be indexed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindAll = vi.fn();
const mockSelect = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: () => ({}),
}));

vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({
    findAll: mockFindAll,
  })),
}));

vi.mock('@/lib/seo/route-discovery', () => ({
  discoverStaticRoutes: () => [
    '/',
    '/mainboard-ipos',
    '/sme-ipos',
    '/mainboard-ipo-reviews',
    '/sme-ipo-reviews',
    '/market-holidays',
  ],
}));

describe('sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAll.mockResolvedValue({
      data: [
        { slug: 'good-company-ltd', updatedAt: new Date('2025-01-01') },
        { slug: 'ic-electricals-co-ltd', updatedAt: new Date('2024-01-01') }, // stale/duplicate row sharing a retired slug
      ],
    });
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([{ oldSlug: 'ic-electricals-co-ltd' }]),
    });
  });

  it('P3-14: never publishes a URL for a slug recorded in ipo_slug_redirects.old_slug', async () => {
    const sitemap = (await import('@/app/sitemap')).default;
    const entries = await sitemap();

    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.includes('/ipos/ic-electricals-co-ltd'))).toBe(false);
    expect(urls.some((u) => u.includes('/ipos/good-company-ltd'))).toBe(true);
  });

  it('P3-16: excludes the "coming soon" review placeholder pages', async () => {
    const sitemap = (await import('@/app/sitemap')).default;
    const entries = await sitemap();

    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/mainboard-ipo-reviews'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/sme-ipo-reviews'))).toBe(false);
    // Sanity: real static routes still get through
    expect(urls.some((u) => u.endsWith('/mainboard-ipos'))).toBe(true);
  });

  it('degrades to an empty exclusion set (fails open, not closed) if the redirects table read fails', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockRejectedValue(new Error('db down')),
    });

    const sitemap = (await import('@/app/sitemap')).default;
    const entries = await sitemap();

    const urls = entries.map((e) => e.url);
    // Both known IPOs still appear — a redirects-table outage must not crash
    // sitemap generation, it should just skip the redirect-exclusion pass.
    expect(urls.some((u) => u.includes('/ipos/good-company-ltd'))).toBe(true);
  });
});
