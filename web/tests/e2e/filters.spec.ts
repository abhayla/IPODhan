import { test, expect } from '@playwright/test';

test.describe('Filter Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/dashboard');
  });

  test('should display all filter controls', async ({ page }) => {
    // Check for filter bar presence
    await expect(page.getByLabel('IPO Filters')).toBeVisible();

    // Check for individual filter controls (desktop view)
    await page.setViewportSize({ width: 1920, height: 1080 });

    await expect(page.getByLabel('Filter by status')).toBeVisible();
    await expect(page.getByLabel('Filter by category')).toBeVisible();
    await expect(page.getByLabel('Filter by sector')).toBeVisible();
    await expect(page.getByLabel('Clear all filters')).toBeVisible();
  });

  test('should filter IPOs by status', async ({ page }) => {
    // Wait for filters to load
    await page.waitForSelector('[aria-label="Filter by status"]');

    // Click status filter
    await page.click('[aria-label="Filter by status"]');

    // Select UPCOMING status
    await page.click('text=Upcoming');

    // Wait for URL to update
    await expect(page).toHaveURL(/status=UPCOMING/);

    // Verify page reloaded with new filter
    await expect(page).toHaveURL(/page=1/);
  });

  test('should filter IPOs by category', async ({ page }) => {
    // Wait for filters to load
    await page.waitForSelector('[aria-label="Filter by category"]');

    // Click category filter
    await page.click('[aria-label="Filter by category"]');

    // Select SME category
    await page.click('text=SME');

    // Wait for URL to update
    await expect(page).toHaveURL(/category=SME/);

    // Verify pagination reset
    await expect(page).toHaveURL(/page=1/);
  });

  test('should filter IPOs by sector', async ({ page }) => {
    // Wait for filters to load
    await page.waitForSelector('[aria-label="Filter by sector"]');

    // Wait for sectors to load (they're fetched from API)
    await page.waitForTimeout(1000);

    // Click sector filter
    await page.click('[aria-label="Filter by sector"]');

    // Select first available sector (after "All Sectors")
    const sectorOptions = await page.locator('[role="option"]').all();

    if (sectorOptions.length > 1) {
      // Click the second option (first sector, not "All Sectors")
      await sectorOptions[1].click();

      // Wait for URL to update
      await expect(page).toHaveURL(/sector=/);

      // Verify pagination reset
      await expect(page).toHaveURL(/page=1/);
    }
  });

  test('should apply multiple filters simultaneously', async ({ page }) => {
    // Apply status filter
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Open');
    await page.waitForTimeout(500);

    // Apply category filter
    await page.click('[aria-label="Filter by category"]');
    await page.click('text=Mainboard');
    await page.waitForTimeout(500);

    // Verify both filters in URL
    await expect(page).toHaveURL(/status=OPEN/);
    await expect(page).toHaveURL(/category=MAINBOARD/);
  });

  test('should clear all filters', async ({ page }) => {
    // Apply some filters first
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Upcoming');
    await page.waitForTimeout(500);

    await page.click('[aria-label="Filter by category"]');
    await page.click('text=SME');
    await page.waitForTimeout(500);

    // Verify filters are applied
    await expect(page).toHaveURL(/status=UPCOMING/);
    await expect(page).toHaveURL(/category=SME/);

    // Click clear filters button
    await page.click('[aria-label="Clear all filters"]');

    // Verify filters are reset to defaults
    await expect(page).toHaveURL(/status=OPEN/);
    await expect(page).not.toHaveURL(/category=/);
    await expect(page).not.toHaveURL(/sector=/);
    await expect(page).toHaveURL(/page=1/);
  });

  test('should persist filter state in URL', async ({ page }) => {
    // Apply filters
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Upcoming');
    await page.waitForTimeout(500);

    // Verify URL contains filter
    await expect(page).toHaveURL(/status=UPCOMING/);

    // Reload page
    await page.reload();

    // Verify filter persisted after reload
    await expect(page).toHaveURL(/status=UPCOMING/);
  });

  test('should allow bookmarking filtered URL', async ({ page }) => {
    // Apply filters
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Upcoming');
    await page.waitForTimeout(500);

    await page.click('[aria-label="Filter by category"]');
    await page.click('text=SME');
    await page.waitForTimeout(500);

    // Get current URL
    const filteredURL = page.url();

    // Navigate away
    await page.goto('/');

    // Navigate back to filtered URL
    await page.goto(filteredURL);

    // Verify filters are still applied
    await expect(page).toHaveURL(/status=UPCOMING/);
    await expect(page).toHaveURL(/category=SME/);
  });

  test('should work with pagination', async ({ page }) => {
    // Apply filter
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Open');
    await page.waitForTimeout(500);

    // Check if pagination exists
    const pagination = page.locator('[data-testid="pagination"]');
    const hasPagination = await pagination.count() > 0;

    if (hasPagination) {
      const nextButton = page.getByLabel('Next page');
      const isNextEnabled = !(await nextButton.isDisabled());

      if (isNextEnabled) {
        // Go to next page
        await nextButton.click();

        // Verify filter persists across pagination
        await expect(page).toHaveURL(/status=OPEN/);
        await expect(page).toHaveURL(/page=2/);
      }
    }
  });

  test('should reset pagination when filters change', async ({ page }) => {
    // Go to page 2 first (if possible)
    const pagination = page.locator('[data-testid="pagination"]');
    const hasPagination = await pagination.count() > 0;

    if (hasPagination) {
      const nextButton = page.getByLabel('Next page');
      const isNextEnabled = !(await nextButton.isDisabled());

      if (isNextEnabled) {
        await nextButton.click();
        await expect(page).toHaveURL(/page=2/);

        // Now change filter
        await page.click('[aria-label="Filter by category"]');
        await page.click('text=SME');

        // Verify pagination reset to page 1
        await expect(page).toHaveURL(/page=1/);
      }
    }
  });

  test('should display collapsible filters on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Reload to apply mobile layout
    await page.reload();

    // Check for filter toggle button
    const toggleButton = page.getByLabel('Toggle filters');
    await expect(toggleButton).toBeVisible();

    // Filters should be hidden initially
    const filterBar = page.locator('[data-testid="filter-bar"]');
    await expect(filterBar).not.toBeVisible();

    // Click toggle to open filters
    await toggleButton.click();

    // Filters should now be visible
    await expect(filterBar).toBeVisible();
  });

  test('should display active filter count on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Apply filter
    await page.click('[aria-label="Toggle filters"]');
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Upcoming');
    await page.waitForTimeout(500);

    // Check for filter count badge
    await expect(page.getByText(/Filters \(1\)/)).toBeVisible();
  });

  test('should always show filters on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Reload to apply desktop layout
    await page.reload();

    // Filters should be visible without toggle
    const filterBar = page.locator('[data-testid="filter-bar"]');
    await expect(filterBar).toBeVisible();

    // Toggle button should not be visible
    const toggleButton = page.getByLabel('Toggle filters');
    await expect(toggleButton).not.toBeVisible();
  });

  test('should disable clear button when filters are at defaults', async ({ page }) => {
    // Navigate with default filters
    await page.goto('/dashboard?status=OPEN');

    // Clear button should be disabled
    const clearButton = page.getByLabel('Clear all filters');
    await expect(clearButton).toBeDisabled();
  });

  test('should enable clear button when filters are not at defaults', async ({ page }) => {
    // Apply non-default filter
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Upcoming');
    await page.waitForTimeout(500);

    // Clear button should be enabled
    const clearButton = page.getByLabel('Clear all filters');
    await expect(clearButton).not.toBeDisabled();
  });

  test('should handle empty results gracefully', async ({ page }) => {
    // Apply filters that might return no results
    await page.goto('/dashboard?status=CLOSED&category=RIGHTS&sector=NonExistentSector');

    // Page should still render without errors
    await expect(page.locator('h1')).toContainText('IPO Dashboard');

    // Check for empty state or "0 IPOs found"
    await expect(page.getByText(/0 IPOs found/i)).toBeVisible();
  });

  test('should fetch sectors from API', async ({ page }) => {
    // Wait for sector filter to load
    await page.waitForSelector('[aria-label="Filter by sector"]');

    // Wait for loading to complete
    await page.waitForTimeout(1000);

    // Click sector filter
    await page.click('[aria-label="Filter by sector"]');

    // Should show "All Sectors" option
    await expect(page.getByText('All Sectors')).toBeVisible();

    // Should show at least one sector (if data exists)
    const sectorOptions = await page.locator('[role="option"]').count();
    expect(sectorOptions).toBeGreaterThanOrEqual(1); // At least "All Sectors"
  });

  test('should have keyboard accessibility', async ({ page }) => {
    // Focus on status filter using Tab
    await page.keyboard.press('Tab');

    // Check if status filter is focused
    const statusFilter = page.getByLabel('Filter by status');
    await expect(statusFilter).toBeFocused();

    // Open dropdown with Enter
    await page.keyboard.press('Enter');

    // Navigate with arrow keys
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    // Select with Enter
    await page.keyboard.press('Enter');

    // Verify selection was made
    await expect(page).toHaveURL(/status=/);
  });

  test('should preserve view preference when filters change', async ({ page }) => {
    // Switch to list view
    await page.click('button[aria-label="List view"]');
    await expect(page).toHaveURL(/view=list/);

    // Apply filter
    await page.click('[aria-label="Filter by status"]');
    await page.click('text=Upcoming');
    await page.waitForTimeout(500);

    // Verify view preference is preserved
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(/status=UPCOMING/);
  });
});
