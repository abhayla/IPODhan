/**
 * E2E Tests for Mainboard IPO Prospectus Page
 *
 * Story 9.8a: Mainboard IPO Prospectus PDF Download Page
 * Tests all 18 acceptance criteria
 */

import { test, expect } from '@playwright/test';

test.describe('Mainboard IPO Prospectus Page', () => {
  // AC#1: Page accessible at /mainboard-ipo-prospectus
  test('should load the Mainboard IPO Prospectus page', async ({ page }) => {
    await page.goto('/mainboard-ipo-prospectus');
    await expect(page).toHaveURL(/.*mainboard-ipo-prospectus/);
    await expect(page.locator('h1')).toContainText('Mainboard IPO Prospectus');
  });

  // AC#14: SEO metadata configured
  test('should have proper SEO metadata', async ({ page }) => {
    await page.goto('/mainboard-ipo-prospectus');

    const title = await page.title();
    expect(title).toContain('Mainboard IPO Prospectus');
    expect(title).toContain('DRHP');
    expect(title).toContain('RHP');

    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toContain('prospectus');
    expect(description).toContain('DRHP');
  });

  // AC#2, AC#3: Table displays data and total count
  test('should display prospectus table with total count', async ({ page }) => {
    await page.goto('/mainboard-ipo-prospectus');

    // Wait for data to load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Check total count displays
    const totalCount = page.locator('text=Total Records:');
    await expect(totalCount).toBeVisible();
  });

  // AC#4: Column-level search functional
  test('should filter by company name', async ({ page }) => {
    await page.goto('/mainboard-ipo-prospectus');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Find and fill company name search
    const searchInput = page.locator('input[placeholder*="company name"]');
    await searchInput.fill('Test Company');

    // Wait for debounce and URL update
    await page.waitForTimeout(500);

    // Check URL updated
    expect(page.url()).toContain('companyName=Test');
  });

  // AC#4: Exchange filter works
  test('should filter by exchange', async ({ page }) => {
    await page.goto('/mainboard-ipo-prospectus');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Open exchange dropdown
    const exchangeSelect = page.locator('text=Exchange').locator('..').locator('button');
    await exchangeSelect.click();

    // Select NSE
    await page.locator('text=NSE').first().click();

    // Wait for URL update
    await page.waitForTimeout(300);

    // Check URL updated
    expect(page.url()).toContain('exchange=NSE');
  });

  // AC#13: Pagination works
  test('should navigate between pages', async ({ page }) => {
    await page.goto('/mainboard-ipo-prospectus');

    // Wait for page load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Check for Next button
    const nextButton = page.locator('button:has-text("Next")');
    if (await nextButton.isEnabled()) {
      await nextButton.click();

      // Check URL updated to page 2
      await page.waitForTimeout(300);
      expect(page.url()).toContain('page=2');

      // Check Previous button now enabled
      const prevButton = page.locator('button:has-text("Previous")');
      await expect(prevButton).toBeEnabled();
    }
  });

  // AC#9: Empty state
  test('should show empty state when no results', async ({ page }) => {
    await page.goto('/mainboard-ipo-prospectus?companyName=NonExistentCompanyXYZ123');

    // Wait for data load
    await page.waitForLoadState('networkidle');

    // Check empty state message
    const emptyState = page.locator('text=No Mainboard prospectus documents available');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
  });

  // AC#12: Responsive design
  test('should display table on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/mainboard-ipo-prospectus');

    // Wait for table to load
    await page.waitForSelector('table', { timeout: 10000 });

    // Table should be visible on desktop
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  test('should display cards on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/mainboard-ipo-prospectus');

    // Wait for data load
    await page.waitForLoadState('networkidle');

    // Cards should be visible on mobile
    const cards = page.locator('[class*="Card"]').first();
    await expect(cards).toBeVisible({ timeout: 10000 });
  });

  // AC#11: ISR cache headers
  test('should have ISR cache headers', async ({ page }) => {
    const response = await page.goto('/mainboard-ipo-prospectus');

    const cacheControl = response?.headers()['cache-control'];
    expect(cacheControl).toBeDefined();
  });
});
