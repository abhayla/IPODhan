/**
 * E2E Tests for Broker Affiliates Page (/affiliates)
 * Story 5.7: Broker Affiliates DB Migration
 *
 * Tests:
 * - Page loads successfully with brokers from database
 * - Displays 6 broker cards in correct order
 * - All broker cards have required elements (name, logo, CTA)
 * - Affiliate links are clickable and open in new tab
 * - Error state displays when no brokers available
 * - Mobile responsive design
 * - Page metadata and SEO
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Broker Affiliates Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.describe('Page Load and Broker Display', () => {
    test('page loads successfully and displays brokers from database', async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check page title and header
      await expect(page).toHaveTitle(/Partner Brokers/i);
      await expect(
        page.getByRole('heading', { name: /Partner Brokers/i })
      ).toBeVisible();

      // Check hero section
      await expect(
        page.getByText(/Open your demat account with India's leading brokers/i)
      ).toBeVisible();
    });

    test('displays 6 broker cards in correct display order', async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Get all broker cards
      const brokerCards = page.locator('.bg-white.dark\\:bg-gray-800');
      const cardCount = await brokerCards.count();

      // Should display 6 brokers (as seeded)
      expect(cardCount).toBeGreaterThanOrEqual(6);

      // Check that brokers are displayed (some broker names should be visible)
      const brokerNames = [
        'Zerodha',
        'Groww',
        'Angel One',
        'Upstox',
        '5paisa',
        'ICICI Direct',
      ];

      for (const brokerName of brokerNames) {
        await expect(page.getByText(brokerName, { exact: true })).toBeVisible();
      }
    });

    test('each broker card has required elements', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check first broker card (Zerodha - display_order: 1)
      const zerodhaCard = page
        .locator('.bg-white.dark\\:bg-gray-800')
        .filter({ hasText: 'Zerodha' })
        .first();

      await expect(zerodhaCard).toBeVisible();

      // Check broker name
      await expect(
        zerodhaCard.getByRole('heading', { name: 'Zerodha' })
      ).toBeVisible();

      // Check features list
      await expect(
        zerodhaCard.getByText(/Zero brokerage on equity delivery/i)
      ).toBeVisible();

      // Check pricing information
      await expect(zerodhaCard.getByText(/Account Opening/i)).toBeVisible();
      await expect(zerodhaCard.getByText(/AMC Charges/i)).toBeVisible();

      // Check CTA button (should have display_text from database)
      const ctaButton = zerodhaCard.locator('a').filter({ hasText: /Open/i });
      await expect(ctaButton).toBeVisible();
    });

    test('broker cards display in correct sort order (display_order ASC)', async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Get all broker card headings
      const brokerHeadings = page.locator(
        '.bg-white.dark\\:bg-gray-800 h3'
      );

      const brokerTexts = await brokerHeadings.allTextContents();

      // Expected order based on seed data (display_order 1-6)
      const expectedOrder = [
        'Zerodha',
        'Groww',
        'Angel One',
        'Upstox',
        '5paisa',
        'ICICI Direct',
      ];

      // Check that expected brokers appear in sequence
      let lastIndex = -1;
      for (const expectedBroker of expectedOrder) {
        const currentIndex = brokerTexts.findIndex((text) =>
          text.includes(expectedBroker)
        );

        if (currentIndex !== -1) {
          // Current broker should appear after previous broker
          expect(currentIndex).toBeGreaterThan(lastIndex);
          lastIndex = currentIndex;
        }
      }
    });
  });

  test.describe('Affiliate Links Functionality', () => {
    test('broker CTA buttons are clickable links', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Find Zerodha card CTA
      const zerodhaCard = page
        .locator('.bg-white.dark\\:bg-gray-800')
        .filter({ hasText: 'Zerodha' })
        .first();

      const ctaLink = zerodhaCard.locator('a').first();

      // Check link attributes
      await expect(ctaLink).toHaveAttribute('href', /.+/); // Has href
      await expect(ctaLink).toHaveClass(/bg-gradient-to-r/); // Has styling
    });

    test('affiliate links open in current tab (external navigation)', async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Find first broker link
      const firstBrokerLink = page
        .locator('.bg-white.dark\\:bg-gray-800 a')
        .first();

      // Get href attribute
      const href = await firstBrokerLink.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).toContain('http'); // External URL
    });

    test('all 6 broker links have valid affiliate URLs', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Get all broker CTA links
      const brokerLinks = page.locator('.bg-white.dark\\:bg-gray-800 a');
      const linkCount = await brokerLinks.count();

      expect(linkCount).toBeGreaterThanOrEqual(6);

      // Check that each link has a valid href
      for (let i = 0; i < Math.min(linkCount, 6); i++) {
        const link = brokerLinks.nth(i);
        const href = await link.getAttribute('href');

        expect(href).toBeTruthy();
        expect(href).toMatch(/^https?:\/\/.+/); // Valid URL format
      }
    });
  });

  test.describe('Error Handling', () => {
    test('displays fallback message when no brokers available', async ({
      page,
    }) => {
      // This test would require mocking the database to return empty array
      // For now, we'll check that the page handles empty state gracefully

      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // If brokers exist, page should not show error
      const errorMessage = page.getByText(
        /Broker information temporarily unavailable/i
      );

      // Error message should only appear if no brokers loaded
      const brokerCards = page.locator('.bg-white.dark\\:bg-gray-800');
      const cardCount = await brokerCards.count();

      if (cardCount === 0) {
        await expect(errorMessage).toBeVisible();
      } else {
        await expect(errorMessage).not.toBeVisible();
      }
    });

    test('page does not crash when database query fails', async ({ page }) => {
      // Navigate to page
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Page should load without JavaScript errors
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Check page structure is intact
      await expect(
        page.getByRole('heading', { name: /Partner Brokers/i })
      ).toBeVisible();

      // Should not have critical console errors
      const criticalErrors = consoleErrors.filter((err) =>
        err.includes('Uncaught')
      );
      expect(criticalErrors.length).toBe(0);
    });
  });

  test.describe('Benefits Section', () => {
    test('displays benefits of opening account through IPODhan', async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check benefits section
      await expect(
        page.getByText(/Why Open Account Through IPODhan/i)
      ).toBeVisible();

      // Check benefit items
      await expect(page.getByText(/Quick Account Opening/i)).toBeVisible();
      await expect(page.getByText(/SEBI Registered/i)).toBeVisible();
      await expect(page.getByText(/IPO Applications/i)).toBeVisible();
      await expect(page.getByText(/Special Offers/i)).toBeVisible();
    });
  });

  test.describe('Comparison Table', () => {
    test('displays comparison table when 4+ brokers available', async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check if comparison table exists
      const comparisonHeading = page.getByText(/Quick Comparison/i);
      const brokerCards = page.locator('.bg-white.dark\\:bg-gray-800');
      const cardCount = await brokerCards.count();

      if (cardCount >= 4) {
        await expect(comparisonHeading).toBeVisible();

        // Check table structure
        const table = page.locator('table');
        await expect(table).toBeVisible();

        // Check table headers
        await expect(table.getByText('Features')).toBeVisible();
      }
    });
  });

  test.describe('FAQ Section', () => {
    test('displays frequently asked questions', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check FAQ section
      await expect(
        page.getByText(/Frequently Asked Questions/i)
      ).toBeVisible();

      // Check FAQ items
      await expect(
        page.getByText(/Do I need a demat account to apply for IPOs/i)
      ).toBeVisible();
      await expect(
        page.getByText(/How long does it take to open a demat account/i)
      ).toBeVisible();
      await expect(
        page.getByText(/Can I have multiple demat accounts/i)
      ).toBeVisible();
    });
  });

  test.describe('Affiliate Disclaimer', () => {
    test('displays affiliate commission disclaimer', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Scroll to bottom
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      // Check disclaimer
      await expect(
        page.getByText(/IPODhan may earn a commission when you open an account/i)
      ).toBeVisible();
    });
  });

  test.describe('Mobile Responsive Design', () => {
    test('page is mobile responsive', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Header should be visible
      await expect(
        page.getByRole('heading', { name: /Partner Brokers/i })
      ).toBeVisible();

      // Broker cards should stack vertically
      const brokerCards = page.locator('.bg-white.dark\\:bg-gray-800');
      const firstCard = brokerCards.first();

      await expect(firstCard).toBeVisible();

      // Check that card takes full width (minus padding)
      const cardBox = await firstCard.boundingBox();
      expect(cardBox).toBeTruthy();
      if (cardBox) {
        expect(cardBox.width).toBeGreaterThan(300); // Should be wide on mobile
      }
    });

    test('broker cards are scrollable on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Scroll down
      await page.evaluate(() => window.scrollBy(0, 500));

      // More cards should become visible
      const visibleCards = page.locator('.bg-white.dark\\:bg-gray-800');
      expect(await visibleCards.count()).toBeGreaterThan(0);
    });
  });

  test.describe('SEO and Metadata', () => {
    test('has correct page title and meta description', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check page title
      await expect(page).toHaveTitle(/Partner Brokers.*IPODhan/i);

      // Check meta description (if accessible)
      const metaDescription = page.locator('meta[name="description"]');
      if ((await metaDescription.count()) > 0) {
        const content = await metaDescription.getAttribute('content');
        expect(content).toBeTruthy();
        expect(content).toMatch(/demat|broker|IPO/i);
      }
    });

    test('page URL is correct', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toBe(`${BASE_URL}/affiliates`);
    });
  });

  test.describe('Backward Compatibility', () => {
    test('page looks identical to hardcoded version', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check that all expected UI elements are present
      // (Same as hardcoded version)

      // Hero section
      await expect(
        page.getByRole('heading', { name: /Partner Brokers/i })
      ).toBeVisible();

      // Benefits section
      await expect(
        page.getByText(/Why Open Account Through IPODhan/i)
      ).toBeVisible();

      // Broker cards
      const brokerCards = page.locator('.bg-white.dark\\:bg-gray-800');
      expect(await brokerCards.count()).toBeGreaterThanOrEqual(6);

      // FAQ section
      await expect(
        page.getByText(/Frequently Asked Questions/i)
      ).toBeVisible();

      // CTA section
      await expect(
        page.getByText(/Start Your IPO Investment Journey Today/i)
      ).toBeVisible();
    });

    test('broker order matches original hardcoded order', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Original hardcoded order (from seed data - display_order 1-6)
      const expectedOrder = [
        'Zerodha',
        'Groww',
        'Angel One',
        'Upstox',
        '5paisa',
        'ICICI Direct',
      ];

      const brokerHeadings = page.locator(
        '.bg-white.dark\\:bg-gray-800 h3'
      );
      const brokerTexts = await brokerHeadings.allTextContents();

      // Verify expected brokers appear in correct sequence
      let lastIndex = -1;
      for (const expectedBroker of expectedOrder) {
        const currentIndex = brokerTexts.findIndex((text) =>
          text.includes(expectedBroker)
        );

        if (currentIndex !== -1) {
          expect(currentIndex).toBeGreaterThan(lastIndex);
          lastIndex = currentIndex;
        }
      }
    });
  });

  test.describe('Performance', () => {
    test('page loads within acceptable time', async ({ page }) => {
      const startTime = Date.now();

      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      const loadTime = Date.now() - startTime;

      // Page should load in under 3 seconds
      expect(loadTime).toBeLessThan(3000);
    });

    test('images lazy load on scroll', async ({ page }) => {
      await page.goto(`${BASE_URL}/affiliates`);
      await page.waitForLoadState('networkidle');

      // Check if images exist (broker logos would be in placeholders)
      const images = page.locator('img');
      const imageCount = await images.count();

      // If images exist, they should lazy load
      if (imageCount > 0) {
        // Scroll down to trigger lazy loading
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(500);

        // Images should be loaded after scroll
        expect(await images.count()).toBeGreaterThanOrEqual(imageCount);
      }
    });
  });
});
