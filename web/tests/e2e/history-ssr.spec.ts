/**
 * /history SSR initial data (T-473 / #201)
 *
 * The default (no-filter) /history view shipped chrome + "Loading..." only —
 * the IPO row list was entirely client-fetched (HistoricalIPOsContent's
 * useEffect calling /api/ipos/history). This checks the RAW server response
 * (JavaScript never runs) contains at least one real IPO company name, not
 * only the loading skeleton — mirrors the mainboard tracker fix's pattern
 * (mainboard-performance-service.ts) applied to /history.
 */

import { test, expect } from '@playwright/test';

test.describe('/history server-rendered initial data', () => {
  test('default view ships a real IPO row in the initial HTML with JS disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    const response = await page.goto('/history');
    expect(response?.ok()).toBeTruthy();

    const html = await page.content();

    // The loading skeleton must not be the only content shipped.
    // A real row renders inside HistoricalIPOTable — assert on a structural
    // marker (a table row with a company link) rather than a hardcoded name,
    // since prod data changes over time.
    const rowText = await page.locator('table tbody tr').first().innerText().catch(() => '');

    expect(rowText.trim().length).toBeGreaterThan(0);
    expect(html).not.toMatch(/^\s*<body[^>]*>\s*<div[^>]*>\s*Loading\.\.\.\s*<\/div>\s*<\/body>/i);

    await context.close();
  });
});
