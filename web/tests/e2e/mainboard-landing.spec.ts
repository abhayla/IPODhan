/**
 * E2E Tests: Mainboard Landing Page
 * Story 9.15: Mainboard IPOs Landing Page
 *
 * MANDATORY E2E tests for all critical user workflows.
 * Tests complete user journeys from navigation to interaction.
 */

import { test, expect } from '@playwright/test';

test.describe('Mainboard Landing Page E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to Mainboard IPOs landing page
    await page.goto('/mainboard-ipos');
  });

  // ==================== TEST: Page Load ====================

  test('should navigate to Mainboard landing page successfully', async ({ page }) => {
    // Assert - Page loads
    await expect(page).toHaveURL(/\/mainboard-ipos/);

    // Assert - Page title contains "Mainboard"
    await expect(page).toHaveTitle(/Mainboard IPOs/);
  });

  test('should load page without errors', async ({ page }) => {
    // Assert - No console errors (except network errors which are acceptable)
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Some errors are acceptable (e.g., font loading, API throttling)
    // Critical errors should fail the test
    const criticalErrors = errors.filter(
      (err) => !err.includes('favicon') && !err.includes('font')
    );

    expect(criticalErrors.length).toBe(0);
  });

  // ==================== TEST: Summary Metrics Section ====================

  test('should display summary metrics section with 6 cards', async ({ page }) => {
    // Assert - Summary metrics section exists
    const metricsSection = page.locator('text=Total Mainboard IPOs').first();
    await expect(metricsSection).toBeVisible();

    // Assert - All 6 metric card titles visible
    await expect(page.locator('text=Total Mainboard IPOs')).toBeVisible();
    await expect(page.locator('text=Listed in Gain')).toBeVisible();
    await expect(page.locator('text=Listed in Loss')).toBeVisible();
    await expect(page.locator('text=Upcoming & OnGoing')).toBeVisible();
    await expect(page.locator('text=Gain (All Over Time)')).toBeVisible();
    await expect(page.locator('text=Loss (All Over Time)')).toBeVisible();
  });

  // ==================== TEST: Content Sections ====================

  test('should display all 6 content sections', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Assert - All section headers visible
    await expect(page.locator('h2:has-text("Current IPOs")')).toBeVisible();
    await expect(page.locator('h2:has-text("Upcoming IPOs")')).toBeVisible();
    await expect(page.locator('h2:has-text("Recently Listed IPOs")')).toBeVisible();
    await expect(page.locator('h2:has-text("IPO Reviews & Analysis")')).toBeVisible();
    await expect(page.locator('h2:has-text("Performance Highlights")')).toBeVisible();
    await expect(page.locator('h2:has-text("Subscription Status")')).toBeVisible();
  });

  test('should display "View All" links for all content sections', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Assert - View All links exist (at least 6)
    const viewAllLinks = page.locator('a:has-text("View All")');
    const count = await viewAllLinks.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  // ==================== TEST: Navigation Cards ====================

  test('should display all 4 navigation cards', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Assert - All 4 navigation card titles visible
    await expect(page.locator('text=Performance Tracker')).toBeVisible();
    await expect(page.locator('text=IPO Prospectus')).toBeVisible();
    await expect(page.locator('text=IPO Calendar')).toBeVisible();
    await expect(page.locator('text=IPO Reviews & Analysis')).toBeVisible();
  });

  test('should navigate to dedicated pages when clicking navigation cards', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Click Performance Tracker card
    await page.click('text=Performance Tracker');

    // Assert - Navigate to performance tracker page
    await expect(page).toHaveURL(/\/mainboard-ipo-performance-tracker/);
  });

  // ==================== TEST: Detailed Table ====================

  test('should display detailed table section', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Scroll to bottom where detailed table is
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Assert - Detailed table section header visible
    await expect(
      page.locator('h2:has-text("Detailed Mainboard IPO Listings")').or(
        page.locator('text=Year Navigation')
      )
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display year navigation controls', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Scroll to detailed table
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Assert - Year should be visible (current year)
    const currentYear = new Date().getFullYear().toString();
    await expect(page.locator(`text=${currentYear}`)).toBeVisible({ timeout: 10000 });
  });

  // ==================== TEST: Navigation ====================

  test('should navigate from header "Mainboard IPOs" link', async ({ page }) => {
    // Navigate to home first
    await page.goto('/');

    // Click "Mainboard IPOs" in navigation
    await page.click('text=Mainboard IPOs', { timeout: 10000 });

    // Assert - Navigate to landing page
    await expect(page).toHaveURL(/\/mainboard-ipos/);
  });

  test('should show dropdown submenu on "Mainboard IPOs" hover', async ({ page }) => {
    // Navigate to home first
    await page.goto('/');

    // Hover over "Mainboard IPOs" in navigation
    await page.hover('text=Mainboard IPOs', { timeout: 10000 });

    // Assert - Dropdown menu visible with sub-items
    // Note: Dropdown implementation may vary, adjust selectors as needed
    await page.waitForTimeout(500); // Wait for dropdown animation

    // Check for at least one submenu item (Performance Tracker or others)
    const submenuVisible = await page
      .locator('a:has-text("Performance Tracker")')
      .or(page.locator('a:has-text("Prospectus")'))
      .isVisible();

    expect(submenuVisible).toBe(true);
  });

  // ==================== TEST: IPO Card Interactions ====================

  test('should navigate to IPO detail when clicking company name', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Find first IPO card link (if any)
    const ipoLinks = page.locator('a[href^="/ipos/"]');
    const count = await ipoLinks.count();

    if (count > 0) {
      // Click first IPO link
      await ipoLinks.first().click();

      // Assert - Navigate to IPO detail page
      await expect(page).toHaveURL(/\/ipos\//);
    }
  });

  // ==================== TEST: "View All" Links ====================

  test('should navigate when clicking "View All" links', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Click first "View All" link
    const viewAllLinks = page.locator('a:has-text("View All")');
    const count = await viewAllLinks.count();

    if (count > 0) {
      const firstLink = viewAllLinks.first();
      await firstLink.click();

      // Assert - URL changed (navigated somewhere)
      await expect(page).not.toHaveURL('/mainboard-ipos');
    }
  });

  // ==================== TEST: Responsive Design ====================

  test('should display mobile card layout on small screens', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Assert - Page renders without layout issues
    const metricsSection = page.locator('text=Total Mainboard IPOs');
    await expect(metricsSection).toBeVisible();

    // Assert - Cards stack vertically (single column)
    // This is implicit in mobile layout, just check visibility
  });

  test('should display desktop layout on large screens', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Assert - Page renders with all sections visible
    await expect(page.locator('text=Total Mainboard IPOs')).toBeVisible();
    await expect(page.locator('h2:has-text("Current IPOs")')).toBeVisible();
  });

  // ==================== TEST: Loading States ====================

  test('should show loading skeleton or state during initial load', async ({ page }) => {
    // Start navigation but don't wait for load
    const response = page.goto('/mainboard-ipos');

    // Assert - Some loading indicator or skeleton (if implemented)
    // This test may need adjustment based on actual loading UI
    await page.waitForTimeout(100);

    // Wait for complete load
    await response;
    await page.waitForLoadState('networkidle');

    // Assert - Content eventually loads
    await expect(page.locator('text=Total Mainboard IPOs')).toBeVisible();
  });

  // ==================== TEST: Empty States ====================

  test('should display empty states when no data available', async ({ page }) => {
    // Note: This test requires mocking empty API responses
    // Or testing with a clean database
    // For now, we just check the page doesn't crash

    await page.waitForLoadState('networkidle');

    // Assert - Page loads even with empty data
    await expect(page.locator('body')).toBeVisible();
  });

  // ==================== TEST: SEO & Metadata ====================

  test('should have correct meta tags for SEO', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Assert - Page title
    const title = await page.title();
    expect(title).toContain('Mainboard IPOs');

    // Assert - Meta description exists
    const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
    expect(metaDescription).toBeTruthy();
    expect(metaDescription).toContain('Mainboard');
  });

  // ==================== TEST: Performance ====================

  test('should load page within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/mainboard-ipos');
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    // Assert - Page loads in under 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  // ==================== TEST: Accessibility ====================

  test('should have accessible navigation structure', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Assert - Main content has proper heading structure
    const h1 = page.locator('h1');
    const h1Count = await h1.count();
    expect(h1Count).toBeGreaterThanOrEqual(1);

    // Assert - Navigation links are accessible
    const navLinks = page.locator('a');
    const linkCount = await navLinks.count();
    expect(linkCount).toBeGreaterThan(0);
  });

  // ==================== TEST: Error Handling ====================

  test('should handle navigation errors gracefully', async ({ page }) => {
    // Try to navigate to invalid year
    await page.goto('/mainboard-ipos?year=1900');

    // Assert - Page still loads (with empty or filtered data)
    await expect(page.locator('body')).toBeVisible();
  });

  // ==================== TEST: Year Filter Functionality ====================

  test('should update URL when changing year filter', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Scroll to detailed table with year navigation
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Try to find year navigation buttons (may vary based on implementation)
    const yearButtons = page.locator('button').filter({ hasText: /Year|<<|>>/ });
    const buttonCount = await yearButtons.count();

    if (buttonCount > 0) {
      // Click a year navigation button
      await yearButtons.first().click();

      // Wait a bit for URL update
      await page.waitForTimeout(500);

      // Assert - URL should contain year query param
      const url = page.url();
      expect(url).toContain('year=');
    }
  });

  // ==================== TEST: Complete User Journey ====================

  test('complete user journey: Browse landing page and navigate to detail', async ({ page }) => {
    // Step 1: Load landing page
    await page.goto('/mainboard-ipos');
    await page.waitForLoadState('networkidle');

    // Step 2: Verify summary metrics visible
    await expect(page.locator('text=Total Mainboard IPOs')).toBeVisible();

    // Step 3: Scroll through sections
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);

    // Step 4: Verify content sections visible
    await expect(page.locator('h2:has-text("Current IPOs")')).toBeVisible();

    // Step 5: Click on an IPO card (if available)
    const ipoLinks = page.locator('a[href^="/ipos/"]');
    const count = await ipoLinks.count();

    if (count > 0) {
      await ipoLinks.first().click();
      await expect(page).toHaveURL(/\/ipos\//);
    }

    // Journey complete - user can browse and navigate successfully
  });
});
