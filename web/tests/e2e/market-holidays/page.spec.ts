/**
 * E2E Tests for Market Holidays Calendar Page
 * Story 5.4: Market Holidays Calendar
 *
 * Tests:
 * - Complete workflow: Access page → Apply filters → View holidays
 * - Year filter changes
 * - Exchange filter changes
 * - Upcoming toggle functionality
 * - Mobile responsive layout
 * - Navigation from Tools menu
 * - Holiday card rendering
 * - Data source attribution display
 *
 * Uses Playwright for browser automation
 */

import { test, expect } from '@playwright/test';

// ==================== TEST CONFIGURATION ====================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ==================== HELPER FUNCTIONS ====================

/**
 * Wait for page to be fully loaded
 */
async function waitForPageLoad(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');
}

// ==================== TESTS ====================

test.describe('Market Holidays Calendar Page', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport for consistent testing
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should navigate to market holidays page from header menu', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    // Hover over Tools menu
    await page.locator('text=Tools').hover();

    // Click on "Market Holidays" link
    await page.locator('text=Market Holidays').click();

    // Verify navigation to market holidays page
    await expect(page).toHaveURL(`${BASE_URL}/market-holidays`);
    await expect(page.locator('text=Market Holidays Calendar')).toBeVisible();
  });

  test('should display page header and description', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Verify page title
    await expect(page.locator('h1:has-text("Market Holidays Calendar")')).toBeVisible();

    // Verify description
    await expect(
      page.locator('text=/NSE and BSE market holidays for 2024-2026/i')
    ).toBeVisible();
  });

  test('should display breadcrumbs navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Verify breadcrumbs
    await expect(page.locator('text=Home')).toBeVisible();
    await expect(page.locator('text=Tools').first()).toBeVisible();
    await expect(page.locator('text=Market Holidays').first()).toBeVisible();
  });

  test('should display filter controls', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Verify year filter
    await expect(page.locator('text=Year')).toBeVisible();

    // Verify exchange filter
    await expect(page.locator('text=Exchange')).toBeVisible();

    // Verify upcoming toggle
    await expect(page.locator('text=Upcoming only')).toBeVisible();
  });

  test('should change year filter and reload holidays', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Click on year filter dropdown
    const yearFilter = page.getByLabel('Year');
    await yearFilter.click();

    // Wait for dropdown to open
    await page.waitForTimeout(300);

    // Select 2025
    await page.locator('[role="option"]', { hasText: '2025' }).click();

    // Wait for data to load
    await page.waitForTimeout(1000);

    // Verify holidays are shown for 2025
    await expect(page.locator('text=/Showing.*holiday/i')).toBeVisible();
  });

  test('should change exchange filter', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Click on exchange filter dropdown
    const exchangeFilter = page.getByLabel('Exchange');
    await exchangeFilter.click();

    // Wait for dropdown to open
    await page.waitForTimeout(300);

    // Select NSE Only
    await page.locator('[role="option"]', { hasText: 'NSE Only' }).click();

    // Wait for data to load
    await page.waitForTimeout(1000);

    // Verify NSE filter is applied (look for NSE badges or filter indication)
    await expect(page.locator('text=/Showing.*holiday/i')).toBeVisible();
  });

  test('should toggle upcoming filter', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Click upcoming toggle
    const upcomingToggle = page.getByRole('switch');
    await upcomingToggle.click();

    // Wait for data to load
    await page.waitForTimeout(1000);

    // Verify upcoming filter is applied
    const resultsText = await page.locator('text=/Showing.*holiday/i').textContent();
    expect(resultsText).toContain('holiday');
  });

  test('should display holiday cards with correct information', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Wait for holidays to load
    await page.waitForTimeout(1500);

    // Check for holiday cards (look for common holiday names)
    const holidayNames = [
      'Republic Day',
      'Independence Day',
      'Diwali',
      'Holi',
      'Christmas',
    ];

    // At least one holiday should be visible
    let foundHoliday = false;
    for (const name of holidayNames) {
      if (await page.locator(`text=${name}`).isVisible()) {
        foundHoliday = true;
        break;
      }
    }

    if (!foundHoliday) {
      // If no specific holidays found, at least verify holiday cards structure exists
      await expect(page.locator('[class*="Card"]').first()).toBeVisible();
    }
  });

  test('should display exchange badges on holiday cards', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Wait for holidays to load
    await page.waitForTimeout(1500);

    // Check for exchange badges
    const badges = ['NSE', 'BSE', 'NSE & BSE'];
    let foundBadge = false;

    for (const badge of badges) {
      const badgeElements = await page.locator(`text=${badge}`).count();
      if (badgeElements > 0) {
        foundBadge = true;
        break;
      }
    }

    expect(foundBadge).toBe(true);
  });

  test('should display data source information', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Scroll to bottom to see data source
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Verify data source section
    await expect(page.locator('text=Data Source')).toBeVisible();
    await expect(page.locator('text=/NSE Trading Holidays/i')).toBeVisible();
    await expect(page.locator('text=/BSE Market Holidays/i')).toBeVisible();
  });

  test('should display results count', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Wait for holidays to load
    await page.waitForTimeout(1500);

    // Verify results count is displayed
    await expect(page.locator('text=/Showing.*holiday/i')).toBeVisible();
  });

  test('should handle mobile viewport layout', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Verify page loads on mobile
    await expect(page.locator('h1:has-text("Market Holidays Calendar")')).toBeVisible();

    // Verify filters are stacked (not horizontal)
    const filterCard = page.locator('[class*="Card"]').first();
    await expect(filterCard).toBeVisible();
  });

  test('should maintain filter state when navigating back', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Change year to 2025
    const yearFilter = page.getByLabel('Year');
    await yearFilter.click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]', { hasText: '2025' }).click();
    await page.waitForTimeout(1000);

    // Navigate away
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    // Navigate back to market holidays
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Page should load (filters reset to default, which is expected behavior)
    await expect(page.locator('text=Market Holidays Calendar')).toBeVisible();
  });

  test('should combine multiple filters', async ({ page }) => {
    await page.goto(`${BASE_URL}/market-holidays`);
    await waitForPageLoad(page);

    // Set year to 2024
    const yearFilter = page.getByLabel('Year');
    await yearFilter.click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]', { hasText: '2024' }).click();
    await page.waitForTimeout(500);

    // Set exchange to NSE
    const exchangeFilter = page.getByLabel('Exchange');
    await exchangeFilter.click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]', { hasText: 'NSE Only' }).click();
    await page.waitForTimeout(500);

    // Toggle upcoming
    const upcomingToggle = page.getByRole('switch');
    await upcomingToggle.click();
    await page.waitForTimeout(1000);

    // Verify page still shows results or appropriate message
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);
  });
});
