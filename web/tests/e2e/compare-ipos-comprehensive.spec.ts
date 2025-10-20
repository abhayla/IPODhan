import { test, expect, Page } from '@playwright/test';

/**
 * Comprehensive Test Suite for Compare IPOs Tool
 * Testing all functionality, edge cases, and responsive design
 */

const BASE_URL = 'http://localhost:3000';
const POSSIBLE_URLS = [
  '/tools/compare-ipos',
  '/compare',
  '/compare-ipos',
  '/tools/compare',
];

let compareIposUrl: string | null = null;

test.describe('Compare IPOs - Feature Discovery', () => {
  test('should find the Compare IPOs feature', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    console.log('\n=== CHECKING HOMEPAGE ===');
    await page.screenshot({ path: 'test-screenshots/compare-ipos-homepage.png', fullPage: true });

    // Check navigation menu
    console.log('Checking navigation menu...');
    const navLinks = await page.locator('nav a, header a').allTextContents();
    console.log('Navigation links found:', navLinks);

    // Check for Tools dropdown
    const toolsDropdown = page.locator('text=/tools/i').or(page.locator('[href*="tools"]')).first();
    if (await toolsDropdown.count() > 0) {
      console.log('Found Tools section in navigation');
      await toolsDropdown.hover();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-tools-dropdown.png' });

      const dropdownItems = await page.locator('[role="menu"] a, .dropdown a, nav ul ul a').allTextContents();
      console.log('Dropdown items:', dropdownItems);
    }

    // Check footer
    console.log('\nChecking footer...');
    const footerLinks = await page.locator('footer a').allTextContents();
    console.log('Footer links found:', footerLinks);
    await page.screenshot({ path: 'test-screenshots/compare-ipos-footer.png' });

    // Try common URLs
    console.log('\n=== TRYING COMMON URLs ===');
    for (const url of POSSIBLE_URLS) {
      console.log(`Trying: ${BASE_URL}${url}`);
      const response = await page.goto(BASE_URL + url);
      await page.waitForTimeout(1000);

      if (response?.status() === 200) {
        const title = await page.title();
        const heading = await page.locator('h1').first().textContent().catch(() => '');
        console.log(`✓ Found at ${url} - Title: ${title}, Heading: ${heading}`);

        if (title.toLowerCase().includes('compare') || heading?.toLowerCase().includes('compare')) {
          compareIposUrl = url;
          await page.screenshot({ path: 'test-screenshots/compare-ipos-found.png', fullPage: true });
          console.log(`\n✓✓✓ COMPARE IPOs FEATURE FOUND AT: ${url} ✓✓✓\n`);
          break;
        }
      } else {
        console.log(`✗ Not found at ${url} (Status: ${response?.status()})`);
      }
    }

    if (!compareIposUrl) {
      console.log('\n✗✗✗ COMPARE IPOs FEATURE NOT FOUND ✗✗✗');
      console.log('The feature does not exist at any common URLs');
      console.log('Suggestion: Add Compare IPOs feature to the Tools menu or footer');
    }

    // Store the result for other tests
    test.info().annotations.push({ type: 'compare-url', description: compareIposUrl || 'NOT_FOUND' });
  });
});

test.describe('Compare IPOs - Comprehensive Testing', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if feature not found
    if (!compareIposUrl) {
      test.skip();
    }
    await page.goto(BASE_URL + compareIposUrl!);
    await page.waitForLoadState('networkidle');
  });

  test.describe('Page Load and UI Rendering', () => {
    test('should load the page successfully', async ({ page }) => {
      await expect(page).toHaveTitle(/compare/i);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-initial-load.png', fullPage: true });

      // Check for console errors
      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.waitForTimeout(2000);
      console.log('Console errors:', consoleErrors);
      expect(consoleErrors.length).toBe(0);
    });

    test('should display main UI elements', async ({ page }) => {
      // Check for IPO selection mechanism
      const selectionElement = page.locator('select, input[type="search"], [role="combobox"], .select, .dropdown').first();
      await expect(selectionElement).toBeVisible({ timeout: 5000 });

      // Check for comparison display area
      const comparisonArea = page.locator('[class*="comparison"], [class*="compare"], table, .grid').first();
      await expect(comparisonArea).toBeVisible({ timeout: 5000 });

      await page.screenshot({ path: 'test-screenshots/compare-ipos-ui-elements.png', fullPage: true });
    });
  });

  test.describe('IPO Selection Mechanism', () => {
    test('should allow selecting IPOs', async ({ page }) => {
      console.log('Testing IPO selection...');

      // Find the selection control
      const selector = page.locator('select, input[type="search"], [role="combobox"]').first();
      await selector.click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-screenshots/compare-ipos-selection-open.png', fullPage: true });

      // Try to select an IPO
      const options = page.locator('option, [role="option"], li').filter({ hasText: /IPO|limited|corp/i });
      const optionCount = await options.count();
      console.log(`Found ${optionCount} IPO options`);

      if (optionCount > 0) {
        await options.first().click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-first-selected.png', fullPage: true });
      }
    });

    test('should search for IPOs', async ({ page }) => {
      const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="IPO" i]').first();

      if (await searchInput.count() > 0) {
        await searchInput.fill('tech');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-search.png', fullPage: true });

        // Check if filtered results appear
        const results = page.locator('[role="option"], li, .option');
        const resultCount = await results.count();
        console.log(`Search returned ${resultCount} results`);
      }
    });
  });

  test.describe('Adding Multiple IPOs', () => {
    test('should add 2 IPOs to comparison', async ({ page }) => {
      await addIPOsToComparison(page, 2);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-2-ipos.png', fullPage: true });

      // Verify 2 IPOs are displayed
      const ipoCards = page.locator('[class*="ipo"], [data-ipo], tr, .card').filter({ hasText: /IPO|company|limited/i });
      const count = await ipoCards.count();
      console.log(`IPOs in comparison: ${count}`);
      expect(count).toBeGreaterThanOrEqual(2);
    });

    test('should add 3 IPOs to comparison', async ({ page }) => {
      await addIPOsToComparison(page, 3);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-3-ipos.png', fullPage: true });

      const ipoCards = page.locator('[class*="ipo"], [data-ipo], tr, .card').filter({ hasText: /IPO|company|limited/i });
      const count = await ipoCards.count();
      console.log(`IPOs in comparison: ${count}`);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    test('should handle maximum IPOs allowed', async ({ page }) => {
      // Try adding many IPOs
      await addIPOsToComparison(page, 5);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-max-ipos.png', fullPage: true });

      // Check if there's a limit message
      const limitMessage = page.locator('text=/maximum|limit|max.*ipo/i');
      if (await limitMessage.count() > 0) {
        const text = await limitMessage.textContent();
        console.log('Limit message:', text);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-limit-message.png' });
      }
    });
  });

  test.describe('Comparison Display', () => {
    test('should display comparison metrics', async ({ page }) => {
      await addIPOsToComparison(page, 2);

      // Check for common comparison metrics
      const metrics = [
        /price/i,
        /date/i,
        /subscription/i,
        /gmp/i,
        /lot/i,
        /size/i,
        /status/i,
      ];

      const foundMetrics: string[] = [];
      for (const metric of metrics) {
        const element = page.locator(`th, td, label, .label`).filter({ hasText: metric }).first();
        if (await element.count() > 0) {
          const text = await element.textContent();
          foundMetrics.push(text || '');
        }
      }

      console.log('Comparison metrics found:', foundMetrics);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-metrics.png', fullPage: true });

      expect(foundMetrics.length).toBeGreaterThan(0);
    });

    test('should display data for each IPO', async ({ page }) => {
      await addIPOsToComparison(page, 2);

      // Check if each IPO has data
      const cells = page.locator('td, .value, [class*="data"]');
      const cellCount = await cells.count();
      console.log(`Data cells found: ${cellCount}`);

      expect(cellCount).toBeGreaterThan(0);
    });
  });

  test.describe('Remove and Clear Functionality', () => {
    test('should remove IPO from comparison', async ({ page }) => {
      await addIPOsToComparison(page, 2);

      // Look for remove button
      const removeBtn = page.locator('button, a').filter({ hasText: /remove|delete|×|✕/i }).first();

      if (await removeBtn.count() > 0) {
        const beforeCount = await page.locator('[class*="ipo"], [data-ipo], tr').count();
        await removeBtn.click();
        await page.waitForTimeout(500);
        const afterCount = await page.locator('[class*="ipo"], [data-ipo], tr').count();

        console.log(`IPOs before: ${beforeCount}, after: ${afterCount}`);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-after-remove.png', fullPage: true });

        expect(afterCount).toBeLessThan(beforeCount);
      }
    });

    test('should clear all comparisons', async ({ page }) => {
      await addIPOsToComparison(page, 3);

      const clearBtn = page.locator('button, a').filter({ hasText: /clear|reset|remove all/i }).first();

      if (await clearBtn.count() > 0) {
        await clearBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-after-clear.png', fullPage: true });

        // Check if comparison is empty
        const emptyMessage = page.locator('text=/no.*ipo|select.*ipo|empty/i');
        if (await emptyMessage.count() > 0) {
          console.log('Clear successful - empty state shown');
        }
      }
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle single IPO selection', async ({ page }) => {
      await addIPOsToComparison(page, 1);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-single-ipo.png', fullPage: true });

      // Check for message about minimum IPOs
      const message = page.locator('text=/select.*more|minimum|at least/i');
      if (await message.count() > 0) {
        const text = await message.textContent();
        console.log('Single IPO message:', text);
      }
    });

    test('should handle IPOs with different statuses', async ({ page }) => {
      // Try to select IPOs with different statuses
      await addIPOsToComparison(page, 3);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-mixed-status.png', fullPage: true });

      // Check if status is displayed for each
      const statusElements = page.locator('text=/open|upcoming|listed|closed/i');
      const statusCount = await statusElements.count();
      console.log(`Status indicators found: ${statusCount}`);
    });

    test('should handle missing data gracefully', async ({ page }) => {
      await addIPOsToComparison(page, 2);

      // Look for N/A, dash, or empty cells
      const naElements = page.locator('text=/n\\/a|—|-|not available/i');
      const naCount = await naElements.count();
      console.log(`Missing data indicators: ${naCount}`);

      await page.screenshot({ path: 'test-screenshots/compare-ipos-missing-data.png', fullPage: true });
    });
  });

  test.describe('Export/Share Functionality', () => {
    test('should check for export options', async ({ page }) => {
      await addIPOsToComparison(page, 2);

      const exportBtn = page.locator('button, a').filter({ hasText: /export|download|share|pdf|csv/i });
      const exportCount = await exportBtn.count();

      if (exportCount > 0) {
        console.log('Export functionality found');
        await exportBtn.first().click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'test-screenshots/compare-ipos-export.png', fullPage: true });
      } else {
        console.log('No export functionality found');
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('should be mobile responsive (375px)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-mobile-375.png', fullPage: true });

      // Check if content is accessible
      const mainContent = page.locator('main, [role="main"], body > div').first();
      await expect(mainContent).toBeVisible();

      // Try to select IPOs on mobile
      await addIPOsToComparison(page, 2);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-mobile-with-data.png', fullPage: true });
    });

    test('should be tablet responsive (768px)', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-tablet-768.png', fullPage: true });

      await addIPOsToComparison(page, 2);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-tablet-with-data.png', fullPage: true });
    });

    test('should be responsive on large screens (1920px)', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-desktop-1920.png', fullPage: true });

      await addIPOsToComparison(page, 3);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-desktop-with-data.png', fullPage: true });
    });
  });

  test.describe('API and Performance', () => {
    test('should track API calls', async ({ page }) => {
      const apiCalls: any[] = [];

      page.on('request', request => {
        if (request.url().includes('/api/')) {
          apiCalls.push({
            url: request.url(),
            method: request.method(),
          });
        }
      });

      page.on('response', async response => {
        if (response.url().includes('/api/')) {
          console.log(`API: ${response.request().method()} ${response.url()} - ${response.status()} (${await response.finished()}ms)`);
        }
      });

      await page.reload();
      await addIPOsToComparison(page, 2);
      await page.waitForTimeout(2000);

      console.log('API calls made:', apiCalls);
    });

    test('should check for JavaScript errors', async ({ page }) => {
      const jsErrors: string[] = [];
      const warnings: string[] = [];

      page.on('console', msg => {
        if (msg.type() === 'error') {
          jsErrors.push(msg.text());
        } else if (msg.type() === 'warning') {
          warnings.push(msg.text());
        }
      });

      page.on('pageerror', error => {
        jsErrors.push(error.message);
      });

      await page.reload();
      await addIPOsToComparison(page, 2);
      await page.waitForTimeout(2000);

      console.log('JavaScript Errors:', jsErrors);
      console.log('Warnings:', warnings);

      expect(jsErrors.length).toBe(0);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper heading structure', async ({ page }) => {
      const h1 = await page.locator('h1').count();
      expect(h1).toBeGreaterThan(0);

      const headings = await page.locator('h1, h2, h3, h4, h5, h6').allTextContents();
      console.log('Page headings:', headings);
    });

    test('should have accessible form controls', async ({ page }) => {
      const inputs = page.locator('input, select, button');
      const inputCount = await inputs.count();

      console.log(`Form controls found: ${inputCount}`);

      // Check for labels
      const labels = await page.locator('label').count();
      console.log(`Labels found: ${labels}`);
    });

    test('should be keyboard navigable', async ({ page }) => {
      // Try tabbing through the interface
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-keyboard-nav-1.png' });

      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'test-screenshots/compare-ipos-keyboard-nav-2.png' });
    });
  });
});

/**
 * Helper function to add IPOs to comparison
 */
async function addIPOsToComparison(page: Page, count: number) {
  console.log(`Attempting to add ${count} IPOs to comparison...`);

  for (let i = 0; i < count; i++) {
    try {
      // Find selection control
      const selector = page.locator('select, input[type="search"], [role="combobox"], button').filter({ hasText: /select|add|choose/i }).first();

      if (await selector.count() === 0) {
        console.log('No selector found, trying alternative approach...');
        const anySelector = page.locator('select, input, [role="combobox"]').first();
        await anySelector.click();
      } else {
        await selector.click();
      }

      await page.waitForTimeout(500);

      // Select an option
      const options = page.locator('option, [role="option"], li').filter({ hasText: /IPO|limited|corp/i });
      const optionCount = await options.count();

      if (optionCount > i) {
        await options.nth(i).click();
        await page.waitForTimeout(500);
        console.log(`Added IPO ${i + 1}`);
      } else {
        console.log(`Not enough IPO options available (found ${optionCount}, need ${i + 1})`);
        break;
      }
    } catch (error) {
      console.log(`Error adding IPO ${i + 1}:`, error);
    }
  }
}
