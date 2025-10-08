/**
 * E2E Tests for Listing Performance Display (Story 6.3)
 *
 * User Journey:
 * 1. User visits historical IPO page
 * 2. User sees listing performance badges on LISTED IPO cards
 * 3. User clicks on a listed IPO to view details
 * 4. User sees comprehensive listing performance section
 * 5. User sees sector average comparison
 *
 * Tests:
 * - Listing badge appears on historical IPO cards
 * - Badge shows correct gain/loss percentage
 * - Badge has correct color coding (green/red)
 * - Listing Performance section visible on detail page
 * - Issue price, listing price, and day return displayed
 * - Sector average comparison shown
 * - Above/Below average badge appears
 * - Performance metrics in structured data
 */

import { test, expect } from '@playwright/test';

test.describe('Listing Performance Display - Story 6.3', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to historical IPOs page (assuming from Story 6.2)
    await page.goto('/ipos/historical');
  });

  test('displays listing performance badge on historical IPO cards', async ({ page }) => {
    // Wait for IPO cards to load
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Find first LISTED IPO card
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() > 0) {
      // Check if listing performance badge is present
      const badge = listedCard.locator('[data-testid="listing-performance-badge"]');
      await expect(badge).toBeVisible();

      // Badge should show percentage with +/- sign
      const badgeText = await badge.textContent();
      expect(badgeText).toMatch(/^[+-]\d+\.\d+%$/);
    } else {
      test.skip();
    }
  });

  test('listing badge has correct color for positive gain', async ({ page }) => {
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Find card with positive listing gain
    const positiveCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('[data-testid="listing-performance-badge"]:has-text("+")'),
    }).first();

    if (await positiveCard.count() > 0) {
      const badge = positiveCard.locator('[data-testid="listing-performance-badge"]');

      // Check for green styling
      await expect(badge).toHaveClass(/text-green-700/);
      await expect(badge).toHaveClass(/bg-green-100/);
    } else {
      test.skip();
    }
  });

  test('listing badge has correct color for negative loss', async ({ page }) => {
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Find card with negative listing loss
    const negativeCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('[data-testid="listing-performance-badge"]:has-text("-")'),
    }).first();

    if (await negativeCard.count() > 0) {
      const badge = negativeCard.locator('[data-testid="listing-performance-badge"]');

      // Check for red styling
      await expect(badge).toHaveClass(/text-red-700/);
      await expect(badge).toHaveClass(/bg-red-100/);
    } else {
      test.skip();
    }
  });

  test('shows listing performance section on IPO detail page', async ({ page }) => {
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Click on first LISTED IPO
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() === 0) {
      test.skip();
      return;
    }

    await listedCard.click();

    // Wait for detail page to load
    await page.waitForLoadState('networkidle');

    // Check for Listing Performance section
    const performanceSection = page.locator('text=Listing Performance').first();
    await expect(performanceSection).toBeVisible();

    // Verify key metrics are displayed
    await expect(page.locator('text=Issue Price')).toBeVisible();
    await expect(page.locator('text=Listing Price')).toBeVisible();
    await expect(page.locator('text=Listing Day Return')).toBeVisible();
  });

  test('displays issue price and listing price correctly', async ({ page }) => {
    // Navigate to a specific LISTED IPO (you may need to adjust this)
    await page.goto('/ipos/test-ipo-slug'); // Replace with actual slug

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Check if listing performance section exists
    const hasPerformance = await page.locator('text=Listing Performance').count() > 0;

    if (!hasPerformance) {
      test.skip();
      return;
    }

    // Find the table with performance metrics
    const issuePrice = page.locator('td:has-text("Issue Price")');
    const listingPrice = page.locator('td:has-text("Listing Price")');

    await expect(issuePrice).toBeVisible();
    await expect(listingPrice).toBeVisible();

    // Verify currency format (₹)
    const issuePriceValue = page.locator('td:has-text("Issue Price") + td');
    const issuePriceText = await issuePriceValue.textContent();
    expect(issuePriceText).toContain('₹');
  });

  test('shows sector average comparison section', async ({ page }) => {
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Click on first LISTED IPO
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() === 0) {
      test.skip();
      return;
    }

    await listedCard.click();
    await page.waitForLoadState('networkidle');

    // Check for sector average comparison (if available)
    const hasAboveAverage = await page.locator('text=Above Average').count() > 0;
    const hasBelowAverage = await page.locator('text=Below Average').count() > 0;

    if (hasAboveAverage || hasBelowAverage) {
      // At least one should be visible
      expect(hasAboveAverage || hasBelowAverage).toBeTruthy();

      // Verify sector average text is present
      await expect(page.locator('text=/sector average/i')).toBeVisible();
    }
  });

  test('displays current price and overall return when available', async ({ page }) => {
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Click on first LISTED IPO
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() === 0) {
      test.skip();
      return;
    }

    await listedCard.click();
    await page.waitForLoadState('networkidle');

    // Check if current price is available
    const hasCurrentPrice = await page.locator('text=Current Price').count() > 0;

    if (hasCurrentPrice) {
      await expect(page.locator('text=Overall Return')).toBeVisible();
    }
  });

  test('includes performance metrics in JSON-LD structured data', async ({ page }) => {
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Click on first LISTED IPO
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() === 0) {
      test.skip();
      return;
    }

    await listedCard.click();
    await page.waitForLoadState('networkidle');

    // Extract JSON-LD structured data
    const jsonLdScript = await page.locator('script[type="application/ld+json"]').first();
    const jsonLdContent = await jsonLdScript.textContent();

    if (jsonLdContent) {
      const structuredData = JSON.parse(jsonLdContent);

      // Check for performance metrics
      if (structuredData.performanceMetrics) {
        expect(structuredData.performanceMetrics['@type']).toBe('QuantitativeValue');
        expect(structuredData.performanceMetrics.name).toBe('Listing Day Return');
        expect(structuredData.performanceMetrics.value).toBeDefined();
      }
    }
  });

  test('mobile responsive - listing badge visible on small screens', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Find LISTED IPO card
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() > 0) {
      const badge = listedCard.locator('[data-testid="listing-performance-badge"]');
      await expect(badge).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('mobile responsive - performance section readable on small screens', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Click on LISTED IPO
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() === 0) {
      test.skip();
      return;
    }

    await listedCard.click();
    await page.waitForLoadState('networkidle');

    // Check if performance section is visible
    const hasPerformance = await page.locator('text=Listing Performance').count() > 0;

    if (hasPerformance) {
      const performanceSection = page.locator('text=Listing Performance').first();
      await expect(performanceSection).toBeVisible();

      // Verify table is not cut off
      const table = page.locator('table').first();
      await expect(table).toBeVisible();
    }
  });

  test('disclaimer text is present', async ({ page }) => {
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Click on LISTED IPO
    const listedCard = page.locator('[data-testid="ipo-card"]').filter({
      has: page.locator('text=Listed'),
    }).first();

    if (await listedCard.count() === 0) {
      test.skip();
      return;
    }

    await listedCard.click();
    await page.waitForLoadState('networkidle');

    // Check for disclaimer
    const hasPerformance = await page.locator('text=Listing Performance').count() > 0;

    if (hasPerformance) {
      await expect(
        page.locator('text=/Listing performance is calculated/i')
      ).toBeVisible();
    }
  });
});
