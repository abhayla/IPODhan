import { test, expect, type ConsoleMessage } from '@playwright/test';

/**
 * Regression guard for GitHub #6: clicking the Demand / GMP tabs on an IPO that
 * has no demand data crashed with "Application error: a client-side exception"
 * (DemandGraphChart read `data.stats.totalBids` off an undefined `stats`).
 *
 * The production-verification suite only loads the DEFAULT tab, so it missed
 * this. Here we cycle EVERY tab and assert zero console errors + no error
 * boundary text — the substance gate that was absent.
 */

const BASE = process.env.PROD_BASE_URL || 'http://localhost:3000';

const BENIGN = [
  /cloudflareinsights/i,
  /google-analytics|googletagmanager|gtag/i,
  /favicon/i,
  /chrome-extension/i,
];
const isBenign = (s: string) => BENIGN.some((re) => re.test(s));

const TABS = ['Overview', 'Financials', 'Subscription', 'Demand', 'GMP', 'Documents'];

test.describe('IPO detail — every tab renders without a client-side crash', () => {
  test('cycling all tabs on a live IPO produces zero console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error' && !isBenign(m.text())) consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      if (!isBenign(e.message)) consoleErrors.push(`pageerror: ${e.message}`);
    });

    // Discover a real IPO detail URL (avoid hard-coding a data-dependent slug).
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const firstIpoHref = await page
      .locator('a[href^="/ipos/"]')
      .first()
      .getAttribute('href');
    expect(firstIpoHref, 'expected at least one /ipos/<slug> link on the homepage').toBeTruthy();

    await page.goto(BASE + firstIpoHref!, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    for (const tab of TABS) {
      const trigger = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') });
      if ((await trigger.count()) === 0) continue; // tab not present for this IPO
      await trigger.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // No error-boundary / Next.js client-exception text in the panel.
      await expect(
        page.locator('text=/Application error|client-side exception/i'),
        `client app error on "${tab}" tab`,
      ).toHaveCount(0);
    }

    expect(consoleErrors, `console errors while cycling tabs:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
