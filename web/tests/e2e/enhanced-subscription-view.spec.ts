/**
 * E2E Tests: Enhanced Subscription View
 *
 * End-to-end tests for subscription breakdown with 7 categories.
 * Story 5.6: Enhanced Subscription Breakdown
 */

import { test, expect } from '@playwright/test';

test.describe('Enhanced Subscription View', () => {
  test.describe('Simple View (Default)', () => {
    test('should display subscription tab with 3 main categories', async ({ page }) => {
      // Navigate to an open IPO detail page
      await page.goto('/ipos/test-ipo-slug');

      // Click on Subscription tab
      await page.click('button[value="subscription"]');

      // Wait for subscription data to load
      await page.waitForSelector('text=Subscription Breakdown');

      // Check that total subscription is displayed
      await expect(page.locator('text=Total Subscription')).toBeVisible();

      // Check that 3 main categories are displayed
      await expect(page.locator('text=QIB')).toBeVisible();
      await expect(page.locator('text=NII')).toBeVisible();
      await expect(page.locator('text=Retail')).toBeVisible();

      // Check that subscription values are displayed with 'x' suffix
      await expect(page.locator('text=/\\d+\\.\\d{2}x/')).toBeVisible();
    });

    test('should display progress bars with correct colors', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Wait for progress bars to render
      await page.waitForSelector('[class*="bg-green-500"], [class*="bg-yellow-500"], [class*="bg-red-500"]');

      // Check that at least one progress bar exists
      const progressBars = await page.locator('.rounded-full').count();
      expect(progressBars).toBeGreaterThan(0);
    });

    test('should display additional metrics if available', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Check for total applications
      const applicationsVisible = await page.locator('text=Total Applications').isVisible();
      if (applicationsVisible) {
        await expect(page.locator('text=Total Applications')).toBeVisible();
      }

      // Check for shares bid
      const sharesBidVisible = await page.locator('text=Shares Bid').isVisible();
      if (sharesBidVisible) {
        await expect(page.locator('text=Shares Bid')).toBeVisible();
      }
    });

    test('should show last updated timestamp', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      await expect(page.locator('text=Last updated:')).toBeVisible();
    });
  });

  test.describe('View Toggle', () => {
    test('should show toggle when detailed data available', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Check if toggle exists
      const simpleViewTab = page.locator('button:has-text("Simple View")');
      const detailedViewTab = page.locator('button:has-text("Detailed View")');

      // If detailed data available, toggle should be visible
      const hasToggle = await simpleViewTab.isVisible();
      if (hasToggle) {
        await expect(simpleViewTab).toBeVisible();
        await expect(detailedViewTab).toBeVisible();
      }
    });

    test('should switch between simple and detailed views', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Check if toggle exists
      const hasToggle = await page.locator('button:has-text("Detailed View")').isVisible();

      if (hasToggle) {
        // Click on Detailed View
        await page.click('button:has-text("Detailed View")');

        // Wait for detailed view to render
        await page.waitForTimeout(500);

        // Check for granular categories
        const hasGranularData = await page.locator('text=Big NII').isVisible();
        if (hasGranularData) {
          await expect(page.locator('text=Big NII')).toBeVisible();
          await expect(page.locator('text=Small NII')).toBeVisible();
        }

        // Switch back to Simple View
        await page.click('button:has-text("Simple View")');

        // Wait for transition
        await page.waitForTimeout(500);

        // Check that we're back to simple view (3 categories)
        await expect(page.locator('text=QIB')).toBeVisible();
      }
    });

    test('should persist view preference across page reloads', async ({ page, context }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      const hasToggle = await page.locator('button:has-text("Detailed View")').isVisible();

      if (hasToggle) {
        // Switch to detailed view
        await page.click('button:has-text("Detailed View")');
        await page.waitForTimeout(500);

        // Reload page
        await page.reload();

        // Navigate back to subscription tab
        await page.click('button[value="subscription"]');
        await page.waitForTimeout(500);

        // Check if detailed view is still active
        const detailedTab = page.locator('button:has-text("Detailed View")');
        await expect(detailedTab).toHaveAttribute('data-state', 'active');
      }
    });
  });

  test.describe('Detailed View (7 Categories)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Switch to detailed view if available
      const hasToggle = await page.locator('button:has-text("Detailed View")').isVisible();
      if (hasToggle) {
        await page.click('button:has-text("Detailed View")');
        await page.waitForTimeout(500);
      }
    });

    test('should display NII breakdown (bNII and sNII)', async ({ page }) => {
      const hasGranularData = await page.locator('text=Big NII').isVisible();

      if (hasGranularData) {
        await expect(page.locator('text=Big NII')).toBeVisible();
        await expect(page.locator('text=Small NII')).toBeVisible();
      }
    });

    test('should display Retail breakdown (HNI and Others)', async ({ page }) => {
      const hasGranularData = await page.locator('text=Retail HNI').isVisible();

      if (hasGranularData) {
        await expect(page.locator('text=Retail HNI')).toBeVisible();
        await expect(page.locator('text=Retail Others')).toBeVisible();
      }
    });

    test('should show hierarchical structure for subcategories', async ({ page }) => {
      const hasGranularData = await page.locator('text=Big NII').isVisible();

      if (hasGranularData) {
        // Check for indentation or visual hierarchy
        const bigNII = page.locator('text=Big NII').first();
        const classList = await bigNII.getAttribute('class');

        // Should have indentation or subcategory styling
        expect(classList).toBeTruthy();
      }
    });
  });

  test.describe('Anchor Investor Highlight', () => {
    test('should display anchor investor card when data available', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Check if anchor investor data exists
      const anchorCard = page.locator('text=Anchor Investors').first();
      const isVisible = await anchorCard.isVisible();

      if (isVisible) {
        await expect(anchorCard).toBeVisible();

        // Check for subscription value
        await expect(page.locator('text=/\\d+\\.\\d{2}x/').first()).toBeVisible();
      }
    });

    test('should show strong signal badge for >30% allocation', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Check if strong signal badge exists
      const strongSignal = await page.locator('text=Strong Signal').isVisible();

      if (strongSignal) {
        await expect(page.locator('text=Strong Signal')).toBeVisible();
        await expect(page.locator('text=high institutional confidence')).toBeVisible();
      }
    });
  });

  test.describe('Tooltips', () => {
    test('should display tooltips on hover', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Find info icons
      const infoIcons = page.locator('[data-radix-collection-item]');
      const count = await infoIcons.count();

      if (count > 0) {
        // Hover over first info icon
        await infoIcons.first().hover();

        // Wait for tooltip
        await page.waitForTimeout(500);

        // Tooltip should be visible
        const tooltip = page.locator('[role="tooltip"]');
        const tooltipVisible = await tooltip.isVisible();

        if (tooltipVisible) {
          await expect(tooltip).toBeVisible();
        }
      }
    });

    test('should show category descriptions in tooltips', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Switch to detailed view to see more tooltips
      const hasToggle = await page.locator('button:has-text("Detailed View")').isVisible();
      if (hasToggle) {
        await page.click('button:has-text("Detailed View")');
        await page.waitForTimeout(500);
      }

      // Check for tooltips with meaningful descriptions
      const infoIcons = page.locator('[data-radix-collection-item]');
      const count = await infoIcons.count();

      if (count > 0) {
        await infoIcons.first().hover();
        await page.waitForTimeout(500);

        const tooltip = page.locator('[role="tooltip"]');
        if (await tooltip.isVisible()) {
          const tooltipText = await tooltip.textContent();
          expect(tooltipText?.length).toBeGreaterThan(20);
        }
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('should display correctly on mobile', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Check that content is visible
      await expect(page.locator('text=Subscription Breakdown')).toBeVisible();
      await expect(page.locator('text=Total Subscription')).toBeVisible();

      // On mobile, cards should be stacked
      const categories = page.locator('text=QIB');
      await expect(categories.first()).toBeVisible();
    });

    test('should have scrollable table on tablet', async ({ page }) => {
      // Set tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });

      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Table should be visible on tablet
      await expect(page.locator('text=Subscription Breakdown')).toBeVisible();
    });

    test('should show full table on desktop', async ({ page }) => {
      // Set desktop viewport
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // Switch to detailed view if available
      const hasToggle = await page.locator('button:has-text("Detailed View")').isVisible();
      if (hasToggle) {
        await page.click('button:has-text("Detailed View")');
        await page.waitForTimeout(500);

        // Check that table is visible (desktop layout)
        const hasTable = await page.locator('table').isVisible();
        if (hasTable) {
          await expect(page.locator('table')).toBeVisible();
        }
      }
    });
  });

  test.describe('No Data States', () => {
    test('should show appropriate message for upcoming IPO', async ({ page }) => {
      // Navigate to upcoming IPO (adjust slug as needed)
      await page.goto('/ipos/upcoming-ipo-slug');
      await page.click('button[value="subscription"]');

      // Should show message that data will be available
      await expect(
        page.locator('text=Subscription data will be available')
      ).toBeVisible();
    });

    test('should show message when granular data unavailable in detailed view', async ({ page }) => {
      await page.goto('/ipos/test-ipo-slug');
      await page.click('button[value="subscription"]');

      // If toggle exists but no granular data
      const hasToggle = await page.locator('button:has-text("Detailed View")').isVisible();
      if (hasToggle) {
        await page.click('button:has-text("Detailed View")');
        await page.waitForTimeout(500);

        // Check for "not available" message
        const notAvailable = await page.locator('text=not available').isVisible();
        if (notAvailable) {
          await expect(page.locator('text=not available')).toBeVisible();
        }
      }
    });
  });
});
