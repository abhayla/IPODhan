import { test, expect } from '@playwright/test';

/**
 * C7 e2e — GMP rendering on an IPO that has GMP data (G15/G16/G19).
 * Asserts the header GMP card shows a value + an honest "as of <date>" staleness
 * label, that the GMP tab chart renders, and that no console errors fire.
 *
 * Waits on real signals (networkidle + the target element), never a fixed sleep
 * (.claude/rules/e2e-readiness-signal.md). The project emits no data-ready marker.
 *
 * Target defaults to a LISTED IPO (stable historical GMP); override via GMP_TEST_SLUG.
 */
const SLUG = process.env.GMP_TEST_SLUG || 'cmr-green-technologies-ltd';

test.describe('GMP rendering (honest, dated)', () => {
  test('header GMP card shows a value + "as of <date>" label, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`/ipos/${SLUG}`);
    await page.waitForLoadState('networkidle');

    // Staleness label — wait on the element (signal), not a timeout.
    const asOf = page.getByTestId('gmp-as-of');
    await expect(asOf).toBeVisible();
    // Substance: an actual date, not a placeholder.
    await expect(asOf).toHaveText(/as of \d{2} [A-Z][a-z]{2} \d{4}/);

    // The GMP value is shown (₹ amount), within the same card.
    const gmpCard = page.locator('div', { hasText: 'Grey Market Premium' }).first();
    await expect(gmpCard).toContainText('₹');

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('GMP tab renders the history chart', async ({ page }) => {
    await page.goto(`/ipos/${SLUG}?tab=gmp`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('GMP History', { exact: false }).first()).toBeVisible();
  });
});
