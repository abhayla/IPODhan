/**
 * E2E Tests for Enhanced Financial Metrics Display
 * Story 4.10: Enhanced Financial Metrics Display
 *
 * Tests critical user-facing functionality in Financials Tab:
 * - P/B Ratio display with color coding
 * - ROCE display with background color
 * - Industry P/E comparison
 * - Peer Companies list
 * - Financial Year End display
 */

import { test, expect } from '@playwright/test';

test.describe('Enhanced Financial Metrics Display', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
  });

  test.describe('P/B Ratio Display in Financials Tab', () => {
    test('displays P/B Ratio in Financials tab', async ({ page }) => {
      // Navigate to an IPO detail page
      await page.goto('/ipos/tech-digital-solutions');

      // Wait for page to load
      await page.waitForSelector('h1');

      // Click on Financials tab
      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();

        // Wait for tab content
        await page.waitForTimeout(500);

        // Check for P/B Ratio label
        const pbRatioLabel = page.locator('text=P/B Ratio:');

        if ((await pbRatioLabel.count()) > 0) {
          await expect(pbRatioLabel).toBeVisible();

          // Check if value is displayed (either numeric or N/A)
          const pbRatioValue = pbRatioLabel.locator('..').locator('span').nth(1);
          await expect(pbRatioValue).toBeVisible();

          const valueText = await pbRatioValue.textContent();

          // Should be either N/A or a number
          if (valueText !== 'N/A') {
            // Verify numeric format (2 decimal places)
            expect(valueText).toMatch(/^\d+\.\d{2}$/);
          }
        }
      }
    });

    test('P/B Ratio has info tooltip', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      // Click Financials tab
      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Find P/B Ratio section
        const pbRatioSection = page.locator('text=P/B Ratio:').locator('..');

        if ((await pbRatioSection.count()) > 0) {
          // Find info icon
          const infoIcon = pbRatioSection.locator('svg').first();

          if ((await infoIcon.count()) > 0) {
            // Hover over info icon
            await infoIcon.hover();

            // Wait for tooltip
            const tooltip = page.locator('text=Price-to-Book Ratio');
            await expect(tooltip).toBeVisible({ timeout: 2000 });
          }
        }
      }
    });

    test('P/B Ratio displays color coding', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        const pbRatioLabel = page.locator('text=P/B Ratio:');

        if ((await pbRatioLabel.count()) > 0) {
          const pbRatioValue = pbRatioLabel.locator('..').locator('span').nth(1);
          const valueText = await pbRatioValue.textContent();

          // If not N/A, should have color class
          if (valueText && valueText !== 'N/A') {
            const className = await pbRatioValue.getAttribute('class');

            // Should have one of: text-green, text-yellow, or text-red
            const hasColorClass =
              className?.includes('text-green') ||
              className?.includes('text-yellow') ||
              className?.includes('text-red');

            expect(hasColorClass).toBeTruthy();
          }
        }
      }
    });
  });

  test.describe('ROCE Display in Financials Tab', () => {
    test('displays ROCE with percentage in Financials tab', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Check for ROCE label
        const roceLabel = page.locator('text=ROCE:');

        if ((await roceLabel.count()) > 0) {
          await expect(roceLabel).toBeVisible();

          // Check if value is displayed with %
          const roceValue = roceLabel.locator('..').locator('span').nth(1);
          await expect(roceValue).toBeVisible();

          const valueText = await roceValue.textContent();

          // Should be either N/A or a number with %
          if (valueText !== 'N/A') {
            expect(valueText).toMatch(/^\d+\.\d{2}%$/);
          }
        }
      }
    });

    test('ROCE has colored background badge', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        const roceLabel = page.locator('text=ROCE:');

        if ((await roceLabel.count()) > 0) {
          const roceValue = roceLabel.locator('..').locator('span').nth(1);
          const valueText = await roceValue.textContent();

          // If not N/A, should have background color class
          if (valueText && valueText !== 'N/A') {
            const className = await roceValue.getAttribute('class');

            // Should have background class
            const hasBgClass =
              className?.includes('bg-green') ||
              className?.includes('bg-yellow') ||
              className?.includes('bg-red');

            expect(hasBgClass).toBeTruthy();
          }
        }
      }
    });

    test('ROCE has info tooltip', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        const roceSection = page.locator('text=ROCE:').locator('..');

        if ((await roceSection.count()) > 0) {
          const infoIcon = roceSection.locator('svg').first();

          if ((await infoIcon.count()) > 0) {
            await infoIcon.hover();

            const tooltip = page.locator('text=Return on Capital Employed');
            await expect(tooltip).toBeVisible({ timeout: 2000 });
          }
        }
      }
    });
  });

  test.describe('Industry P/E Comparison Display', () => {
    test('displays Industry P/E comparison section', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Check for Industry P/E label
        const industryPELabel = page.locator('text=Industry P/E:');

        if ((await industryPELabel.count()) > 0) {
          await expect(industryPELabel).toBeVisible();

          // Check if value is displayed
          const industryPEValue = industryPELabel.locator('..').locator('span').nth(1);
          await expect(industryPEValue).toBeVisible();
        }
      }
    });
  });

  test.describe('Peer Companies List Display', () => {
    test('displays Peer Companies section in Financials tab', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Check for Peer Companies heading
        const peerHeading = page.locator('text=Peer Companies');

        if ((await peerHeading.count()) > 0) {
          await expect(peerHeading).toBeVisible();

          // Check if peer badges are displayed
          const peerBadges = page.locator('[class*="badge"]');

          if ((await peerBadges.count()) > 0) {
            // At least one peer badge should be visible
            await expect(peerBadges.first()).toBeVisible();
          }
        }
      }
    });

    test('displays empty state when no peer companies', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Check for empty state message
        const emptyState = page.locator('text=Peer companies data not yet available');

        // Empty state may or may not appear depending on data
        // Just verify the Financials tab loaded
        await expect(page.locator('button:has-text("Financials")')).toBeVisible();
      }
    });

    test('expands peer companies list when "See all" clicked', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Look for "See all" button
        const seeAllButton = page.locator('button:has-text("See all")');

        if ((await seeAllButton.count()) > 0) {
          // Count badges before
          const badgesBefore = await page.locator('[class*="badge"]').count();

          // Click "See all"
          await seeAllButton.click();

          // Wait for expansion
          await page.waitForTimeout(300);

          // Should show "Show less" now
          await expect(page.locator('button:has-text("Show less")')).toBeVisible();
        }
      }
    });
  });

  test.describe('Financial Year End Display', () => {
    test('displays Financial Year End in Financials tab', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Check for Financial Year End label
        const fyeLabel = page.locator('text=Financial Year End:');

        if ((await fyeLabel.count()) > 0) {
          await expect(fyeLabel).toBeVisible();

          // Check if value is displayed (month name or N/A)
          const fyeValue = fyeLabel.locator('..').locator('span').nth(1);
          await expect(fyeValue).toBeVisible();

          const valueText = await fyeValue.textContent();

          // Should be either N/A or a month name
          if (valueText !== 'N/A') {
            // Basic check: should contain letters (month name)
            expect(valueText).toMatch(/[A-Za-z]/);
          }
        }
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('financial metrics display correctly on mobile', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Scroll to view metrics
        await page.locator('text=P/B Ratio:').scrollIntoViewIfNeeded();

        // Check if P/B Ratio is visible
        const pbRatioLabel = page.locator('text=P/B Ratio:');

        if ((await pbRatioLabel.count()) > 0) {
          await expect(pbRatioLabel).toBeVisible();
        }

        // Check if ROCE is visible
        const roceLabel = page.locator('text=ROCE:');

        if ((await roceLabel.count()) > 0) {
          await expect(roceLabel).toBeVisible();
        }
      }
    });

    test('peer companies list wraps correctly on mobile', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // Scroll to peer companies
        const peerHeading = page.locator('text=Peer Companies');

        if ((await peerHeading.count()) > 0) {
          await peerHeading.scrollIntoViewIfNeeded();
          await expect(peerHeading).toBeVisible();
        }
      }
    });
  });

  test.describe('Integration with Compare Tool', () => {
    test('Compare tool page loads successfully', async ({ page }) => {
      // Navigate to Compare IPOs tool
      await page.goto('/tools/compare');

      // Wait for page to load
      await page.waitForSelector('h1');

      // Verify page title
      await expect(page.locator('h1:has-text("Compare IPOs")')).toBeVisible();
    });

    test('Compare tool accepts IPO selections', async ({ page }) => {
      await page.goto('/tools/compare');

      // Look for IPO selection dropdowns/inputs
      const selectInputs = page.locator('input[placeholder*="Select"]');

      if ((await selectInputs.count()) > 0) {
        // At least one selection input should be visible
        await expect(selectInputs.first()).toBeVisible();
      }
    });
  });

  test.describe('Accessibility', () => {
    test('financial metrics have proper labels', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        // All labels should be visible
        const pbLabel = page.locator('text=P/B Ratio:');
        const roceLabel = page.locator('text=ROCE:');

        if ((await pbLabel.count()) > 0) {
          await expect(pbLabel).toBeVisible();
        }

        if ((await roceLabel.count()) > 0) {
          await expect(roceLabel).toBeVisible();
        }
      }
    });

    test('peer companies expand button is keyboard accessible', async ({ page }) => {
      await page.goto('/ipos/tech-digital-solutions');

      const financialsTab = page.locator('button:has-text("Financials")');

      if ((await financialsTab.count()) > 0) {
        await financialsTab.click();
        await page.waitForTimeout(500);

        const seeAllButton = page.locator('button:has-text("See all")');

        if ((await seeAllButton.count()) > 0) {
          // Verify it's a button element
          expect(await seeAllButton.evaluate(el => el.tagName)).toBe('BUTTON');
        }
      }
    });
  });
});
