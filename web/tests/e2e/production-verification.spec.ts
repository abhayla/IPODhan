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
  // NOTE: '/ipos/sarda-proteins-ltd' removed — Sarda Proteins was a takeover/corporate
  // action, not an IPO; it was de-polluted from the DB, so its detail page correctly 404s.
  // Hardcoding removed-IPO slugs makes this sweep flaky; prefer a live IPO detail page.
];

// T-297 (gap G2) — SUBSTANCE OF RENDER.
//
// The four assertions above check that a page did not CRASH. They do not check
// that it SHOWED ANYTHING. That distinction cost eight months:
//
//   T-285 P1-1 — /ncd and /rights-issues rendered "No NCDs available" and "No
//   upcoming rights issues available" from 2026-01-01 onward, while two NCDs and
//   one rights issue were open for subscription. A hardcoded `useState('2025')`
//   filter default hid every 2026 row, and DataTable's empty-state returned
//   before the controls bar, so the user could not even change the year.
//   HTTP 200. Correct payload shipped into the page. ZERO console errors. Main
//   content comfortably over 80 characters. Every assertion above passed.
//   (T-285 P2-1 is the same class on /ofs: 5 of 19 rows shown, the stale ones.)
//
// So: for routes we KNOW hold rows, an empty-state phrase is a FAILURE, and the
// rendered text must additionally carry a marker only real data produces. This
// is the check that turns "the page loaded" into "the page told the truth".
//
// The check has two halves, because "shows nothing" is only a bug on some routes.
//
// HALF 1 — MUST_SHOW_ROWS: routes that structurally always hold rows. A listed
// mainboard IPO never un-lists; the holiday calendar never empties mid-year. If
// one of these renders zero rows, something is broken. Verified live 2026-08-23:
// /mainboard-ipos 25 rows, /sme-ipos 25, /history 20, /registrars 15,
// /market-holidays 20 holiday cards.
//
// HALF 2 — ESCAPABLE_EMPTY: routes whose row count legitimately reaches zero
// (NCDs, OFS and rights issues are sparse — /rights-issues is genuinely empty
// today and that is honest). Demanding rows here would produce a false alarm.
// What must NEVER happen on these routes is the T-285 shape: an empty state the
// user cannot escape, or one produced by a filter stuck on a past year. So we
// assert the year control still exists and still points at the current year or
// later. That is the actual defect, independent of how many rows exist.
//
// NOTE the deliberate omission: /mainboard-ipo-reviews and the prospectus pages
// are legitimately empty and are tracked separately (#167).
const EMPTY_STATE_PHRASES = [
  /No NCDs available/i,
  /No upcoming rights issues available/i,
  /No live rights issues available/i,
  /No OFS available/i,
  /No historical IPOs found/i,
  /No holidays found/i,
  /No data found/i,
  /No data available/i,
];

// route -> how to prove at least one real row rendered.
// `rows` counts table body rows; `marker` is for card-based layouts with no <table>.
const MUST_SHOW_ROWS: Record<string, { rows?: true; marker?: RegExp }> = {
  '/mainboard-ipos': { rows: true },
  '/sme-ipos': { rows: true },
  '/history': { rows: true },
  '/registrars': { rows: true },
  // Card layout, no <table>: a real holiday row always carries a weekday name.
  // The blank page of T-264 P2-2 had none — breadcrumb, title, footer, nothing else.
  '/market-holidays': { marker: /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i },
};

// Routes allowed to be empty, but never allowed to be inescapably empty.
const ESCAPABLE_EMPTY = ['/ncd', '/ofs', '/rights-issues'];

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

      // 5. SUBSTANCE (T-297 G2) — half 1: routes that must always show rows.
      const rowRule = MUST_SHOW_ROWS[route];
      if (rowRule) {
        const emptyState = EMPTY_STATE_PHRASES.find((re) => re.test(text));
        expect(
          emptyState ? (text.match(emptyState)?.[0] ?? String(emptyState)) : null,
          `${route} must always have rows but rendered an empty state — filter default or data-fetch regression`
        ).toBeNull();

        if (rowRule.rows) {
          const rowCount = await page.locator('table tbody tr').count();
          expect(rowCount, `${route} rendered a table with zero body rows`).toBeGreaterThan(0);
        }
        if (rowRule.marker) {
          expect(
            rowRule.marker.test(text),
            `${route} rendered no data-row marker ${rowRule.marker} — page loaded but shows no rows`
          ).toBe(true);
        }
      }

      // 5b. SUBSTANCE — half 2: the year filter must not hide live data (T-285 P1-1/P2-1).
      //
      // Two distinct defects, one rule. On /ncd and /rights-issues the stale
      // default produced an EMPTY page (P1-1). On /ofs it produced a POPULATED
      // page — five December-2025 rows, presented as current, with fourteen 2026
      // rows hidden (P2-1). A check that only looks at empty states catches the
      // first and sails past the second, so this asserts the invariant that
      // covers both: the default view must not hide rows that exist for the
      // current year.
      if (ESCAPABLE_EMPTY.includes(route)) {
        const currentYear = new Date().getFullYear();
        const isEmpty = EMPTY_STATE_PHRASES.some((re) => re.test(text));

        // (i) An empty state must always leave the user a way out. T-285 measured
        // `#year-filter` count = 0 on /ncd and /rights-issues: DataTable returned
        // the empty state before rendering the controls bar, so the filter that
        // hid every row could not be changed.
        if (isEmpty) {
          expect(
            await page.locator('#year-filter').count(),
            `${route} shows an empty state with NO year control — the user cannot undo the filter that hid every row`
          ).toBeGreaterThan(0);
        }

        // (ii) A past-year default is only legitimate when the current year truly
        // has no data. Switch the control to the current year and see.
        const shownYear = Number(text.match(/Year:?\s*(\d{4})/i)?.[1] ?? currentYear);
        if (shownYear < currentYear && (await page.locator('#year-filter').count()) > 0) {
          const defaultRows = await page.locator('table tbody tr').count();
          await page.locator('#year-filter').first().click();
          await page.getByRole('option', { name: String(currentYear), exact: true }).click();
          await page.waitForTimeout(1500);
          const currentYearRows = await page.locator('table tbody tr').count();
          expect(
            currentYearRows,
            `${route} defaulted to ${shownYear} showing ${defaultRows} row(s) while ${currentYear} has ${currentYearRows} — the default view hides live data`
          ).toBe(0);
        }
      }

      // 3 + 2. no broken same-origin fetches, no console errors
      expect(failedRequests, `failed same-origin requests on ${route}`).toEqual([]);
      expect(consoleErrors, `console errors on ${route}`).toEqual([]);
    });
  }
});
