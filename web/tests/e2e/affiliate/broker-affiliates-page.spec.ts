/**
 * E2E Tests for Broker Affiliates Page (/affiliates)
 * Issue #97: page was rendering invented broker claims (4.5 rating, "1 Cr+"
 * users, "₹300/year" AMC, "Zero brokerage", a fake "Most Popular" badge)
 * across six brokers IPODhan has no affiliate relationship with. The page
 * now lists ONLY Zerodha (the real Zerodha-AP relationship), with a real
 * signup link and the mandatory AP disclosure -- no invented benefits or
 * competitor names.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const INVENTED_CLAIMS = [
  '4.5',
  '1 Cr+',
  '₹300/year',
  'Most Popular',
  'Groww',
  'Upstox',
];

test.describe('Broker Affiliates Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('page loads and shows exactly one broker card (Zerodha)', async ({ page }) => {
    await page.goto(`${BASE_URL}/affiliates`);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveTitle(/Partner Brokers/i);
    await expect(
      page.getByRole('heading', { name: /Partner Broker/i })
    ).toBeVisible();

    const brokerCards = page.getByTestId('broker-card');
    await expect(brokerCards).toHaveCount(1);
    await expect(brokerCards.first().getByRole('heading', { name: 'Zerodha' })).toBeVisible();
  });

  test('Zerodha CTA opens in a new tab and is marked sponsored', async ({ page }) => {
    await page.goto(`${BASE_URL}/affiliates`);
    await page.waitForLoadState('networkidle');

    const zerodhaCard = page.getByTestId('broker-card').filter({ hasText: 'Zerodha' });
    const ctaLink = zerodhaCard.getByRole('link').first();

    await expect(ctaLink).toHaveAttribute('href', /^https?:\/\/.+/);
    await expect(ctaLink).toHaveAttribute('target', '_blank');
    const rel = await ctaLink.getAttribute('rel');
    expect(rel).toContain('sponsored');
    expect(rel).toContain('noopener');
  });

  test('shows the Zerodha-AP disclosure with the SEBI and AP registration numbers', async ({ page }) => {
    await page.goto(`${BASE_URL}/affiliates`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    await expect(page.getByText(/INZ000031633/)).toBeVisible();
    await expect(page.getByText(/AP2516003693/)).toBeVisible();
  });

  test('never renders invented claims or other brokers', async ({ page }) => {
    await page.goto(`${BASE_URL}/affiliates`);
    await page.waitForLoadState('networkidle');

    const bodyText = await page.evaluate(() => document.body.innerHTML);
    for (const claim of INVENTED_CLAIMS) {
      expect(bodyText).not.toContain(claim);
    }
  });

  test('page does not crash and has no uncaught console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${BASE_URL}/affiliates`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /Partner Broker/i })
    ).toBeVisible();

    const criticalErrors = consoleErrors.filter((err) => err.includes('Uncaught'));
    expect(criticalErrors.length).toBe(0);
  });

  test('mobile: page and the single broker card are responsive', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}/affiliates`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /Partner Broker/i })
    ).toBeVisible();

    const brokerCards = page.getByTestId('broker-card');
    await expect(brokerCards).toHaveCount(1);

    const cardBox = await brokerCards.first().boundingBox();
    expect(cardBox).toBeTruthy();
    if (cardBox) {
      expect(cardBox.width).toBeGreaterThan(300);
    }
  });

  test('has correct page title and URL', async ({ page }) => {
    await page.goto(`${BASE_URL}/affiliates`);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveTitle(/Partner Brokers.*IPODhan/i);
    expect(page.url()).toBe(`${BASE_URL}/affiliates`);
  });
});
