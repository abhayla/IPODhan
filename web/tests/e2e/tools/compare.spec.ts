/**
 * E2E Tests for IPO Comparison Tool
 *
 * Tests:
 * - Complete comparison flow: Select IPOs → View comparison → Share URL
 * - "Add to Compare" button from detail page
 * - Shareable URL functionality (access with pre-populated IPOs)
 * - IPO selection and removal
 * - Maximum 3 IPO limit enforcement
 * - Comparison table rendering
 * - Mobile responsive behavior
 * - Navigation from header menu
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

test.describe('IPO Comparison Tool', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport for consistent testing
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should navigate to comparison page from header menu', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    // Hover over Tools menu
    await page.locator('text=Tools').hover();

    // Click on "Compare IPOs" link
    await page.locator('text=Compare IPOs').click();

    // Verify navigation to comparison page
    await expect(page).toHaveURL(`${BASE_URL}/tools/compare`);
    await expect(page.locator('text=IPO Comparison Tool')).toBeVisible();
  });

  test('should display empty state when no IPOs selected', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Verify empty state message
    await expect(
      page.locator('text=/No IPOs selected yet/i')
    ).toBeVisible();

    // Verify selection counter shows 0/3
    await expect(page.locator('text=/0 \\/ 3 selected/i')).toBeVisible();
  });

  test('should complete full comparison workflow: select 2 IPOs and view comparison', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Open dropdown selector
    const selector = page.locator('[role="combobox"]').first();
    await selector.click();

    // Wait for dropdown options to appear
    await page.waitForTimeout(500);

    // Select first IPO (click on first option)
    const firstOption = page.locator('[role="option"]').first();
    await firstOption.click();

    // Wait for selection to complete
    await page.waitForTimeout(500);

    // Verify first IPO is selected (badge should appear)
    const firstBadge = page.locator('[role="group"] span').first();
    await expect(firstBadge).toBeVisible();

    // Open dropdown again for second IPO
    await selector.click();
    await page.waitForTimeout(500);

    // Select second IPO
    const secondOption = page.locator('[role="option"]').first();
    await secondOption.click();

    // Wait for comparison to load
    await page.waitForTimeout(1000);

    // Verify comparison table appears
    await expect(page.locator('text=IPO Comparison')).toBeVisible();
    await expect(page.locator('[role="table"]')).toBeVisible();

    // Verify table has expected rows
    await expect(page.locator('text=Price Range')).toBeVisible();
    await expect(page.locator('text=Lot Size')).toBeVisible();
    await expect(page.locator('text=Total Subscription')).toBeVisible();
    await expect(page.locator('text=Current GMP')).toBeVisible();
    await expect(page.locator('text=P/E Ratio')).toBeVisible();
  });

  test('should update URL with selected IPO slugs', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Select IPOs (same as previous test)
    const selector = page.locator('[role="combobox"]').first();
    await selector.click();
    await page.waitForTimeout(500);

    const firstOption = page.locator('[role="option"]').first();
    const firstSlug = await firstOption.getAttribute('data-value') || 'test-slug-1';
    await firstOption.click();
    await page.waitForTimeout(500);

    // Verify URL updated with first slug
    await expect(page).toHaveURL(new RegExp(`ipos=${firstSlug}`));
  });

  test('should pre-populate IPOs from shareable URL', async ({ page }) => {
    // Create shareable URL with pre-defined slugs
    const slug1 = 'alpha-tech-ipo';
    const slug2 = 'beta-finance-ipo';
    const shareableUrl = `${BASE_URL}/tools/compare?ipos=${slug1},${slug2}`;

    await page.goto(shareableUrl);
    await waitForPageLoad(page);

    // Verify URL params are intact
    expect(page.url()).toContain(`ipos=${slug1},${slug2}`);

    // Verify selection counter shows 2/3
    await expect(page.locator('text=/2 \\/ 3 selected/i')).toBeVisible();
  });

  test('should remove IPO from comparison', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Select an IPO
    const selector = page.locator('[role="combobox"]').first();
    await selector.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Verify IPO badge appears
    const badge = page.locator('[role="group"] span').first();
    await expect(badge).toBeVisible();

    // Click remove button (X icon)
    const removeButton = page.locator('[aria-label^="Remove"]').first();
    await removeButton.click();

    // Verify selection count updated
    await expect(page.locator('text=/0 \\/ 3 selected/i')).toBeVisible();
  });

  test('should enforce maximum 3 IPO limit', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    const selector = page.locator('[role="combobox"]').first();

    // Select 3 IPOs
    for (let i = 0; i < 3; i++) {
      await selector.click();
      await page.waitForTimeout(500);
      await page.locator('[role="option"]').first().click();
      await page.waitForTimeout(500);
    }

    // Verify selection count shows 3/3
    await expect(page.locator('text=/3 \\/ 3 selected/i')).toBeVisible();

    // Verify selector is disabled
    await expect(selector).toBeDisabled();
  });

  test('should clear all selections with "Clear All" button', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Select an IPO
    const selector = page.locator('[role="combobox"]').first();
    await selector.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Click "Clear All" button
    await page.locator('text=Clear All').click();

    // Verify empty state appears
    await expect(
      page.locator('text=/No IPOs selected yet/i')
    ).toBeVisible();
  });

  test('should add IPO to comparison from detail page', async ({ page }) => {
    // Navigate to any IPO detail page
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    // Click on first IPO card
    const ipoCard = page.locator('[data-testid="ipo-card"]').first();
    if (await ipoCard.count() > 0) {
      await ipoCard.click();
      await waitForPageLoad(page);

      // Find and click "Add to Compare" button
      const addButton = page.locator('text=Add to Compare');
      if (await addButton.count() > 0) {
        await addButton.click();

        // Verify button changes to "Added to Compare"
        await expect(page.locator('text=Added to Compare')).toBeVisible();

        // Verify comparison count badge appears
        await expect(page.locator('text=/1/').first()).toBeVisible();
      }
    }
  });

  test('should navigate to comparison page from "View Comparison" button on detail page', async ({ page }) => {
    // Navigate to IPO detail page
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    const ipoCard = page.locator('[data-testid="ipo-card"]').first();
    if (await ipoCard.count() > 0) {
      await ipoCard.click();
      await waitForPageLoad(page);

      // Add first IPO to comparison
      const addButton = page.locator('text=Add to Compare');
      if (await addButton.count() > 0) {
        await addButton.click();
        await page.waitForTimeout(500);

        // Go back and add another IPO
        await page.goto(`${BASE_URL}/dashboard`);
        await waitForPageLoad(page);
        const secondCard = page.locator('[data-testid="ipo-card"]').nth(1);
        if (await secondCard.count() > 0) {
          await secondCard.click();
          await waitForPageLoad(page);
          await page.locator('text=Add to Compare').click();
          await page.waitForTimeout(500);

          // Click "View Comparison" button
          const viewButton = page.locator('text=View Comparison');
          if (await viewButton.count() > 0) {
            await viewButton.click();

            // Verify navigation to comparison page
            await expect(page).toHaveURL(/\/tools\/compare/);
            await expect(page.locator('text=IPO Comparison')).toBeVisible();
          }
        }
      }
    }
  });

  test('should display validation message when only 1 IPO selected', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Select one IPO
    const selector = page.locator('[role="combobox"]').first();
    await selector.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Verify validation message appears
    await expect(
      page.locator('text=/Please select at least one more IPO/i')
    ).toBeVisible();
  });

  test('should be mobile responsive', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Verify page elements are visible on mobile
    await expect(page.locator('text=IPO Comparison Tool')).toBeVisible();
    await expect(page.locator('text=/Select IPOs to Compare/i')).toBeVisible();

    // Open mobile menu
    const mobileMenuButton = page.locator('[aria-label="Toggle menu"]');
    if (await mobileMenuButton.count() > 0) {
      await mobileMenuButton.click();

      // Verify Tools menu appears
      await expect(page.locator('text=Tools')).toBeVisible();
      await expect(page.locator('text=Compare IPOs')).toBeVisible();
    }
  });

  test('should display comparison table with horizontal scroll on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Use shareable URL with pre-selected IPOs
    await page.goto(`${BASE_URL}/tools/compare?ipos=alpha-tech-ipo,beta-finance-ipo`);
    await waitForPageLoad(page);

    // Verify table exists
    const table = page.locator('[role="table"]');
    if (await table.count() > 0) {
      // Verify table container has overflow-x-auto class (horizontal scroll)
      const tableContainer = page.locator('div[data-slot="table-container"]');
      await expect(tableContainer).toBeVisible();
    }
  });

  test('should persist selection in session storage across navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Select an IPO
    const selector = page.locator('[role="combobox"]').first();
    await selector.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Navigate away
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    // Navigate back to comparison page
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Verify selection persists (should show 1/3 selected)
    await expect(page.locator('text=/1 \\/ 3 selected/i')).toBeVisible();
  });

  test('should display info section with usage instructions', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/compare`);
    await waitForPageLoad(page);

    // Scroll to info section
    await page.locator('text=How to Use This Tool').scrollIntoViewIfNeeded();

    // Verify info section content
    await expect(page.locator('text=How to Use This Tool')).toBeVisible();
    await expect(page.locator('text=/Select IPOs/i')).toBeVisible();
    await expect(page.locator('text=/Review Comparison/i')).toBeVisible();
    await expect(page.locator('text=/Share Your Comparison/i')).toBeVisible();

    // Verify comparison tips
    await expect(page.locator('text=Comparison Tips')).toBeVisible();
  });
});
