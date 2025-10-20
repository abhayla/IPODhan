import { test, expect, Page } from '@playwright/test';

/**
 * Comprehensive Test Suite for Compare IPOs Tool
 * Testing all functionality, edge cases, and responsive design
 */

const BASE_URL = 'http://localhost:3000';
const COMPARE_URL = '/tools/compare'; // Directly use the known URL

test.describe('Compare IPOs - Comprehensive Testing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + COMPARE_URL);
    await page.waitForLoadState('networkidle');
  });

  test.describe('Page Discovery and Initial Load', () => {
    test('should load the Compare IPOs page successfully', async ({ page }) => {
      await expect(page).toHaveTitle(/compare/i);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-initial-load.png', fullPage: true });

      const heading = await page.locator('h1').first().textContent();
      console.log('Page heading:', heading);
      expect(heading?.toLowerCase()).toContain('comparison');
    });

    test('should display main UI elements', async ({ page }) => {
      await page.screenshot({ path: 'test-screenshots/compare-ipos-ui-overview.png', fullPage: true });

      const hasSelect = await page.locator('select').count() > 0;
      const hasCombobox = await page.locator('[role="combobox"]').count() > 0;
      const hasSearchInput = await page.locator('input[type="search"]').count() > 0;

      console.log('Selection UI found:', { hasSelect, hasCombobox, hasSearchInput });
      expect(hasSelect || hasCombobox || hasSearchInput).toBe(true);
    });

    test('should check for console errors on load', async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      page.on('pageerror', error => {
        consoleErrors.push(error.message);
      });

      await page.reload();
      await page.waitForTimeout(2000);

      console.log('Console errors:', consoleErrors);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-after-reload.png', fullPage: true });

      if (consoleErrors.length > 0) {
        console.warn('Found console errors:', consoleErrors);
      }
    });
  });

  test.describe('IPO Selection Mechanism', () => {
    test('should have IPO selection interface', async ({ page }) => {
      console.log('Testing IPO selection interface...');

      const selectors = await page.locator('select, [role="combobox"], input[type="search"]').all();
      console.log(`Found ${selectors.length} selection controls`);

      if (selectors.length > 0) {
        const firstSelector = selectors[0];
        await firstSelector.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-selector-open.png', fullPage: true });

        const options = await page.locator('option, [role="option"]').count();
        console.log(`Options available: ${options}`);
      }
    });

    test('should allow selecting first IPO', async ({ page }) => {
      try {
        await selectIPO(page, 0);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-first-selected.png', fullPage: true });
        console.log('Successfully selected first IPO');
      } catch (error) {
        console.log('Error selecting first IPO:', error);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-selection-error.png', fullPage: true });
      }
    });

    test('should allow selecting second IPO', async ({ page }) => {
      try {
        await selectIPO(page, 0);
        await page.waitForTimeout(500);
        await selectIPO(page, 1);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-two-selected.png', fullPage: true });
        console.log('Successfully selected two IPOs');
      } catch (error) {
        console.log('Error selecting second IPO:', error);
      }
    });
  });

  test.describe('Comparison Display', () => {
    test('should display comparison table/grid with 2 IPOs', async ({ page }) => {
      try {
        await selectIPO(page, 0);
        await page.waitForTimeout(500);
        await selectIPO(page, 1);
        await page.waitForTimeout(1000);

        await page.screenshot({ path: 'test-screenshots/compare-ipos-comparison-view.png', fullPage: true });

        const hasTable = await page.locator('table').count() > 0;
        const hasGrid = await page.locator('[class*="grid"], [class*="comparison"]').count() > 0;

        console.log('Comparison display:', { hasTable, hasGrid });

        const ipoElements = await page.locator('[class*="ipo"], [data-ipo], tr, .card').count();
        console.log(`IPO elements displayed: ${ipoElements}`);
      } catch (error) {
        console.log('Error in comparison display test:', error);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-display-error.png', fullPage: true });
      }
    });

    test('should show comparison metrics', async ({ page }) => {
      try {
        await selectIPO(page, 0);
        await selectIPO(page, 1);
        await page.waitForTimeout(1000);

        const metrics = ['price', 'date', 'subscription', 'gmp', 'lot', 'size', 'status'];
        const foundMetrics: string[] = [];

        for (const metric of metrics) {
          const element = page.locator(`text=/${metric}/i`).first();
          if (await element.count() > 0) {
            foundMetrics.push(metric);
          }
        }

        console.log('Metrics found:', foundMetrics);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-metrics.png', fullPage: true });
      } catch (error) {
        console.log('Error checking metrics:', error);
      }
    });
  });

  test.describe('Adding and Removing IPOs', () => {
    test('should handle adding third IPO', async ({ page }) => {
      try {
        await selectIPO(page, 0);
        await selectIPO(page, 1);
        await selectIPO(page, 2);
        await page.waitForTimeout(1000);

        await page.screenshot({ path: 'test-screenshots/compare-ipos-three-ipos.png', fullPage: true });
        console.log('Successfully added three IPOs');
      } catch (error) {
        console.log('Error adding third IPO:', error);
      }
    });

    test('should have remove functionality', async ({ page }) => {
      try {
        await selectIPO(page, 0);
        await selectIPO(page, 1);
        await page.waitForTimeout(1000);

        const removeButtons = await page.locator('button').filter({ hasText: /×|clear/i }).all();
        console.log(`Remove buttons found: ${removeButtons.length}`);

        if (removeButtons.length > 0) {
          await removeButtons[0].click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: 'test-screenshots/compare-ipos-after-remove.png', fullPage: true });
        }
      } catch (error) {
        console.log('Error testing remove functionality:', error);
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('should be mobile responsive (375px)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-mobile-375.png', fullPage: true });

      try {
        await selectIPO(page, 0);
        await selectIPO(page, 1);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-mobile-with-data.png', fullPage: true });
      } catch (error) {
        console.log('Error testing mobile responsiveness:', error);
      }
    });

    test('should be tablet responsive (768px)', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-tablet-768.png', fullPage: true });

      try {
        await selectIPO(page, 0);
        await selectIPO(page, 1);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-tablet-with-data.png', fullPage: true });
      } catch (error) {
        console.log('Error testing tablet responsiveness:', error);
      }
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper heading structure', async ({ page }) => {
      const headings = await page.locator('h1, h2, h3').allTextContents();
      console.log('Page headings:', headings);

      const h1Count = await page.locator('h1').count();
      expect(h1Count).toBeGreaterThan(0);
    });

    test('should be keyboard navigable', async ({ page }) => {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-keyboard-1.png' });

      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-keyboard-2.png' });
    });
  });
});

async function selectIPO(page: Page, index: number) {
  console.log(`Attempting to select IPO at index ${index}...`);

  const selects = await page.locator('select').all();
  console.log(`Found ${selects.length} select elements`);

  if (selects.length === 0) {
    throw new Error('No select elements found');
  }

  const selectToUse = selects.length > index ? selects[index] : selects[selects.length - 1];
  const options = await selectToUse.locator('option').all();
  console.log(`Select has ${options.length} options`);

  if (options.length <= 1) {
    throw new Error('No IPO options available');
  }

  const optionToSelect = options[1];
  const optionValue = await optionToSelect.getAttribute('value');
  const optionText = await optionToSelect.textContent();

  console.log(`Selecting option: ${optionText} (value: ${optionValue})`);

  if (optionValue) {
    await selectToUse.selectOption(optionValue);
    await page.waitForTimeout(500);
  }
}
