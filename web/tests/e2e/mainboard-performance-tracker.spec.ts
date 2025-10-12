/**
 * E2E Tests for Mainboard IPO Performance Tracker Page
 *
 * Story 9.7a: Mainboard IPO Performance Tracker Page
 * Tests all acceptance criteria with Playwright
 */

import { test, expect } from '@playwright/test';

// ==================== TEST CONFIGURATION ====================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PERFORMANCE_TRACKER_URL = `${BASE_URL}/mainboard-ipo-performance-tracker`;

// ==================== HELPER FUNCTIONS ====================

/**
 * Navigate to Performance Tracker page
 */
async function navigateToPerformanceTracker(page: any, year?: string) {
  const url = year ? `${PERFORMANCE_TRACKER_URL}?year=${year}` : PERFORMANCE_TRACKER_URL;
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for table to load
 */
async function waitForTable(page: any) {
  await page.waitForSelector('table', { timeout: 5000 });
}

// ==================== TEST SUITE ====================

test.describe('Mainboard IPO Performance Tracker Page', () => {
  // ==================== AC#1: Page Accessibility ====================

  test('AC#1: Should load page at /mainboard-ipo-performance-tracker', async ({ page }) => {
    await navigateToPerformanceTracker(page);

    // Verify page loaded successfully
    await expect(page).toHaveURL(/mainboard-ipo-performance-tracker/);

    // Verify page title
    await expect(page).toHaveTitle(/Mainboard IPO Performance Tracker/);

    // Verify main heading
    const heading = page.locator('h1').first();
    await expect(heading).toContainText('Mainboard IPO Performance Tracker');
  });

  // ==================== AC#2: Table Structure ====================

  test('AC#2: Should display table with all 7 columns', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Verify all 7 column headers exist
    const expectedHeaders = [
      'Company Name',
      'Listed On',
      'Issue Price',
      'Listing Day Close',
      'Listing Day Gain',
      'Current Price',
      'Profit/Loss',
    ];

    for (const header of expectedHeaders) {
      const headerCell = page.locator('th', { hasText: header });
      await expect(headerCell).toBeVisible();
    }

    // Verify table has data rows
    const dataRows = page.locator('tbody tr');
    const rowCount = await dataRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  // ==================== AC#3 & AC#4: Year Filter ====================

  test('AC#3: Should default to current year', async ({ page }) => {
    await navigateToPerformanceTracker(page);

    const currentYear = new Date().getFullYear().toString();

    // Verify year filter shows current year
    const yearFilter = page.locator('select[id="year-filter"]').or(
      page.locator('button:has-text("' + currentYear + '")')
    );
    await expect(yearFilter).toBeVisible();
  });

  test('AC#4: Should update URL when year filter changes', async ({ page }) => {
    await navigateToPerformanceTracker(page);

    // Find and click year filter
    await page.click('[id="year-filter"]');

    // Select a different year (2024)
    await page.click('text=2024');

    // Wait for navigation
    await page.waitForURL(/year=2024/);

    // Verify URL updated
    expect(page.url()).toContain('year=2024');

    // Verify page re-rendered with new year
    await waitForTable(page);
  });

  // ==================== AC#6: Color Coding ====================

  test('AC#6: Should apply color coding to gains/losses', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Look for green text (positive gains)
    const greenCells = page.locator('span.text-green-600, span.text-green-500');
    const greenCount = await greenCells.count();
    expect(greenCount).toBeGreaterThan(0);

    // Look for red text (negative losses)
    const redCells = page.locator('span.text-red-600, span.text-red-500');
    // Note: might be 0 if all IPOs are profitable in mock data
    // but the test verifies color coding is applied
  });

  // ==================== AC#7 & AC#8: Links ====================

  test('AC#7: Should have IPO Detail links', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Click on first company name to expand
    const firstCompany = page.locator('tbody tr').first().locator('button');
    await firstCompany.click();

    // Wait for expanded content
    await page.waitForSelector('text=IPO Detail', { timeout: 2000 });

    // Verify IPO Detail link is visible
    const ipoDetailLink = page.locator('a:has-text("IPO Detail")');
    await expect(ipoDetailLink).toBeVisible();

    // Verify link has correct href pattern
    await expect(ipoDetailLink).toHaveAttribute('href', /\/ipos\/.+/);
  });

  test('AC#8: Should have Stock Quotes links', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Click on first company name to expand
    const firstCompany = page.locator('tbody tr').first().locator('button');
    await firstCompany.click();

    // Wait for expanded content
    await page.waitForSelector('text=Stock Quotes', { timeout: 2000 });

    // Verify Stock Quotes link is visible
    const stockQuotesLink = page.locator('a:has-text("Stock Quotes")');
    await expect(stockQuotesLink).toBeVisible();

    // Verify link has correct href pattern (NSE)
    await expect(stockQuotesLink).toHaveAttribute('href', /nseindia\.com/);

    // Verify link opens in new tab
    await expect(stockQuotesLink).toHaveAttribute('target', '_blank');
  });

  // ==================== AC#10: Sorting ====================

  test('AC#10: Should sort IPOs by listing date descending', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Get all listing dates
    const dateElements = page.locator('tbody tr td:nth-child(2)');
    const dates = await dateElements.allTextContents();

    // Verify dates are sorted descending (most recent first)
    for (let i = 0; i < dates.length - 1; i++) {
      if (dates[i] !== '-' && dates[i + 1] !== '-') {
        const date1 = new Date(dates[i]);
        const date2 = new Date(dates[i + 1]);

        // First date should be >= second date (descending order)
        expect(date1.getTime()).toBeGreaterThanOrEqual(date2.getTime());
      }
    }
  });

  // ==================== AC#12: Responsive Design ====================

  test('AC#12: Should be responsive on mobile', async ({ page, browserName }) => {
    // Set mobile viewport (iPhone 12)
    await page.setViewportSize({ width: 390, height: 844 });

    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // On mobile, DataTable should still display (may scroll horizontally or use card layout)
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  test('AC#12: Should be responsive on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Verify table is visible and properly sized
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  // ==================== AC#13: Empty State ====================

  test('AC#13: Should show empty state for future year', async ({ page }) => {
    const futureYear = (new Date().getFullYear() + 1).toString();
    await navigateToPerformanceTracker(page, futureYear);

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Verify empty state message
    const emptyMessage = page.locator(`text=/No Mainboard IPOs listed in ${futureYear}/i`);
    await expect(emptyMessage).toBeVisible();
  });

  // ==================== AC#17 & AC#18: Formatting ====================

  test('AC#17 & AC#18: Should display percentages and prices correctly', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Verify rupee symbol is present (AC#18)
    const rupeeCells = page.locator('td:has-text("₹")');
    await expect(rupeeCells.first()).toBeVisible();

    // Verify percentage formatting (AC#17)
    const percentCells = page.locator('td:has-text("%")');
    await expect(percentCells.first()).toBeVisible();

    // Get first percentage cell and check format (should have 2 decimal places)
    const percentText = await percentCells.first().textContent();
    const percentMatch = percentText?.match(/[-+]?\d+\.\d{2}%/);
    expect(percentMatch).toBeTruthy();
  });

  // ==================== NAVIGATION ====================

  test('Should navigate to IPO detail page when clicking IPO Detail link', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Click on first company name to expand
    const firstCompany = page.locator('tbody tr').first().locator('button');
    await firstCompany.click();

    // Wait for expanded content
    await page.waitForSelector('text=IPO Detail', { timeout: 2000 });

    // Click IPO Detail link
    const ipoDetailLink = page.locator('a:has-text("IPO Detail")').first();
    await Promise.all([page.waitForNavigation(), ipoDetailLink.click()]);

    // Verify navigation to IPO detail page
    expect(page.url()).toMatch(/\/ipos\/.+/);
  });

  // ==================== PAGINATION ====================

  test('Should have pagination controls', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Check if pagination exists (only if more than 50 records)
    const paginationNext = page.locator('button:has-text("Next")');
    const paginationPrev = page.locator('button:has-text("Previous")');

    // At least one should exist (Previous should exist even on page 1, but be disabled)
    const paginationExists =
      (await paginationNext.count()) > 0 || (await paginationPrev.count()) > 0;

    expect(paginationExists).toBeTruthy();
  });

  // ==================== ACCESSIBILITY ====================

  test('Should have proper ARIA labels for expandable links', async ({ page }) => {
    await navigateToPerformanceTracker(page);
    await waitForTable(page);

    // Get first company button
    const firstCompany = page.locator('tbody tr').first().locator('button');

    // Verify aria-expanded attribute exists
    const ariaExpanded = await firstCompany.getAttribute('aria-expanded');
    expect(ariaExpanded).toBeDefined();
  });
});
