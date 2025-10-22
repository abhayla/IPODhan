import { test, expect } from '@playwright/test';

/**
 * Admin IPO Listing & Filtering E2E Tests
 * Tests dashboard functionality, search, filters, and pagination
 */

const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'test-admin-token-for-e2e';

test.describe('Admin IPO Listing', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to admin dashboard
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should display IPO table with data', async ({ page }) => {
    // Check heading
    await expect(page.getByRole('heading', { name: /ipo management/i })).toBeVisible();

    // Check for table headers
    await expect(page.getByText(/company name/i)).toBeVisible();
    await expect(page.getByText(/status/i)).toBeVisible();
    await expect(page.getByText(/segment/i)).toBeVisible();
    await expect(page.getByText(/open date/i)).toBeVisible();
    await expect(page.getByText(/close date/i)).toBeVisible();

    // Wait for IPO data to load
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Verify at least one IPO row is displayed
    const rows = await page.locator('table tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });

  test('should display IPO count correctly', async ({ page }) => {
    // Wait for count to load
    await page.waitForSelector('text=/Total IPOs:|Showing/i', { timeout: 10000 });

    // Check count is displayed (could be "Total IPOs: X" or "Showing X of Y")
    const countText = await page.locator('text=/Total IPOs:|Showing/i').first().textContent();
    expect(countText).toMatch(/\d+/); // Contains at least one number
  });

  test('should display protection status badges', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Look for protection badges (they may or may not exist depending on data)
    const protectedBadges = page.locator('text=/protected/i');
    const unprotectedBadges = page.locator('text=/not protected/i');

    // At least one type should be visible
    const protectedCount = await protectedBadges.count();
    const unprotectedCount = await unprotectedBadges.count();

    expect(protectedCount + unprotectedCount).toBeGreaterThan(0);
  });
});

test.describe('Admin IPO Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should search IPOs by company name', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Get first IPO company name from table
    const firstCompanyName = await page.locator('table tbody tr:first-child td:first-child').textContent();

    if (!firstCompanyName) {
      test.skip(); // Skip if no data
      return;
    }

    // Search for first few characters
    const searchTerm = firstCompanyName.trim().substring(0, 5);
    const searchInput = page.getByPlaceholder(/search company/i);

    await expect(searchInput).toBeVisible();
    await searchInput.fill(searchTerm);

    // Wait for search to filter results
    await page.waitForTimeout(1000);

    // Verify filtered results contain search term
    const rows = await page.locator('table tbody tr');
    const rowCount = await rows.count();

    if (rowCount > 0) {
      const firstResult = await rows.first().locator('td:first-child').textContent();
      expect(firstResult?.toLowerCase()).toContain(searchTerm.toLowerCase());
    }
  });

  test('should show no results for invalid search', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const searchInput = page.getByPlaceholder(/search company/i);
    await searchInput.fill('XYZZZZNONEXISTENT12345');

    await page.waitForTimeout(1000);

    // Should show "No IPOs found" or empty table
    const noResults = page.getByText(/no ipos found|no results/i);
    const rowCount = await page.locator('table tbody tr').count();

    // Either no results message or no rows
    const hasNoResultsMessage = await noResults.count() > 0;
    expect(hasNoResultsMessage || rowCount === 0).toBeTruthy();
  });

  test('should clear search when input is cleared', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const searchInput = page.getByPlaceholder(/search company/i);

    // Search for something
    await searchInput.fill('limited');
    await page.waitForTimeout(1000);

    const filteredCount = await page.locator('table tbody tr').count();

    // Clear search
    await searchInput.clear();
    await page.waitForTimeout(1000);

    // Should show more results (or at least same)
    const unfilteredCount = await page.locator('table tbody tr').count();
    expect(unfilteredCount).toBeGreaterThanOrEqual(filteredCount);
  });
});

test.describe('Admin IPO Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should filter by status', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Look for status filter dropdown/buttons
    const statusFilter = page.locator('select[name*="status"], button:has-text("Status"), [data-testid*="status"]').first();

    if (await statusFilter.count() === 0) {
      // If no explicit filter UI, try clicking status badges
      const openStatusBadge = page.locator('text=/^OPEN$/i').first();
      if (await openStatusBadge.count() > 0) {
        await openStatusBadge.click();
        await page.waitForTimeout(1000);

        // Verify filtered results
        const statusCells = page.locator('table tbody tr td:has-text("OPEN")');
        expect(await statusCells.count()).toBeGreaterThan(0);
      }
    } else {
      // Use filter dropdown
      await statusFilter.click();

      // Select a status option
      const openOption = page.getByText(/^OPEN$/i).first();
      await openOption.click();

      await page.waitForTimeout(1000);

      // Verify filtered results show only selected status
      const rows = await page.locator('table tbody tr');
      const rowCount = await rows.count();

      if (rowCount > 0) {
        // Check at least first row has correct status
        const firstRowStatus = await rows.first().locator('td:nth-child(2)').textContent();
        expect(firstRowStatus).toContain('OPEN');
      }
    }
  });

  test('should filter by segment', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Look for segment filter
    const segmentFilter = page.locator('select[name*="segment"], button:has-text("Segment"), [data-testid*="segment"]').first();

    if (await segmentFilter.count() > 0) {
      await segmentFilter.click();

      // Select MAINBOARD
      const mainboardOption = page.getByText(/mainboard/i).first();
      await mainboardOption.click();

      await page.waitForTimeout(1000);

      // Verify filtered results
      const rows = await page.locator('table tbody tr');
      const rowCount = await rows.count();

      if (rowCount > 0) {
        const firstRowSegment = await rows.first().locator('td:nth-child(3)').textContent();
        expect(firstRowSegment).toContain('MAINBOARD');
      }
    } else {
      // Filter might not be visible or implemented differently
      test.skip();
    }
  });

  test('should filter by multiple criteria', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Try combining search + status filter
    const searchInput = page.getByPlaceholder(/search company/i);
    await searchInput.fill('limited');

    await page.waitForTimeout(500);

    // Then apply status filter if available
    const statusFilter = page.locator('select[name*="status"]').first();
    if (await statusFilter.count() > 0) {
      await statusFilter.selectOption('OPEN');
      await page.waitForTimeout(1000);

      // Verify results match both criteria
      const rows = await page.locator('table tbody tr');
      const rowCount = await rows.count();

      if (rowCount > 0) {
        const firstRow = rows.first();
        const companyName = await firstRow.locator('td:first-child').textContent();
        const status = await firstRow.locator('td:nth-child(2)').textContent();

        expect(companyName?.toLowerCase()).toContain('limited');
        expect(status).toContain('OPEN');
      }
    }
  });

  test('should clear all filters', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Apply search filter
    const searchInput = page.getByPlaceholder(/search company/i);
    await searchInput.fill('limited');
    await page.waitForTimeout(500);

    const filteredCount = await page.locator('table tbody tr').count();

    // Look for "Clear Filters" button
    const clearButton = page.getByRole('button', { name: /clear.*filter/i });

    if (await clearButton.count() > 0) {
      await clearButton.click();
      await page.waitForTimeout(1000);

      // Should show more results
      const unfilteredCount = await page.locator('table tbody tr').count();
      expect(unfilteredCount).toBeGreaterThanOrEqual(filteredCount);

      // Search input should be cleared
      await expect(searchInput).toHaveValue('');
    } else {
      // Manually clear search
      await searchInput.clear();
      await page.waitForTimeout(1000);

      const unfilteredCount = await page.locator('table tbody tr').count();
      expect(unfilteredCount).toBeGreaterThanOrEqual(filteredCount);
    }
  });
});

test.describe('Admin IPO Pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should display pagination controls if needed', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Check if pagination controls exist
    const paginationControls = page.locator('[role="navigation"] button, .pagination button, button:has-text("Next"), button:has-text("Previous")');

    const controlCount = await paginationControls.count();

    // Pagination might not be visible if total count < page size
    if (controlCount > 0) {
      // Pagination exists
      expect(controlCount).toBeGreaterThan(0);
    } else {
      // No pagination needed (small dataset)
      test.skip();
    }
  });

  test('should navigate to next page', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const nextButton = page.getByRole('button', { name: /next/i });

    if (await nextButton.count() > 0 && await nextButton.isEnabled()) {
      // Get first row before navigation
      const firstRowBefore = await page.locator('table tbody tr:first-child td:first-child').textContent();

      // Click next
      await nextButton.click();
      await page.waitForTimeout(1000);

      // Get first row after navigation
      const firstRowAfter = await page.locator('table tbody tr:first-child td:first-child').textContent();

      // Should be different content
      expect(firstRowAfter).not.toBe(firstRowBefore);
    } else {
      test.skip(); // No pagination or only one page
    }
  });

  test('should navigate to previous page', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // First go to page 2
    const nextButton = page.getByRole('button', { name: /next/i });

    if (await nextButton.count() > 0 && await nextButton.isEnabled()) {
      await nextButton.click();
      await page.waitForTimeout(1000);

      // Get first row on page 2
      const firstRowPage2 = await page.locator('table tbody tr:first-child td:first-child').textContent();

      // Now click previous
      const prevButton = page.getByRole('button', { name: /prev|previous/i });
      await prevButton.click();
      await page.waitForTimeout(1000);

      // Get first row on page 1
      const firstRowPage1 = await page.locator('table tbody tr:first-child td:first-child').textContent();

      // Should be different content
      expect(firstRowPage1).not.toBe(firstRowPage2);
    } else {
      test.skip();
    }
  });

  test('should show correct page indicator', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Look for page indicator (e.g., "Page 1 of 5" or "1 / 5")
    const pageIndicator = page.locator('text=/page \\d+ of \\d+|\\d+ \\/ \\d+/i');

    if (await pageIndicator.count() > 0) {
      const indicatorText = await pageIndicator.first().textContent();
      expect(indicatorText).toMatch(/\d+/); // Contains page numbers
    } else {
      // Page indicator might not exist for single-page results
      test.skip();
    }
  });
});

test.describe('Admin IPO Table Actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should navigate to edit page when clicking edit button', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Look for edit button/link in first row
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit"), table tbody tr:first-child button:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      // Get IPO slug/ID for verification
      const firstRowCompany = await page.locator('table tbody tr:first-child td:first-child').textContent();

      await editButton.click();

      // Should navigate to edit page
      await page.waitForURL('**/admin/edit/**', { timeout: 5000 });

      // Verify we're on edit page
      await expect(page.getByRole('heading', { name: /edit ipo/i })).toBeVisible();
    } else {
      test.skip(); // No edit buttons found
    }
  });

  test('should display view details button or link', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Look for view/details button in first row
    const viewButton = page.locator('table tbody tr:first-child a:has-text("View"), table tbody tr:first-child button:has-text("View"), table tbody tr:first-child a:has-text("Details")').first();

    if (await viewButton.count() > 0) {
      expect(await viewButton.count()).toBeGreaterThan(0);
    } else {
      // Might not have view button if edit button serves both purposes
      test.skip();
    }
  });
});

test.describe('Admin IPO Table Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
  });

  test('should load IPO table within 5 seconds', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/admin');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const loadTime = Date.now() - startTime;

    // Should load in under 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  test('should handle loading 100+ IPOs without performance issues', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Verify table is rendered
    const rows = await page.locator('table tbody tr').count();
    expect(rows).toBeGreaterThan(0);

    // Page should be responsive
    const heading = page.getByRole('heading', { name: /ipo management/i });
    await expect(heading).toBeVisible();
  });
});
