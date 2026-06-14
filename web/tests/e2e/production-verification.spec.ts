import { test, expect, type ConsoleMessage, type Response } from '@playwright/test';

/**
 * Production verification sweep — the "is every page actually correct?" gate.
 *
 * For EVERY public route it asserts the four things an HTTP-200 check and a
 * shallow audit miss (which is how /history's 400 and the listings stale-chunk
 * crash slipped through):
 *   1. no client-side "Application error" / exception
 *   2. zero console errors (page errors included)
 *   3. no FAILED same-origin requests (4xx/5xx) — catches broken data fetches
 *   4. real main content rendered (not blank, not stuck "Loading…")
 *
 * Target is env-driven so it runs against prod or a local/preview build:
 *   PROD_BASE_URL=https://ipodhan.com npx playwright test production-verification
 */

const BASE = (process.env.PROD_BASE_URL || 'https://ipodhan.com').replace(/\/$/, '');

// Public routes a user can reach. Admin + internal test pages are excluded
// (admin is auth-gated; test pages are intentionally 404 in prod).
const ROUTES: string[] = [
  '/',
  '/about',
  '/affiliates',
  '/dashboard',
  '/disclaimer',
  '/fpo-listings',
  '/history',
  '/mainboard-ipo-calendar',
  '/mainboard-ipo-listings',
  '/mainboard-ipo-performance-tracker',
  '/mainboard-ipo-prospectus',
  '/mainboard-ipo-reviews',
  '/mainboard-ipos',
  '/market-holidays',
  '/ncd',
  '/ofs',
  '/privacy',
  '/registrars',
  '/resources',
  '/rights-issues',
  '/sme-ipo-calendar',
  '/sme-ipo-listings',
  '/sme-ipo-performance-tracker',
  '/sme-ipo-prospectus',
  '/sme-ipo-reviews',
  '/sme-ipos',
  '/terms',
  '/tools',
  '/tools/compare',
  '/tools/lot-calculator',
  // representative detail pages (listed + open)
  '/ipos/fractal-analytics-ltd',
  '/ipos/sarda-proteins-ltd',
];

// Console/network noise outside our control (third-party widgets, analytics).
const BENIGN = [
  /cloudflareinsights/i,
  /google-analytics|googletagmanager|gtag/i,
  /favicon/i,
  /chrome-extension/i,
];

const isBenign = (s: string) => BENIGN.some((re) => re.test(s));

test.describe('Production verification — every page renders correctly', () => {
  for (const route of ROUTES) {
    test(`renders cleanly: ${route}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];

      page.on('console', (m: ConsoleMessage) => {
        if (m.type() === 'error' && !isBenign(m.text())) consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => {
        if (!isBenign(e.message)) consoleErrors.push(`pageerror: ${e.message}`);
      });
      page.on('response', (r: Response) => {
        const u = r.url();
        if (u.startsWith(BASE) && r.status() >= 400 && !isBenign(u)) {
          failedRequests.push(`${r.status()} ${u.replace(BASE, '')}`);
        }
      });

      const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
      expect(resp, `no response for ${route}`).toBeTruthy();
      expect(resp!.status(), `top-level HTTP status for ${route}`).toBeLessThan(400);

      // Let client-side data fetches settle (best-effort; analytics may keep the
      // network busy, so don't fail on idle timeout).
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

      // 1. no client-side crash
      await expect(
        page.locator('text=/Application error|client-side exception/i'),
        `client app error on ${route}`
      ).toHaveCount(0);

      // 4. real main content (not blank / not stuck loading)
      const main = page.locator('main').first();
      const text = ((await main.count()) > 0
        ? await main.innerText().catch(() => '')
        : await page.locator('body').innerText().catch(() => '')
      ).replace(/\s+/g, ' ').trim();
      expect(text.length, `main content too thin on ${route}`).toBeGreaterThan(80);
      expect(/^\s*Loading/i.test(text) && text.length < 200, `stuck loading on ${route}`).toBeFalsy();

      // 3 + 2. no broken same-origin fetches, no console errors
      expect(failedRequests, `failed same-origin requests on ${route}`).toEqual([]);
      expect(consoleErrors, `console errors on ${route}`).toEqual([]);
    });
  }
});
