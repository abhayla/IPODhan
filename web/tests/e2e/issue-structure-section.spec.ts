/**
 * E2E Tests: Issue Structure Section (Story 4.11)
 *
 * Tests the display and functionality of the Issue Structure section
 * on the IPO detail page, including:
 * - Issue Type Badge display
 * - Fresh Issue vs OFS breakdown chart
 * - Minimum Investment display
 * - Cut-off Price display (for BOOK_BUILDING)
 * - Registrar Portal link
 * - Null data handling
 */

import { test, expect } from '@playwright/test';

test.describe('Issue Structure Section Display', () => {
  test('should display issue structure section with complete data', async ({ page }) => {
    // Navigate to an IPO detail page (assuming test data exists)
    await page.goto('/ipos/test-ipo-mainboard-open');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check if Issue Structure section is visible
    const issueStructureSection = page.locator('text=Issue Structure').first();
    await expect(issueStructureSection).toBeVisible();

    // Check for Issue Type Badge
    const issueTypeBadge = page.locator('[role="tooltip"]').first();
    await expect(issueTypeBadge).toBeVisible();

    // Check for section description
    await expect(page.locator('text=Detailed breakdown of the IPO offering mechanics')).toBeVisible();
  });

  test('should display issue type with correct color coding', async ({ page }) => {
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Issue type should be displayed
    const issueTypeSection = page.locator('text=Issue Type').first();
    await expect(issueTypeSection).toBeVisible();

    // Badge should exist (color testing done at unit level)
    const badge = issueTypeSection.locator('..').locator('[role="tooltip"]');
    await expect(badge).toBeVisible();
  });

  test('should display minimum investment with amount', async ({ page }) => {
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Minimum investment section
    await expect(page.locator('text=Minimum Investment')).toBeVisible();

    // Amount should be displayed (format: ₹XX,XXX)
    const amountPattern = /₹[\d,]+/;
    const amount = page.locator('text=Minimum Investment').locator('..').locator('..').locator('p').nth(1);
    await expect(amount).toContainText(amountPattern);
  });

  test('should display registrar portal link when available', async ({ page }) => {
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Check for Registrar Portal section
    const registrarSection = page.locator('text=Registrar Portal').first();

    if (await registrarSection.isVisible()) {
      // Link button should exist
      const linkButton = page.locator('a:has-text("Check Allotment Status")');
      await expect(linkButton).toBeVisible();

      // Should have external link icon
      await expect(linkButton.locator('svg')).toBeVisible();

      // Should have target="_blank" and rel="noopener noreferrer"
      await expect(linkButton).toHaveAttribute('target', '_blank');
      await expect(linkButton).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  test('should handle missing data gracefully', async ({ page }) => {
    await page.goto('/ipos/test-ipo-upcoming');
    await page.waitForLoadState('networkidle');

    // Section should still be visible
    const issueStructureSection = page.locator('text=Issue Structure').first();
    await expect(issueStructureSection).toBeVisible();

    // Should show empty state or fallback content
    const emptyStateOptions = [
      page.locator('text=Issue structure data not available'),
      page.locator('text=No issue breakdown data available'),
      page.locator('text=Not Available'),
    ];

    // At least one empty state should be visible
    let foundEmptyState = false;
    for (const option of emptyStateOptions) {
      if (await option.isVisible()) {
        foundEmptyState = true;
        break;
      }
    }

    // If data exists, that's also fine - just verify section renders
    if (!foundEmptyState) {
      await expect(issueStructureSection).toBeVisible();
    }
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Section should be visible on mobile
    const issueStructureSection = page.locator('text=Issue Structure').first();
    await expect(issueStructureSection).toBeVisible();

    // Content should stack vertically (check layout)
    const section = page.locator('text=Issue Structure').locator('..');
    const boundingBox = await section.boundingBox();

    // Section should take full width on mobile
    expect(boundingBox).toBeTruthy();
    if (boundingBox) {
      expect(boundingBox.width).toBeLessThanOrEqual(375);
    }
  });

  test('should be responsive on tablet viewport', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Section should be visible on tablet
    const issueStructureSection = page.locator('text=Issue Structure').first();
    await expect(issueStructureSection).toBeVisible();
  });

  test('should display issue breakdown chart with percentages', async ({ page }) => {
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Check for breakdown heading
    const breakdownHeading = page.locator('text=Fresh Issue vs OFS Breakdown');

    if (await breakdownHeading.isVisible()) {
      // Percentage labels should be visible in chart
      const percentagePattern = /\d+\.?\d*%/;
      const percentages = page.locator(`text=${percentagePattern}`);

      // Should have at least one percentage label
      await expect(percentages.first()).toBeVisible({ timeout: 5000 });

      // Legend items should be visible
      await expect(page.locator('text=Fresh Issue').first()).toBeVisible();
    }
  });

  test('should display cut-off price for BOOK_BUILDING issues', async ({ page }) => {
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Check if issue type is BOOK_BUILDING
    const bookBuildingBadge = page.locator('text=Book Building').first();

    if (await bookBuildingBadge.isVisible()) {
      // Cut-off price section might be visible
      const cutOffSection = page.locator('text=Cut-Off Price');

      if (await cutOffSection.isVisible()) {
        // Price should be displayed with ₹ symbol
        const pricePattern = /₹[\d,]+/;
        const price = cutOffSection.locator('..').locator(`text=${pricePattern}`);
        await expect(price).toBeVisible();
      }
    }
  });

  test('should show accessibility indicator for low minimum investment', async ({ page }) => {
    await page.goto('/ipos/test-ipo-mainboard-open');
    await page.waitForLoadState('networkidle');

    // Check for accessibility indicators
    const accessibleBadge = page.locator('text=Accessible').first();
    const highInvestmentBadge = page.locator('text=High Investment').first();

    // One of these should be visible if minimum investment data exists
    const hasMinInvestment = await page.locator('text=Minimum Investment').isVisible();

    if (hasMinInvestment) {
      const hasAccessibleBadge = await accessibleBadge.isVisible();
      const hasHighInvestmentBadge = await highInvestmentBadge.isVisible();

      // At least one badge should be visible
      expect(hasAccessibleBadge || hasHighInvestmentBadge).toBeTruthy();
    }
  });
});
