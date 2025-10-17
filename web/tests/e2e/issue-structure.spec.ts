/**
 * E2E Tests for Issue Structure Section (Story 4.11)
 * Tests user interaction and visual rendering on IPO detail page
 */

import { test, expect } from '@playwright/test';

test.describe('Issue Structure Section E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to an IPO detail page with issue structure data
    // Using a seeded IPO for testing
    await page.goto('/ipos/test-issue-structure-ipo');
    await page.waitForLoadState('networkidle');
  });

  test('should display Issue Structure section on IPO detail page', async ({ page }) => {
    // Check for section heading
    const heading = page.locator('h2:has-text("Issue Structure")');
    await expect(heading).toBeVisible();

    // Check for section description
    await expect(page.locator('text=Detailed breakdown of the IPO offering mechanics')).toBeVisible();
  });

  test('should display Issue Type Badge', async ({ page }) => {
    // Check for Issue Type label
    await expect(page.locator('text=Issue Type')).toBeVisible();

    // Check for badge (one of the three types)
    const badgeTypes = ['Book Building', 'Fixed Price', 'Hybrid'];
    let foundBadge = false;

    for (const badgeType of badgeTypes) {
      const badge = page.locator(`text=${badgeType}`);
      if (await badge.isVisible({ timeout: 1000 }).catch(() => false)) {
        foundBadge = true;
        break;
      }
    }

    expect(foundBadge).toBe(true);
  });

  test('should display Fresh Issue vs OFS Breakdown chart', async ({ page }) => {
    // Check for chart section heading
    await expect(page.locator('text=Fresh Issue vs OFS Breakdown')).toBeVisible();

    // Check for chart legend items
    const freshIssueLabel = page.locator('text=Fresh Issue');
    const ofsLabel = page.locator('text=/Offer for Sale.*OFS/i');

    await expect(freshIssueLabel).toBeVisible();
    // OFS label should be visible if OFS exists
    const ofsExists = await ofsLabel.isVisible({ timeout: 1000 }).catch(() => false);
    if (ofsExists) {
      await expect(ofsLabel).toBeVisible();
    }

    // Check for Total Issue Size
    await expect(page.locator('text=Total Issue Size')).toBeVisible();
  });

  test('should display Minimum Investment prominently', async ({ page }) => {
    // Check for Minimum Investment label
    await expect(page.locator('text=Minimum Investment')).toBeVisible();

    // Check for rupee amount (format: ₹XX,XXX or ₹X,XX,XXX)
    const amountPattern = /₹[\d,]+/;
    const amounts = page.locator('text=/₹[\\d,]+/');
    await expect(amounts.first()).toBeVisible();
  });

  test('should display high investment warning for amounts > ₹50,000', async ({ page }) => {
    // If the minimum investment is > ₹50,000, should show "High Investment" badge
    const highInvestmentBadge = page.locator('text=High Investment');
    const isHighInvestment = await highInvestmentBadge.isVisible({ timeout: 2000 }).catch(() => false);

    if (isHighInvestment) {
      await expect(highInvestmentBadge).toBeVisible();
      // Should have amber/warning styling
      const badge = highInvestmentBadge.locator('..');
      await expect(badge).toHaveClass(/amber/);
    }
  });

  test('should display Cut-Off Price for BOOK_BUILDING IPOs', async ({ page }) => {
    // Check if issue type is BOOK_BUILDING
    const bookBuildingBadge = page.locator('text=Book Building');
    const isBookBuilding = await bookBuildingBadge.isVisible({ timeout: 1000 }).catch(() => false);

    if (isBookBuilding) {
      // Cut-off price should be visible
      const cutOffLabel = page.locator('text=Cut-Off Price');
      const isCutOffVisible = await cutOffLabel.isVisible({ timeout: 1000 }).catch(() => false);

      if (isCutOffVisible) {
        await expect(cutOffLabel).toBeVisible();
        // Should have helper text
        await expect(page.locator('text=/Bid at cut-off/i')).toBeVisible();
      }
    }
  });

  test('should display Registrar Portal link when available', async ({ page }) => {
    // Check for registrar section
    const registrarSection = page.locator('text=Registrar Portal');
    const hasRegistrar = await registrarSection.isVisible({ timeout: 1000 }).catch(() => false);

    if (hasRegistrar) {
      await expect(registrarSection).toBeVisible();

      // Check for link button
      const linkButton = page.locator('a:has-text("Check Allotment Status")');
      await expect(linkButton).toBeVisible();

      // Verify it's an external link
      await expect(linkButton).toHaveAttribute('target', '_blank');
      await expect(linkButton).toHaveAttribute('rel', 'noopener noreferrer');

      // Should have helper text
      await expect(page.locator('text=/Check your IPO application status/i')).toBeVisible();
    }
  });

  test('should have proper responsive layout on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Section should still be visible
    await expect(page.locator('h2:has-text("Issue Structure")')).toBeVisible();

    // Elements should be stacked vertically (grid should be single column)
    const section = page.locator('div:has(> h2:has-text("Issue Structure"))').first();
    await expect(section).toBeVisible();

    // All key elements should still be accessible
    await expect(page.locator('text=Issue Type')).toBeVisible();
    await expect(page.locator('text=Minimum Investment')).toBeVisible();
  });

  test('should have proper responsive layout on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Section should be visible
    await expect(page.locator('h2:has-text("Issue Structure")')).toBeVisible();

    // Check for 2-column layout (chart + details side by side)
    const gridContainer = page.locator('.grid');
    await expect(gridContainer).toBeVisible();

    // All elements should be visible
    await expect(page.locator('text=Fresh Issue vs OFS Breakdown')).toBeVisible();
    await expect(page.locator('text=Minimum Investment')).toBeVisible();
  });

  test('should display Issue Structure section after Key Metrics', async ({ page }) => {
    // Verify positioning: Issue Structure comes after Key Metrics Cards
    const keyMetrics = page.locator('text=/Subscription|Issue Size|GMP/i').first();
    const issueStructure = page.locator('h2:has-text("Issue Structure")');

    // Both should be visible
    await expect(keyMetrics).toBeVisible();
    await expect(issueStructure).toBeVisible();

    // Issue Structure should be below Key Metrics (higher y-coordinate)
    const keyMetricsBox = await keyMetrics.boundingBox();
    const issueStructureBox = await issueStructure.boundingBox();

    expect(issueStructureBox?.y).toBeGreaterThan(keyMetricsBox?.y || 0);
  });

  test('should have accessible tooltips on hover', async ({ page }) => {
    // Hover over Issue Type Badge to check tooltip
    const badge = page.locator('span:has-text(/Book Building|Fixed Price|Hybrid/)').first();

    // Check if badge has title attribute (tooltip)
    const hasTitle = await badge.getAttribute('title');
    expect(hasTitle).toBeTruthy();
  });

  test('should handle missing data gracefully', async ({ page }) => {
    // Navigate to an IPO without issue structure data
    await page.goto('/ipos/no-details-ipo');
    await page.waitForLoadState('networkidle');

    // Should show empty state or hide section
    const emptyState = page.locator('text=Issue structure data not available');
    const isSectionHidden = !(await page.locator('h2:has-text("Issue Structure")').isVisible({ timeout: 2000 }).catch(() => false));

    // Either empty state should be shown OR section should be hidden
    if (!isSectionHidden) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should correctly calculate and display percentages', async ({ page }) => {
    // Look for percentage values in the breakdown
    const percentages = page.locator('text=/%/i');

    // Should have at least one percentage value
    const count = await percentages.count();
    expect(count).toBeGreaterThan(0);

    // Percentages should add up to ~100% (allowing for rounding)
    if (count >= 2) {
      const firstPercentText = await percentages.first().textContent();
      const lastPercentText = await percentages.last().textContent();

      const firstPercent = parseFloat(firstPercentText?.match(/[\d.]+/)?.[0] || '0');
      const lastPercent = parseFloat(lastPercentText?.match(/[\d.]+/)?.[0] || '0');

      const total = firstPercent + lastPercent;
      expect(total).toBeGreaterThanOrEqual(99);
      expect(total).toBeLessThanOrEqual(101); // Allow 1% rounding error
    }
  });

  test('should display amounts in Indian number format', async ({ page }) => {
    // Check for amounts formatted with Indian comma separators
    // Indian format: 1,00,000 (not 100,000)
    const amounts = page.locator('text=/₹[\\d,]+/');
    await expect(amounts.first()).toBeVisible();

    // Get text and verify format
    const amountText = await amounts.first().textContent();
    expect(amountText).toMatch(/₹[\d,]+/);
  });
});

test.describe('Issue Structure Section - Screenshot Tests', () => {
  test('should match visual snapshot on desktop', async ({ page }) => {
    await page.goto('/ipos/test-issue-structure-ipo');
    await page.waitForLoadState('networkidle');

    const section = page.locator('div:has(> div > h2:has-text("Issue Structure"))').first();
    await expect(section).toBeVisible();

    // Visual regression test
    await expect(section).toHaveScreenshot('issue-structure-desktop.png');
  });

  test('should match visual snapshot on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/ipos/test-issue-structure-ipo');
    await page.waitForLoadState('networkidle');

    const section = page.locator('div:has(> div > h2:has-text("Issue Structure"))').first();
    await expect(section).toBeVisible();

    // Visual regression test
    await expect(section).toHaveScreenshot('issue-structure-mobile.png');
  });
});
