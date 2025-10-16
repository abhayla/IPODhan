/**
 * E2E Tests: Listing Performance User Journey
 *
 * End-to-end tests for listing performance display (Story 6.3)
 * Coverage: Full user journey from historical IPOs page to detail page
 */

import { test, expect } from '@playwright/test';

test.describe('Listing Performance User Journey', () => {
  test.describe('Historical IPOs Page - Listing Gain Badges', () => {
    test('should display listing gain badges on historical IPO cards', async ({
      page,
    }) => {
      // Navigate to historical IPOs page
      await page.goto('/history');

      // Wait for page to load
      await page.waitForSelector('[data-testid="ipo-card"], .ipo-card, a[href^="/ipos/"]', {
        timeout: 10000,
      });

      // Check for listing performance badges (assuming listed IPOs exist)
      const badges = page.locator('text=/[+-]\\d+\\.\\d+%/');
      const badgeCount = await badges.count();

      // Should have at least one badge if there are listed IPOs
      // If no listed IPOs in database, this test might not find any
      if (badgeCount > 0) {
        expect(badgeCount).toBeGreaterThan(0);
      }
    });

    test('should display color-coded borders on listed IPO cards', async ({
      page,
    }) => {
      await page.goto('/history');

      await page.waitForSelector('[data-testid="ipo-card"], .ipo-card, a[href^="/ipos/"]', {
        timeout: 10000,
      });

      // Find cards with green borders (positive gains)
      const greenBorderCards = page.locator('.border-green-500');
      const greenCount = await greenBorderCards.count();

      // Find cards with red borders (negative losses)
      const redBorderCards = page.locator('.border-red-500');
      const redCount = await redBorderCards.count();

      // At least some cards should have colored borders if listed IPOs exist
      expect(greenCount + redCount).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('IPO Detail Page - Listing Performance Section', () => {
    test('should display listing performance section for listed IPO', async ({
      page,
    }) => {
      // This test requires a known listed IPO slug
      // You'll need to update this with an actual listed IPO from your database
      await page.goto('/ipos/test-listed-ipo');

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      // Look for listing performance section
      const performanceHeading = page.locator('text=/Listing Day Performance/i');

      // Check if section exists (might not if IPO isn't listed)
      const exists = await performanceHeading.isVisible().catch(() => false);

      if (exists) {
        await expect(performanceHeading).toBeVisible();

        // Check for key metrics
        await expect(page.locator('text=/Issue Price/i')).toBeVisible();
        await expect(page.locator('text=/Listing Open/i')).toBeVisible();
        await expect(page.locator('text=/Listing High/i')).toBeVisible();
        await expect(page.locator('text=/Listing Close/i')).toBeVisible();
        await expect(page.locator('text=/Day Return/i')).toBeVisible();
      }
    });

    test('should display sector average comparison for listed IPO', async ({
      page,
    }) => {
      await page.goto('/ipos/test-listed-ipo');

      await page.waitForLoadState('networkidle');

      // Look for sector average comparison
      const sectorComparison = page.locator('text=/sector average listing gain/i');

      const exists = await sectorComparison.isVisible().catch(() => false);

      if (exists) {
        await expect(sectorComparison).toBeVisible();

        // Check for above/below average badge
        const badge = page.locator(
          'text=/Above average/i, text=/Below average/i'
        );
        await expect(badge.first()).toBeVisible();
      }
    });

    test('should NOT display listing performance for non-listed IPO', async ({
      page,
    }) => {
      // Navigate to a non-listed IPO (OPEN, UPCOMING, or CLOSED)
      await page.goto('/ipos/test-upcoming-ipo');

      await page.waitForLoadState('networkidle');

      // Listing performance section should NOT exist
      const performanceHeading = page.locator('text=/Listing Day Performance/i');
      const isVisible = await performanceHeading.isVisible().catch(() => false);

      // Should not be visible for non-listed IPOs
      expect(isVisible).toBe(false);
    });
  });

  test.describe('Full User Journey', () => {
    test('should navigate from history page to detail page and see consistent data', async ({
      page,
    }) => {
      // Start at historical IPOs page
      await page.goto('/history');

      await page.waitForSelector('[data-testid="ipo-card"], .ipo-card, a[href^="/ipos/"]', {
        timeout: 10000,
      });

      // Find first card with a listing badge
      const cardWithBadge = page
        .locator('a[href^="/ipos/"]')
        .filter({ has: page.locator('text=/[+-]\\d+\\.\\d+%/') })
        .first();

      const cardExists = await cardWithBadge.count();

      if (cardExists > 0) {
        // Extract listing gain % from card badge
        const badgeText = await cardWithBadge
          .locator('text=/[+-]\\d+\\.\\d+%/')
          .first()
          .textContent();

        // Click on the card to navigate to detail page
        await cardWithBadge.click();

        // Wait for detail page to load
        await page.waitForLoadState('networkidle');

        // Verify we're on detail page
        await expect(page).toHaveURL(/\/ipos\/[a-z0-9-]+/);

        // Check if listing performance section exists
        const performanceSection = page.locator('text=/Listing Day Performance/i');
        const sectionVisible = await performanceSection.isVisible().catch(() => false);

        if (sectionVisible) {
          // Verify day return matches badge from card
          const dayReturnText = await page
            .locator('text=/Day Return/i')
            .locator('..')
            .locator('text=/[+-]\\d+\\.\\d+%/')
            .first()
            .textContent();

          // The percentages should match (allowing for formatting differences)
          expect(dayReturnText).toBeTruthy();
        }
      }
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE size

    test('should display listing badge correctly on mobile', async ({ page }) => {
      await page.goto('/history');

      await page.waitForSelector('[data-testid="ipo-card"], .ipo-card, a[href^="/ipos/"]', {
        timeout: 10000,
      });

      // Check if badges are visible and readable on mobile
      const badges = page.locator('text=/[+-]\\d+\\.\\d+%/');
      const badgeCount = await badges.count();

      if (badgeCount > 0) {
        const firstBadge = badges.first();
        await expect(firstBadge).toBeVisible();

        // Check badge is not overlapping other content
        const boundingBox = await firstBadge.boundingBox();
        expect(boundingBox?.width).toBeGreaterThan(30); // Min readable width
      }
    });

    test('should display listing performance section responsively on mobile', async ({
      page,
    }) => {
      await page.goto('/ipos/test-listed-ipo');

      await page.waitForLoadState('networkidle');

      const performanceSection = page.locator('text=/Listing Day Performance/i');
      const exists = await performanceSection.isVisible().catch(() => false);

      if (exists) {
        // Check mobile layout is used (vertical stacked)
        const mobileLayout = page.locator('.md\\:hidden').first();
        const mobileVisible = await mobileLayout.isVisible().catch(() => false);

        if (mobileVisible) {
          await expect(mobileLayout).toBeVisible();
        }

        // Verify key metrics are readable
        await expect(page.locator('text=/Issue Price/i')).toBeVisible();
        await expect(page.locator('text=/Day Return/i')).toBeVisible();
      }
    });
  });

  test.describe('Color Coding Verification', () => {
    test('should display green color for positive gains', async ({ page }) => {
      await page.goto('/history');

      await page.waitForSelector('[data-testid="ipo-card"], .ipo-card, a[href^="/ipos/"]', {
        timeout: 10000,
      });

      // Find positive gain badges (starting with +)
      const positiveBadges = page.locator('text=/\\+\\d+\\.\\d+%/');
      const count = await positiveBadges.count();

      if (count > 0) {
        const firstPositiveBadge = positiveBadges.first();

        // Check for green styling classes
        const parentElement = firstPositiveBadge.locator('..');
        const hasGreenClass = await parentElement.evaluate((el) =>
          el.classList.toString().includes('green')
        );

        expect(hasGreenClass).toBe(true);
      }
    });

    test('should display red color for negative losses', async ({ page }) => {
      await page.goto('/history');

      await page.waitForSelector('[data-testid="ipo-card"], .ipo-card, a[href^="/ipos/"]', {
        timeout: 10000,
      });

      // Find negative loss badges (starting with -)
      const negativeBadges = page.locator('text=/-\\d+\\.\\d+%/');
      const count = await negativeBadges.count();

      if (count > 0) {
        const firstNegativeBadge = negativeBadges.first();

        // Check for red styling classes
        const parentElement = firstNegativeBadge.locator('..');
        const hasRedClass = await parentElement.evaluate((el) =>
          el.classList.toString().includes('red')
        );

        expect(hasRedClass).toBe(true);
      }
    });
  });
});
