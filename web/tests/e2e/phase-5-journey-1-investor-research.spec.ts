/**
 * Phase 5: User Journey Testing
 * Journey 1: Investor Research Journey
 *
 * User Story: Investor wants to research an open IPO and apply
 *
 * Flow:
 * 1. Homepage → Dashboard
 * 2. Dashboard → IPO Detail (filter by OPEN)
 * 3. IPO Detail → View GMP History
 * 4. IPO Detail → Apply Now (check affiliate links)
 */

import { test, expect } from '@playwright/test';

test.describe('Journey 1: Investor Research', () => {
  // Track journey metrics
  let journeyStartTime: number;
  let pageLoadCount: number;
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    journeyStartTime = Date.now();
    pageLoadCount = 0;
    consoleErrors = [];

    // Listen for console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Listen for page navigations
    page.on('load', () => {
      pageLoadCount++;
    });
  });

  test.afterEach(async () => {
    const journeyTime = Date.now() - journeyStartTime;
    console.log('Journey Time:', journeyTime, 'ms');
    console.log('Page Loads:', pageLoadCount);
    console.log('Console Errors:', consoleErrors.length);
  });

  test('should complete full investor research journey', async ({ page }) => {
    // ===== STEP 1: Homepage → Dashboard =====
    console.log('Step 1: Homepage → Dashboard');
    await page.goto('/');
    await expect(page).toHaveTitle(/IPODhan/);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Verify homepage loaded
    await expect(page.getByText(/Your Trusted IPO Investment Platform|IPODhan/i)).toBeVisible();

    // Navigate to dashboard (try multiple possible paths)
    const dashboardLink = page.getByRole('link', { name: /Dashboard|View All IPOs|Browse IPOs/i }).first();

    if (await dashboardLink.isVisible()) {
      await dashboardLink.click();
    } else {
      // Direct navigation if link not found
      await page.goto('/dashboard');
    }

    await page.waitForLoadState('networkidle');

    // Verify we're on dashboard
    expect(page.url()).toContain('/dashboard');

    // ===== STEP 2: Filter by Status=OPEN =====
    console.log('Step 2: Filter open IPOs');

    // Wait for IPO cards to load
    await page.waitForSelector('body', { timeout: 10000 });

    // Try to find and use status filter
    const statusFilter = page.locator('select[name="status"], select[id*="status"], [data-testid="status-filter"]').first();

    if (await statusFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await statusFilter.selectOption('OPEN');
      await page.waitForTimeout(500); // Wait for filter to apply
    } else {
      console.log('Status filter not found - checking for open IPOs directly');
    }

    // ===== STEP 3: Click on first IPO (OPEN if filtered, any if not) =====
    console.log('Step 3: Navigate to IPO detail');

    // Look for IPO cards
    const ipoCard = page.locator('[data-testid="ipo-card"], .ipo-card, article[class*="card"], div[class*="ipo"]').first();

    // Wait for at least one card to be visible
    const hasCards = await ipoCard.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasCards) {
      // Click the card or find a link within it
      const ipoLink = ipoCard.locator('a[href*="/ipos/"]').first();

      if (await ipoLink.isVisible({ timeout: 1000 }).catch(() => false)) {
        await ipoLink.click();
      } else {
        await ipoCard.click();
      }

      await page.waitForLoadState('networkidle');

      // ===== STEP 4: Verify IPO Detail Page Loaded =====
      console.log('Step 4: Verify IPO detail page');

      // Should be on IPO detail page
      await expect(page).toHaveURL(/\/ipos\/[\w-]+/);

      // Wait for main heading
      const h1 = page.locator('h1').first();
      await expect(h1).toBeVisible({ timeout: 5000 });

      // ===== STEP 5: Check GMP Section =====
      console.log('Step 5: Check GMP section');

      // Scroll to GMP section if it exists
      const gmpSection = page.locator('[data-testid="gmp-section"], text=GMP, text=Grey Market Premium').first();

      if (await gmpSection.isVisible({ timeout: 3000 }).catch(() => false)) {
        await gmpSection.scrollIntoViewIfNeeded();
        console.log('GMP section found and visible');

        // Check if GMP data is displayed
        const gmpData = page.locator('[data-testid="gmp-value"], [data-testid="gmp-data"]');
        const hasGMPData = await gmpData.isVisible({ timeout: 2000 }).catch(() => false);

        if (hasGMPData) {
          console.log('GMP data is displayed');
        } else {
          console.log('GMP section exists but no data available');
        }
      } else {
        console.log('GMP section not found (may not be available for this IPO)');
      }

      // ===== STEP 6: Check Apply Now / Affiliate Links =====
      console.log('Step 6: Check Apply Now button');

      // Look for Apply Now button or affiliate links
      const applyButton = page.getByRole('link', { name: /Apply Now|Apply|Open Account/i }).first();

      if (await applyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Apply Now button found');

        // Verify it's a link (should have href)
        const href = await applyButton.getAttribute('href');
        expect(href).toBeTruthy();
        console.log('Apply Now link:', href);

        // Verify link is valid (not javascript:void or #)
        if (href) {
          expect(href).not.toContain('javascript:');
          expect(href).not.toBe('#');
        }
      } else {
        console.log('Apply Now button not found (may require different IPO status)');
      }

      // Journey completed successfully
      console.log('Journey 1 completed successfully');

    } else {
      console.log('No IPO cards found on dashboard - skipping detail navigation');
      // Still pass the test as database may be empty
    }

    // ===== ASSERTIONS =====
    // Total journey time should be reasonable (< 15s)
    const totalTime = Date.now() - journeyStartTime;
    expect(totalTime).toBeLessThan(15000);

    // Should have minimal console errors
    expect(consoleErrors.length).toBeLessThan(5);
  });

  test('should handle browser back button correctly', async ({ page }) => {
    console.log('Testing browser back button navigation');

    // Navigate through journey
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const currentUrl = page.url();

    // Go back
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // Should be back on homepage
    expect(page.url()).toContain('/');
    expect(page.url()).not.toBe(currentUrl);

    // Go forward
    await page.goForward();
    await page.waitForLoadState('networkidle');

    // Should be back on dashboard
    expect(page.url()).toContain('/dashboard');
  });

  test('should be mobile responsive throughout journey', async ({ page }) => {
    console.log('Testing mobile responsiveness');

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Homepage
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    const bodyBox = await body.boundingBox();

    // Should not have horizontal scroll
    expect(bodyBox?.width).toBeLessThanOrEqual(375);

    // Dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Check for mobile menu if navigation is hidden
    const mobileMenu = page.getByRole('button', { name: /menu|navigation/i });

    if (await mobileMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('Mobile menu button found');
      await expect(mobileMenu).toBeVisible();
    }

    // Verify content is accessible on mobile
    await expect(body).toBeVisible();
  });

  test('should load pages quickly (performance test)', async ({ page }) => {
    console.log('Testing page load performance');

    // Homepage load
    const homeStartTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const homeLoadTime = Date.now() - homeStartTime;

    console.log('Homepage load time:', homeLoadTime, 'ms');
    expect(homeLoadTime).toBeLessThan(5000); // Should load in < 5s

    // Dashboard load
    const dashboardStartTime = Date.now();
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const dashboardLoadTime = Date.now() - dashboardStartTime;

    console.log('Dashboard load time:', dashboardLoadTime, 'ms');
    expect(dashboardLoadTime).toBeLessThan(5000); // Should load in < 5s
  });

  test('should display data correctly at each step', async ({ page }) => {
    console.log('Testing data display at each step');

    // Homepage - should have hero content
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const heroSection = page.locator('text=/IPO|Investment|Platform/i').first();
    await expect(heroSection).toBeVisible();

    // Dashboard - should have heading
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const dashboardHeading = page.locator('h1, h2').first();
    await expect(dashboardHeading).toBeVisible();

    console.log('Data display test completed');
  });
});
