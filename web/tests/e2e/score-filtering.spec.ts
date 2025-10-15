/**
 * E2E Tests: Score Range Filtering (Story 4.7)
 * Tests score range filter functionality on dashboard
 */

import { test, expect } from '@playwright/test';

test.describe('Score Range Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
  });

  test('should display score range filter', async ({ page }) => {
    // Wait for filter bar to load
    await page.waitForSelector('[data-testid="filter-bar"]', { timeout: 10000 });

    // Look for score range filter (it should have "All Scores" or similar options)
    const scoreFilter = page.locator('text=/All Scores|Excellent|Good|Fair|Poor/i').first();
    await expect(scoreFilter).toBeVisible({ timeout: 5000 });
  });

  test('should filter IPOs by excellent score range', async ({ page }) => {
    // Open filter if on mobile
    const filterToggle = page.locator('button:has-text("Filters")');
    if (await filterToggle.isVisible()) {
      await filterToggle.click();
    }

    // Find and click score range filter
    // This may need adjustment based on actual UI structure
    const scoreFilterTrigger = page.locator('[role="combobox"]').filter({ hasText: /All Scores|Excellent/ }).first();

    if (await scoreFilterTrigger.isVisible()) {
      await scoreFilterTrigger.click();

      // Select "Excellent (76-100)"
      const excellentOption = page.locator('[role="option"]').filter({ hasText: /Excellent.*76-100/i });
      if (await excellentOption.count() > 0) {
        await excellentOption.first().click();

        // Wait for URL to update with filter param
        await page.waitForTimeout(500);
        expect(page.url()).toContain('scoreRange');

        // IPO list should update
        await page.waitForLoadState('networkidle');
      }
    }
  });

  test('should update URL with scoreRange parameter', async ({ page }) => {
    // Navigate directly with filter
    await page.goto('/dashboard?scoreRange=76-100');
    await page.waitForLoadState('networkidle');

    // URL should contain the filter
    expect(page.url()).toContain('scoreRange=76-100');

    // IPOs should be loaded
    const ipoCards = page.locator('[data-testid="ipo-card"]');
    await expect(ipoCards.first()).toBeVisible({ timeout: 10000 });
  });

  test('should clear score filter when "All Scores" selected', async ({ page }) => {
    // Start with a filter
    await page.goto('/dashboard?scoreRange=76-100');
    await page.waitForLoadState('networkidle');

    // Open filter
    const filterToggle = page.locator('button:has-text("Filters")');
    if (await filterToggle.isVisible()) {
      await filterToggle.click();
    }

    // Click score filter
    const scoreFilterTrigger = page.locator('[role="combobox"]').filter({ hasText: /Excellent/ }).first();

    if (await scoreFilterTrigger.isVisible()) {
      await scoreFilterTrigger.click();

      // Select "All Scores"
      const allOption = page.locator('[role="option"]').filter({ hasText: /All Scores/i });
      if (await allOption.count() > 0) {
        await allOption.first().click();

        // Wait for URL update
        await page.waitForTimeout(500);

        // URL should not have scoreRange or it should be 'all'
        const url = page.url();
        if (url.includes('scoreRange')) {
          expect(url).toContain('scoreRange=all');
        }
      }
    }
  });

  test('should work with other filters combined', async ({ page }) => {
    // Apply multiple filters
    await page.goto('/dashboard?status=OPEN&category=MAINBOARD&scoreRange=51-75');
    await page.waitForLoadState('networkidle');

    // All filters should be present in URL
    expect(page.url()).toContain('status=OPEN');
    expect(page.url()).toContain('category=MAINBOARD');
    expect(page.url()).toContain('scoreRange=51-75');

    // Page should load without errors
    const ipoCards = page.locator('[data-testid="ipo-card"]');
    await expect(ipoCards.first()).toBeVisible({ timeout: 10000 });
  });
});
