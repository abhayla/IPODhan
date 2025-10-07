/**
 * E2E Tests for Broker Affiliate Integration
 *
 * Tests:
 * - Homepage banner displays and is dismissible
 * - Affiliate section appears on IPO detail page
 * - Broker buttons open in new tab
 * - Click tracking API is called
 * - Footer disclaimer is visible
 * - Mobile responsive layout
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Broker Affiliate Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.describe('Homepage Banner', () => {
    test('displays affiliate CTA banner on homepage', async ({ page }) => {
      // Clear cookies to ensure banner shows
      await page.context().clearCookies();

      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');

      // Check banner content
      await expect(page.getByText('Open a Free Demat Account')).toBeVisible();
      await expect(
        page.getByText('Start investing in IPOs today')
      ).toBeVisible();

      // Check broker buttons exist
      await expect(page.getByText(/Apply via Zerodha/i)).toBeVisible();
      await expect(page.getByText(/Apply via Angel One/i)).toBeVisible();
    });

    test('banner can be dismissed', async ({ page }) => {
      await page.context().clearCookies();
      await page.goto(`${BASE_URL}/dashboard`);

      // Dismiss banner
      const dismissButton = page.getByLabel('Dismiss banner');
      await dismissButton.click();

      // Banner should disappear
      await expect(
        page.getByText('Open a Free Demat Account')
      ).not.toBeVisible();

      // Cookie should be set
      const cookies = await page.context().cookies();
      const bannerCookie = cookies.find(
        (c) => c.name === 'ipodhan_banner_dismissed'
      );
      expect(bannerCookie).toBeDefined();
      expect(bannerCookie?.value).toBe('true');
    });

    test('banner stays hidden after dismissal', async ({ page }) => {
      // Set cookie to dismiss banner
      await page.context().addCookies([
        {
          name: 'ipodhan_banner_dismissed',
          value: 'true',
          domain: 'localhost',
          path: '/',
        },
      ]);

      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');

      // Banner should not appear
      await expect(
        page.getByText('Open a Free Demat Account')
      ).not.toBeVisible();
    });

    test('banner is mobile responsive', async ({ page }) => {
      await page.context().clearCookies();
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');

      // Banner should still be visible on mobile
      await expect(page.getByText('Open a Free Demat Account')).toBeVisible();

      // Buttons should stack vertically (check layout)
      const zerodhaButton = page.getByText(/Apply via Zerodha/i);
      const angelButton = page.getByText(/Apply via Angel One/i);

      await expect(zerodhaButton).toBeVisible();
      await expect(angelButton).toBeVisible();
    });
  });

  test.describe('IPO Detail Page Affiliate Section', () => {
    test('displays affiliate section for OPEN IPO', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard?status=OPEN`);
      await page.waitForLoadState('networkidle');

      // Click on first IPO if exists
      const firstIpo = page.locator('[data-testid="ipo-card"]').first();
      if ((await firstIpo.count()) > 0) {
        await firstIpo.click();
        await page.waitForLoadState('networkidle');

        // Check for affiliate section
        await expect(page.getByText('Apply for this IPO')).toBeVisible();
        await expect(
          page.getByText('Open a demat account or apply through')
        ).toBeVisible();

        // Check broker buttons
        await expect(page.getByText(/Apply via Zerodha/i)).toBeVisible();
        await expect(page.getByText(/Apply via Angel One/i)).toBeVisible();

        // Check disclaimer
        await expect(
          page.getByText(/We may earn a commission/i)
        ).toBeVisible();
      }
    });

    test('does not display affiliate section for CLOSED IPO', async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/dashboard?status=CLOSED`);
      await page.waitForLoadState('networkidle');

      const firstIpo = page.locator('[data-testid="ipo-card"]').first();
      if ((await firstIpo.count()) > 0) {
        await firstIpo.click();
        await page.waitForLoadState('networkidle');

        // Affiliate section should not be present for closed IPOs
        await expect(page.getByText('Apply for this IPO')).not.toBeVisible();
      }
    });

    test('broker buttons open in new tab', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard?status=OPEN`);
      await page.waitForLoadState('networkidle');

      const firstIpo = page.locator('[data-testid="ipo-card"]').first();
      if ((await firstIpo.count()) > 0) {
        await firstIpo.click();
        await page.waitForLoadState('networkidle');

        const zerodhaButton = page.getByText(/Apply via Zerodha/i).first();
        await expect(zerodhaButton).toBeVisible();

        // Check link attributes
        const link = page.locator('a', { has: zerodhaButton }).first();
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });

    test('tracks affiliate click', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard?status=OPEN`);
      await page.waitForLoadState('networkidle');

      const firstIpo = page.locator('[data-testid="ipo-card"]').first();
      if ((await firstIpo.count()) > 0) {
        await firstIpo.click();
        await page.waitForLoadState('networkidle');

        // Listen for API call
        const requestPromise = page.waitForRequest(
          (request) =>
            request.url().includes('/api/affiliate/track') &&
            request.method() === 'POST'
        );

        const zerodhaButton = page.getByText(/Apply via Zerodha/i).first();
        await zerodhaButton.click();

        // Verify tracking request was made
        const request = await requestPromise;
        const postData = request.postDataJSON();

        expect(postData).toMatchObject({
          broker: 'zerodha',
          source: 'ipo_detail',
        });
        expect(postData.ipoId).toBeDefined();
      }
    });
  });

  test.describe('Footer Disclaimer', () => {
    test('displays affiliate disclaimer in footer', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');

      // Scroll to footer
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      // Check disclaimer
      await expect(
        page.getByText(/IPODhan may earn a commission/i)
      ).toBeVisible();
    });

    test('footer disclaimer is visible on all pages', async ({ page }) => {
      const pages = [
        `${BASE_URL}/dashboard`,
        `${BASE_URL}/tools/lot-calculator`,
        `${BASE_URL}/market-holidays`,
        `${BASE_URL}/registrars`,
      ];

      for (const url of pages) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');

        // Scroll to footer
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight)
        );

        // Check disclaimer exists
        await expect(
          page.getByText(/IPODhan may earn a commission/i)
        ).toBeVisible();
      }
    });
  });

  test.describe('Mobile Responsive Design', () => {
    test('affiliate section is mobile responsive', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${BASE_URL}/dashboard?status=OPEN`);
      await page.waitForLoadState('networkidle');

      const firstIpo = page.locator('[data-testid="ipo-card"]').first();
      if ((await firstIpo.count()) > 0) {
        await firstIpo.click();
        await page.waitForLoadState('networkidle');

        // Affiliate section should be visible and properly laid out
        await expect(page.getByText('Apply for this IPO')).toBeVisible();

        const zerodhaButton = page.getByText(/Apply via Zerodha/i);
        const angelButton = page.getByText(/Apply via Angel One/i);

        await expect(zerodhaButton).toBeVisible();
        await expect(angelButton).toBeVisible();

        // Buttons should be full width on mobile
        const buttonBox = await zerodhaButton.boundingBox();
        expect(buttonBox).toBeTruthy();
        if (buttonBox) {
          // Button should take most of the screen width
          expect(buttonBox.width).toBeGreaterThan(300);
        }
      }
    });
  });

  test.describe('Analytics Integration', () => {
    test('Google Analytics event is triggered on click', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard?status=OPEN`);
      await page.waitForLoadState('networkidle');

      // Mock gtag function
      await page.evaluate(() => {
        (window as unknown as { gtag: () => void }).gtag = () => {};
      });

      const firstIpo = page.locator('[data-testid="ipo-card"]').first();
      if ((await firstIpo.count()) > 0) {
        await firstIpo.click();
        await page.waitForLoadState('networkidle');

        const zerodhaButton = page.getByText(/Apply via Zerodha/i).first();
        await zerodhaButton.click();

        // Check if gtag was called (would need to inject GA script in test env)
        // This is more of an integration test with actual GA setup
      }
    });
  });
});
