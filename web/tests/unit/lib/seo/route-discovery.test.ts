import { describe, it, expect } from 'vitest';
import path from 'path';
import { discoverStaticRoutes } from '@/lib/seo/route-discovery';

/**
 * P2-4 (round-2 review, T-277): `sitemap.ts` used to hand-maintain a static
 * array that silently drifted from the real route table — `/mainboard-ipos`,
 * `/sme-ipos`, `/ncd`, `/ofs` all returned 200 in prod but were absent from
 * the sitemap. `discoverStaticRoutes` walks the real `web/app` directory, so
 * this test runs against the ACTUAL filesystem (not a fixture) — it fails the
 * instant a live public page falls out of the sitemap again.
 */
describe('discoverStaticRoutes — P2-4 sitemap mechanism', () => {
  const appDir = path.join(__dirname, '../../../../app');
  const routes = discoverStaticRoutes(appDir);

  // The 4 landing pages the round-2 review found missing, plus a
  // representative sample of the other public routes.
  const expectedPublicRoutes = [
    '/',
    '/mainboard-ipos',
    '/sme-ipos',
    '/ncd',
    '/ofs',
    '/about',
    '/dashboard',
    '/history',
    '/registrars',
    '/market-holidays',
    '/tools',
    '/tools/lot-calculator',
    '/tools/compare',
    '/mainboard-ipo-calendar',
    '/mainboard-ipo-listings',
    '/mainboard-ipo-performance-tracker',
    '/mainboard-ipo-prospectus',
    '/mainboard-ipo-reviews',
    '/sme-ipo-calendar',
    '/sme-ipo-listings',
    '/sme-ipo-performance-tracker',
    '/sme-ipo-prospectus',
    '/sme-ipo-reviews',
    '/rights-issues',
    '/fpo-listings',
    '/affiliates',
    '/resources',
    '/disclaimer',
    '/privacy',
    '/terms',
  ];

  it.each(expectedPublicRoutes)('every public 200 landing page (%s) is discovered', (route) => {
    expect(routes).toContain(route);
  });

  it('excludes admin routes', () => {
    expect(routes.some((r) => r.startsWith('/admin'))).toBe(false);
  });

  it('excludes the dev-only components-test route', () => {
    expect(routes).not.toContain('/components-test');
  });

  it('excludes dynamic-segment routes (no data source to enumerate real values here)', () => {
    expect(routes).not.toContain('/ipos/[slug]');
    expect(routes).not.toContain('/ipo-reviews/[reviewId]');
    expect(routes.some((r) => r.includes('['))).toBe(false);
  });

  it('returns a sorted, de-duplicated list', () => {
    const sorted = [...routes].sort();
    expect(routes).toEqual(sorted);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
