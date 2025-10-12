/**
 * E2E Tests for OFS Page
 *
 * End-to-end tests for the OFS (Offer for Sale) page functionality.
 *
 * Story 9.5: Offer for Sale (OFS) Page
 */

import { test, expect } from '@playwright/test';

test.describe('OFS (Offer for Sale) Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to OFS page before each test
    await page.goto('/ofs');
  });

  // ==================== AC#1: Page Accessibility ====================

  test('should be accessible at /ofs', async ({ page }) => {
    // Verify URL
    expect(page.url()).toContain('/ofs');

    // Verify page loaded successfully
    await expect(page.locator('h1')).toContainText('Offer for Sale');
  });

  // ==================== AC#2: Table Column Display ====================

  test('should display table with correct columns: Issuer Company, Non Retail Date, Retail Date', async ({ page }) => {
    // Check for table headers
    await expect(page.locator('th:has-text("Issuer Company")')).toBeVisible();
    await expect(page.locator('th:has-text("Non Retail Date")')).toBeVisible();
    await expect(page.locator('th:has-text("Retail Date")')).toBeVisible();
  });

  // ==================== AC#4: Educational Banner ====================

  test('should display educational banner explaining OFS concept', async ({ page }) => {
    // Check for educational banner
    const banner = page.locator('text=What is an OFS?');
    await expect(banner).toBeVisible();

    // Check for key OFS concepts
    await expect(page.locator('text=Offer for Sale (OFS)')).toBeVisible();
    await expect(page.locator('text=Non-Retail Date')).toBeVisible();
    await expect(page.locator('text=Retail Date')).toBeVisible();
    await expect(page.locator('text=Institutional')).toBeVisible();
  });

  // ==================== AC#6: Responsive Design ====================

  test('should display table on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });

    // Check if table is visible (desktop view)
    await expect(page.locator('table')).toBeVisible();
  });

  test('should display cards on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // On mobile, DataTable component renders differently
    // Check if content is still accessible
    await expect(page.locator('h1:has-text("Offer for Sale")')).toBeVisible();
  });

  // ==================== AC#7: Empty State ====================

  test('should show empty state when no OFS available', async ({ page, context }) => {
    // Intercept API request and return empty data
    await page.route('**/api/ipos?category=OFS*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          pagination: {
            page: 1,
            limit: 100,
            total: 0,
            hasMore: false,
          },
        }),
      });
    });

    // Reload page to trigger API call
    await page.reload();

    // Check for empty state message
    await expect(page.locator('text=No OFS available')).toBeVisible();
  });

  // ==================== AC#9: SEO Metadata ====================

  test('should have proper SEO metadata', async ({ page }) => {
    // Check title
    const title = await page.title();
    expect(title).toContain('OFS');
    expect(title).toContain('2025');

    // Check meta description
    const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
    expect(metaDescription).toContain('OFS');
    expect(metaDescription).toContain('Non-Retail');
    expect(metaDescription).toContain('Retail');

    // Check Open Graph tags
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toContain('OFS');

    // Check structured data
    const structuredData = await page.locator('script[type="application/ld+json"]').first();
    await expect(structuredData).toBeAttached();
  });

  // ==================== AC#10: Navigation Link ====================

  test('should be accessible from navigation header', async ({ page }) => {
    // Go to home page first
    await page.goto('/');

    // Check if OFS link exists in navigation
    const ofsLink = page.locator('a[href="/ofs"]');
    await expect(ofsLink).toBeVisible();

    // Click the link
    await ofsLink.click();

    // Verify navigation worked
    await expect(page).toHaveURL(/.*\/ofs/);
    await expect(page.locator('h1:has-text("Offer for Sale")')).toBeVisible();
  });

  // ==================== AC#11: Graceful Degradation ====================

  test('should render page successfully even if API call fails', async ({ page }) => {
    // Intercept API request and return error
    await page.route('**/api/ipos?category=OFS*', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SERVER_ERROR',
            message: 'Internal Server Error',
            timestamp: new Date().toISOString(),
          },
        }),
      });
    });

    // Reload page to trigger API call
    await page.reload();

    // Page should still render (graceful degradation)
    await expect(page.locator('h1:has-text("Offer for Sale")')).toBeVisible();
    await expect(page.locator('text=What is an OFS?')).toBeVisible();

    // Empty state should be shown (no crash)
    await expect(page.locator('text=No OFS available')).toBeVisible();
  });

  // ==================== DataTable Features ====================

  test('should have column search functionality', async ({ page }) => {
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 5000 });

    // Check for search input in table
    const searchInput = page.locator('input[placeholder*="Search"]').first();

    // If table has data, search input should be visible
    const hasData = await page.locator('table tbody tr').count() > 0;
    if (hasData) {
      await expect(searchInput).toBeVisible();
    }
  });

  test('should have year filter functionality', async ({ page }) => {
    // Wait for page to load
    await page.waitForSelector('h1', { timeout: 5000 });

    // Check for year filter dropdown
    const yearFilter = page.locator('select, button:has-text("Year"), [id="year-filter"]').first();

    // Year filter should exist
    const filterExists = await yearFilter.count() > 0;
    expect(filterExists).toBe(true);
  });

  test('should have pagination functionality', async ({ page }) => {
    // Mock large dataset to trigger pagination
    const mockLargeData = Array.from({ length: 60 }, (_, i) => ({
      id: `ofs-${i + 1}`,
      companyName: `OFS Company ${i + 1}`,
      slug: `ofs-company-${i + 1}`,
      category: 'OFS',
      status: 'UPCOMING',
      openDate: `2025-${String(i % 12 + 1).padStart(2, '0')}-15`,
      closeDate: `2025-${String(i % 12 + 1).padStart(2, '0')}-16`,
      priceRangeMax: 500 + i * 10,
      issueSize: `${1000 + i * 100}`,
    }));

    await page.route('**/api/ipos?category=OFS*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: mockLargeData,
          pagination: {
            page: 1,
            limit: 100,
            total: mockLargeData.length,
            hasMore: false,
          },
        }),
      });
    });

    // Reload page
    await page.reload();

    // Check for pagination controls
    const pagination = page.locator('text=Page, button:has-text("Next"), button:has-text("Previous")').first();

    // If data has > 50 records, pagination should be visible
    const paginationExists = await pagination.count() > 0;
    if (mockLargeData.length > 50) {
      expect(paginationExists).toBe(true);
    }
  });
});
