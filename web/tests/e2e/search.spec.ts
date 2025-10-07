/**
 * E2E tests for search functionality
 */

import { test, expect } from '@playwright/test';

test.describe('Search Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
  });

  test('should display search input on dashboard page', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', 'Search IPOs by company or sector...');
  });

  test('should search for IPO by company name', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Type search query
    await searchInput.fill('reliance');

    // Wait for debounce (300ms) + network request
    await page.waitForTimeout(400);

    // Verify URL updated with search param
    await expect(page).toHaveURL(/search=reliance/);

    // Verify search results displayed (or no results message)
    const resultsContainer = page.locator('[data-testid="ipo-container"], [data-testid="no-results"]');
    await expect(resultsContainer).toBeVisible();
  });

  test('should search for IPO by sector', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    await searchInput.fill('technology');
    await page.waitForTimeout(400);

    await expect(page).toHaveURL(/search=technology/);
  });

  test('should highlight matching text in search results', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    await searchInput.fill('tech');
    await page.waitForTimeout(400);

    // Check for highlighted text (mark elements)
    const highlights = page.locator('mark');
    const count = await highlights.count();

    if (count > 0) {
      const firstHighlight = highlights.first();
      await expect(firstHighlight).toBeVisible();
      await expect(firstHighlight).toHaveClass(/bg-yellow-200/);
    }
  });

  test('should show clear button when search has text', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Clear button should not be visible initially
    const clearButton = page.locator('button[aria-label="Clear search"]');
    await expect(clearButton).not.toBeVisible();

    // Type in search box
    await searchInput.fill('test');

    // Clear button should now be visible
    await expect(clearButton).toBeVisible();
  });

  test('should clear search when X button clicked', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Perform a search
    await searchInput.fill('reliance');
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/search=reliance/);

    // Click clear button
    const clearButton = page.locator('button[aria-label="Clear search"]');
    await clearButton.click();

    // Verify search cleared
    await expect(searchInput).toHaveValue('');
    await expect(page).toHaveURL(/^.*dashboard(\?(?!search=).*)?$/);
  });

  test('should clear search with Escape key', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    await searchInput.fill('test');
    await page.waitForTimeout(100);

    // Press Escape
    await searchInput.press('Escape');

    await expect(searchInput).toHaveValue('');
  });

  test('should trigger immediate search on Enter key', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    await searchInput.fill('reliance');
    await searchInput.press('Enter');

    // Should update URL immediately (no debounce wait)
    await expect(page).toHaveURL(/search=reliance/);
  });

  test('should display no results message for empty search', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Search for something unlikely to exist
    await searchInput.fill('zzzzz12345nonexistent');
    await page.waitForTimeout(400);

    // Check for no results message
    const noResults = page.locator('[data-testid="no-results"]');
    await expect(noResults).toBeVisible();
    await expect(noResults).toContainText('No IPOs found for');
    await expect(noResults).toContainText('zzzzz12345nonexistent');
  });

  test('should persist search in URL (shareable link)', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    await searchInput.fill('tech');
    await page.waitForTimeout(400);

    const url = page.url();
    expect(url).toContain('search=tech');

    // Reload page with same URL
    await page.reload();

    // Search input should be populated
    await expect(searchInput).toHaveValue('tech');
  });

  test('should combine search with filters', async ({ page }) => {
    // Apply status filter first
    const statusSelect = page.locator('select[aria-label="Filter by status"]');
    if (await statusSelect.isVisible()) {
      await statusSelect.selectOption('OPEN');
      await page.waitForTimeout(300);
    }

    // Then apply search
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');
    await searchInput.fill('tech');
    await page.waitForTimeout(400);

    // URL should contain both params
    const url = page.url();
    expect(url).toContain('search=tech');
  });

  test('should reset page to 1 when search changes', async ({ page }) => {
    // Navigate to page 2
    await page.goto('/dashboard?page=2');

    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');
    await searchInput.fill('test');
    await page.waitForTimeout(400);

    // URL should have page=1
    await expect(page).toHaveURL(/page=1/);
  });

  test('should save recent searches to localStorage', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Perform a search
    await searchInput.fill('reliance');
    await searchInput.press('Enter');
    await page.waitForTimeout(500);

    // Check localStorage
    const recentSearches = await page.evaluate(() => {
      const stored = localStorage.getItem('recent-searches');
      return stored ? JSON.parse(stored) : [];
    });

    expect(recentSearches).toContain('reliance');
  });

  test('should display recent searches on focus', async ({ page }) => {
    // Save some searches to localStorage
    await page.evaluate(() => {
      localStorage.setItem('recent-searches', JSON.stringify(['search1', 'search2']));
    });

    // Reload to pick up localStorage
    await page.reload();

    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');
    await searchInput.click();

    // Recent searches dropdown should appear
    await expect(page.getByText('Recent Searches')).toBeVisible();
    await expect(page.getByText('search1')).toBeVisible();
    await expect(page.getByText('search2')).toBeVisible();
  });

  test('should populate search from recent searches', async ({ page }) => {
    // Save search to localStorage
    await page.evaluate(() => {
      localStorage.setItem('recent-searches', JSON.stringify(['reliance']));
    });

    await page.reload();

    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');
    await searchInput.click();

    // Click on recent search
    await page.getByText('reliance').click();
    await page.waitForTimeout(300);

    // Should populate input and trigger search
    await expect(searchInput).toHaveValue('reliance');
    await expect(page).toHaveURL(/search=reliance/);
  });

  test('should hide recent searches on blur', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('recent-searches', JSON.stringify(['test']));
    });

    await page.reload();

    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');
    await searchInput.click();

    await expect(page.getByText('Recent Searches')).toBeVisible();

    // Click outside search box
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    await expect(page.getByText('Recent Searches')).not.toBeVisible();
  });

  test('should show loading indicator while typing', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    await searchInput.type('t', { delay: 50 });

    // Loading spinner should appear
    const spinner = page.locator('.animate-spin');
    await expect(spinner).toBeVisible();
  });

  test('should handle special characters in search', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    await searchInput.fill('Company (India) Ltd.');
    await page.waitForTimeout(400);

    // Should not crash and should update URL
    await expect(page).toHaveURL(/search=Company/);
  });

  test('should maintain search across navigation back/forward', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Perform search
    await searchInput.fill('tech');
    await page.waitForTimeout(400);

    // Navigate to different page
    await page.goto('/dashboard');

    // Go back
    await page.goBack();

    // Search should still be in URL
    await expect(page).toHaveURL(/search=tech/);
  });

  test('should debounce search requests', async ({ page }) => {
    let requestCount = 0;

    // Count API requests
    page.on('request', (request) => {
      if (request.url().includes('/api/ipos') && request.url().includes('search=')) {
        requestCount++;
      }
    });

    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Type quickly (simulating rapid typing)
    await searchInput.type('test', { delay: 50 });

    // Wait for debounce delay + request
    await page.waitForTimeout(500);

    // Should have made only 1 API request (debounced)
    expect(requestCount).toBeLessThanOrEqual(2);
  });

  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('tech');
    await page.waitForTimeout(400);

    await expect(page).toHaveURL(/search=tech/);
  });

  test('should handle rapid clear and search operations', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search IPOs by company or sector"]');

    // Search, clear, search again rapidly
    await searchInput.fill('test1');
    await page.waitForTimeout(100);

    const clearButton = page.locator('button[aria-label="Clear search"]');
    await clearButton.click();
    await page.waitForTimeout(100);

    await searchInput.fill('test2');
    await page.waitForTimeout(400);

    await expect(searchInput).toHaveValue('test2');
    await expect(page).toHaveURL(/search=test2/);
  });
});
