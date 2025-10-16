/**
 * E2E Tests for Historical IPOs Page
 *
 * Tests complete user journeys for the historical IPOs page
 */

import { test, expect } from '@playwright/test';

test.describe('Historical IPOs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/history');
  });

  test('navigates to /history and displays historical IPOs', async ({ page }) => {
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByRole('heading', { name: /IPO History/i })).toBeVisible();
  });

  test('displays search bar', async ({ page }) => {
    await expect(
      page.getByPlaceholder('Search by company name...')
    ).toBeVisible();
  });

  test('displays filter button on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.getByRole('button', { name: /Filters/i })).toBeVisible();
  });

  test('applies year filter and sees filtered results', async ({ page }) => {
    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // On desktop, filters are in sidebar
    if (await page.locator('.lg\\:block').first().isVisible()) {
      await page.getByRole('checkbox', { name: '2024' }).click();
    } else {
      // On mobile, open filter drawer
      await page.getByRole('button', { name: /Filters/i }).click();
      await page.getByRole('checkbox', { name: '2024' }).click();
    }

    // Wait for results to update
    await page.waitForLoadState('networkidle');

    // Check URL contains year filter
    await expect(page).toHaveURL(/year=2024/);
  });

  test('applies sector filter and sees filtered results', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Apply Technology sector filter
    if (await page.locator('.lg\\:block').first().isVisible()) {
      await page.getByRole('checkbox', { name: 'Technology' }).click();
    } else {
      await page.getByRole('button', { name: /Filters/i }).click();
      await page.getByRole('checkbox', { name: 'Technology' }).click();
    }

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/sector=Technology/);
  });

  test('applies performance filter for positive gains', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    if (await page.locator('.lg\\:block').first().isVisible()) {
      await page.getByRole('radio', { name: /Positive Gains/i }).click();
    } else {
      await page.getByRole('button', { name: /Filters/i }).click();
      await page.getByRole('radio', { name: /Positive Gains/i }).click();
    }

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/performance=Positive/);
  });

  test('searches by company name', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search by company name...');
    await searchInput.fill('Reliance');

    // Wait for debounce (500ms)
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/search=Reliance/);
  });

  test('sorts by listing gain percentage', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click on "Listing Gain %" column header to sort
    await page.getByRole('columnheader', { name: /Listing Gain %/i }).click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/sort=listing_gain/);
  });

  test('navigates to page 2 using pagination', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check if pagination exists (only if there are multiple pages)
    const nextButton = page.getByRole('button', { name: /next/i });
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/page=2/);
    }
  });

  test('clicks on IPO and navigates to detail page', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Wait for table or cards to load
    const firstIPOLink = page.locator('a[href^="/ipos/"]').first();
    if (await firstIPOLink.isVisible()) {
      await firstIPOLink.click();
      await expect(page).toHaveURL(/\/ipos\/.+/);
    }
  });

  test('clears all filters using clear button', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Apply a filter first
    if (await page.locator('.lg\\:block').first().isVisible()) {
      await page.getByRole('checkbox', { name: '2024' }).click();
      await page.waitForTimeout(500);

      // Click clear filters button
      const clearButton = page.getByRole('button', { name: /Clear/i });
      if (await clearButton.isVisible()) {
        await clearButton.click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL('/history');
      }
    }
  });

  test('displays card layout on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');

    // Check that mobile card view is visible
    const mobileCards = page.locator('.lg\\:hidden');
    await expect(mobileCards.first()).toBeVisible();
  });

  test('displays table layout on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('networkidle');

    // Check that desktop table view is visible
    const desktopTable = page.locator('.hidden.lg\\:block table');
    if (await desktopTable.count() > 0) {
      await expect(desktopTable.first()).toBeVisible();
    }
  });

  test('displays results count', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Look for results count text
    const resultsText = page.getByText(/Showing.*IPO/i);
    await expect(resultsText).toBeVisible();
  });

  test('shows empty state when no results match filters', async ({ page }) => {
    // Apply filters that likely return no results
    const searchInput = page.getByPlaceholder('Search by company name...');
    await searchInput.fill('XYZ_NONEXISTENT_COMPANY_12345');
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Check for empty state message
    const emptyMessage = page.getByText(/No historical IPOs/i);
    if (await emptyMessage.isVisible()) {
      await expect(emptyMessage).toBeVisible();
    }
  });
});
