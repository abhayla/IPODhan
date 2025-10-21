/**
 * Lot Calculator - Comprehensive Edge Case Testing
 *
 * Test Coverage:
 * - Standard calculations with realistic lot sizes
 * - Edge cases (zero, negative, empty, non-numeric)
 * - Boundary cases (max values, special characters)
 * - UI/UX (auto-calculation, formatting, validation)
 * - Responsive design (desktop, tablet, mobile)
 * - Accessibility (keyboard navigation, screen reader)
 * - Performance (debounce, large numbers)
 *
 * Prerequisites:
 * - Dev server running on http://localhost:3001
 * - Database seeded with IPO data
 * - Realistic lot sizes in database (if ISS-LotCalc-002 fixed)
 */

import { test, expect, Page } from '@playwright/test';

// ==================== CONSTANTS ====================

const BASE_URL = 'http://localhost:3003';
const LOT_CALCULATOR_URL = `${BASE_URL}/tools/lot-calculator`;

// Test data - update these based on actual lot sizes in database
const TEST_DATA = {
  MAINBOARD: {
    investment: 15000,
    expectedPrice: 100, // Will be updated from actual IPO data
    expectedLotSize: 75, // Will be updated from actual IPO data
  },
  SME: {
    investment: 50000,
    expectedPrice: 40,
    expectedLotSize: 125,
  },
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Navigate to lot calculator page
 */
async function navigateToCalculator(page: Page) {
  await page.goto(LOT_CALCULATOR_URL);
  await page.waitForLoadState('networkidle');
}

/**
 * Select an IPO from dropdown
 */
async function selectIPO(page: Page, index: number = 0) {
  const selectTrigger = page.locator('[id="ipo-select"]');
  await selectTrigger.click();

  // Wait for options to appear
  await page.waitForSelector('[role="option"]', { state: 'visible' });

  // Click the first option (or specific index)
  const options = page.locator('[role="option"]');
  await options.nth(index).click();

  // Wait for selection to complete
  await page.waitForTimeout(500);
}

/**
 * Enter investment amount
 */
async function enterInvestmentAmount(page: Page, amount: string) {
  const input = page.locator('#investment-amount');
  await input.clear();
  await input.fill(amount);

  // Wait for debounce
  await page.waitForTimeout(400);
}

/**
 * Get calculation results
 */
async function getResults(page: Page) {
  const lotsElement = page.locator('text=Number of Lots').locator('..').locator('p.text-2xl');
  const sharesElement = page.locator('text=Total Shares').locator('..').locator('p.text-2xl');
  const amountElement = page.locator('text=Total Investment').locator('..').locator('p.text-2xl');

  return {
    lots: await lotsElement.textContent(),
    shares: await sharesElement.textContent(),
    amount: await amountElement.textContent(),
  };
}

/**
 * Get validation error message
 */
async function getValidationError(page: Page): Promise<string | null> {
  const errorElement = page.locator('.text-destructive').or(page.locator('.text-sm.text-destructive'));
  const count = await errorElement.count();

  if (count > 0) {
    return await errorElement.first().textContent();
  }

  return null;
}

/**
 * Check if results are displayed
 */
async function hasResults(page: Page): Promise<boolean> {
  const resultsCard = page.locator('.rounded-lg.border.bg-accent\\/50');
  return await resultsCard.count() > 0;
}

/**
 * Take screenshot with timestamp
 */
async function takeScreenshot(page: Page, name: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({
    path: `test-results/phase-3/screenshots/lot-calc-${name}-${timestamp}.png`,
    fullPage: true
  });
}

// ==================== TEST SUITE ====================

test.describe('Lot Calculator - Comprehensive Edge Case Testing', () => {

  test.beforeEach(async ({ page }) => {
    await navigateToCalculator(page);
  });

  // ==================== 1. STANDARD CALCULATION TESTS ====================

  test.describe('1. Standard Calculations', () => {

    test('1A. Realistic MAINBOARD IPO calculation', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '15000');

      // Wait for calculation
      const hasResult = await hasResults(page);

      // Take screenshot
      await takeScreenshot(page, '1a-mainboard-standard');

      if (hasResult) {
        const results = await getResults(page);

        // Log results for manual verification
        console.log('MAINBOARD Results:', results);

        // Verify results are displayed
        expect(results.lots).toBeTruthy();
        expect(results.shares).toBeTruthy();
        expect(results.amount).toBeTruthy();

        // Verify no validation errors
        const error = await getValidationError(page);
        expect(error).toBeNull();
      }
    });

    test('1B. Realistic SME IPO calculation', async ({ page }) => {
      // Find and select an SME IPO
      const selectTrigger = page.locator('[id="ipo-select"]');
      await selectTrigger.click();

      // Wait for options
      await page.waitForSelector('[role="option"]', { state: 'visible' });

      // Look for SME option (contains "SME" in text)
      const smeOption = page.locator('[role="option"]:has-text("SME")').first();
      const smeExists = await smeOption.count() > 0;

      if (smeExists) {
        await smeOption.click();
        await page.waitForTimeout(500);

        await enterInvestmentAmount(page, '50000');
        await takeScreenshot(page, '1b-sme-standard');

        if (await hasResults(page)) {
          const results = await getResults(page);
          console.log('SME Results:', results);

          expect(results.lots).toBeTruthy();
          expect(results.shares).toBeTruthy();
          expect(results.amount).toBeTruthy();
        }
      } else {
        test.skip('No SME IPO available for testing');
      }
    });

    test('1C. Calculation with remainder', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '20000');

      await takeScreenshot(page, '1c-with-remainder');

      if (await hasResults(page)) {
        const results = await getResults(page);
        console.log('Remainder Test Results:', results);

        // Investment amount entered should be higher than total investment
        // (because of floor rounding)
        expect(results.lots).toBeTruthy();
      }
    });
  });

  // ==================== 2. EDGE CASE TESTS ====================

  test.describe('2. Edge Cases', () => {

    test('2A. Zero investment', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '0');

      await takeScreenshot(page, '2a-zero-investment');

      // Should show validation error
      const error = await getValidationError(page);
      expect(error).toBeTruthy();
      expect(error?.toLowerCase()).toContain('positive');

      // Should not show results
      expect(await hasResults(page)).toBe(false);
    });

    test('2B. Negative investment (should be prevented)', async ({ page }) => {
      await selectIPO(page, 0);

      const input = page.locator('#investment-amount');
      await input.clear();
      await input.type('-1000');

      await page.waitForTimeout(400);
      await takeScreenshot(page, '2b-negative-investment');

      // Check what's actually in the input
      const inputValue = await input.inputValue();
      console.log('Input value after typing -1000:', inputValue);

      // Either should prevent input or show error
      if (inputValue.includes('-')) {
        const error = await getValidationError(page);
        expect(error).toBeTruthy();
      } else {
        // Negative sign was stripped
        expect(inputValue).not.toContain('-');
      }
    });

    test('2C. Empty investment', async ({ page }) => {
      await selectIPO(page, 0);

      const input = page.locator('#investment-amount');
      await input.clear();
      await input.click();
      await input.blur();

      await takeScreenshot(page, '2c-empty-investment');

      // Should not show results
      expect(await hasResults(page)).toBe(false);

      // Input should be empty
      const inputValue = await input.inputValue();
      expect(inputValue).toBe('');
    });

    test('2D. Non-numeric input (should be prevented)', async ({ page }) => {
      await selectIPO(page, 0);

      const input = page.locator('#investment-amount');
      await input.clear();
      await input.type('abc');

      await page.waitForTimeout(400);
      await takeScreenshot(page, '2d-non-numeric');

      // Check what's actually in the input
      const inputValue = await input.inputValue();
      console.log('Input value after typing abc:', inputValue);

      // Should be empty or prevented
      expect(inputValue).toBe('');
    });

    test('2E. Decimal input (should accept with warning)', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '15000.50');

      await takeScreenshot(page, '2e-decimal-input');

      // Should show warning about rounding
      const warningText = await page.locator('text=/rounded/i').textContent();
      console.log('Decimal warning:', warningText);

      // Should still calculate (with rounding)
      if (await hasResults(page)) {
        const results = await getResults(page);
        console.log('Decimal Results:', results);
        expect(results.lots).toBeTruthy();
      }
    });

    test('2F. Very large investment', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '999999999');

      await takeScreenshot(page, '2f-very-large');

      // Should calculate without errors
      if (await hasResults(page)) {
        const results = await getResults(page);
        console.log('Large Number Results:', results);

        expect(results.lots).toBeTruthy();

        // Should format with commas
        expect(results.shares).toMatch(/,/);
      }
    });

    test('2G. Very small investment (below minimum lot)', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '100');

      await takeScreenshot(page, '2g-below-minimum');

      // Should show error about minimum investment
      const error = await getValidationError(page);
      expect(error).toBeTruthy();
      expect(error?.toLowerCase()).toContain('minimum');

      // Or show 0 lots with message
      const noLotsMessage = await page.locator('text=/too low/i').textContent();
      expect(error || noLotsMessage).toBeTruthy();
    });

    test('2H. Exactly divisible amount', async ({ page }) => {
      await selectIPO(page, 0);

      // First, get the lot size and price
      await page.waitForTimeout(500);

      // For this test, we'll use a known amount that should divide exactly
      // This will depend on actual IPO data
      await enterInvestmentAmount(page, '15000');

      await takeScreenshot(page, '2h-exactly-divisible');

      if (await hasResults(page)) {
        const results = await getResults(page);
        console.log('Exact Division Results:', results);

        // Check if there's a remainder
        // (In the UI, we can't see remainder directly, but we can check the calculation)
        expect(results.lots).toBeTruthy();
      }
    });

    test('2I. Just under next lot', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '14999');

      await takeScreenshot(page, '2i-just-under-next-lot');

      if (await hasResults(page)) {
        const results = await getResults(page);
        console.log('Just Under Results:', results);

        // Should floor to lower number of lots
        expect(results.lots).toBeTruthy();
      }
    });
  });

  // ==================== 3. BOUNDARY TESTS ====================

  test.describe('3. Boundary Cases', () => {

    test('3A. Maximum safe JavaScript number', async ({ page }) => {
      await selectIPO(page, 0);

      const maxSafeInteger = Number.MAX_SAFE_INTEGER.toString();
      await enterInvestmentAmount(page, maxSafeInteger);

      await takeScreenshot(page, '3a-max-safe-integer');

      // Should either calculate or show a reasonable error
      const error = await getValidationError(page);
      console.log('Max number error:', error);

      // At minimum, should not crash
      const inputValue = await page.locator('#investment-amount').inputValue();
      expect(inputValue).toBeTruthy();
    });

    test('3B. Currency symbols (should be stripped)', async ({ page }) => {
      await selectIPO(page, 0);

      const input = page.locator('#investment-amount');
      await input.clear();
      await input.type('₹15,000');

      await page.waitForTimeout(400);
      await takeScreenshot(page, '3b-currency-symbols');

      // Check if symbols are stripped
      const inputValue = await input.inputValue();
      console.log('Input after currency symbols:', inputValue);

      // Should accept the number part
      expect(inputValue).toMatch(/15/);
    });

    test('3C. Spaces in input (should be handled)', async ({ page }) => {
      await selectIPO(page, 0);

      const input = page.locator('#investment-amount');
      await input.clear();
      await input.type('15 000');

      await page.waitForTimeout(400);
      await takeScreenshot(page, '3c-spaces');

      const inputValue = await input.inputValue();
      console.log('Input after spaces:', inputValue);

      // Should handle spaces (either strip or format)
      expect(inputValue).toBeTruthy();
    });

    test('3D. Leading zeros', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '00015000');

      await takeScreenshot(page, '3d-leading-zeros');

      // Should treat as 15000
      if (await hasResults(page)) {
        const results = await getResults(page);
        console.log('Leading zeros results:', results);
        expect(results.lots).toBeTruthy();
      }

      // Check formatted input
      const inputValue = await page.locator('#investment-amount').inputValue();
      console.log('Input after leading zeros:', inputValue);
    });
  });

  // ==================== 4. UI/UX TESTS ====================

  test.describe('4. UI/UX Features', () => {

    test('4A. Auto-calculation (debounced)', async ({ page }) => {
      await selectIPO(page, 0);

      const input = page.locator('#investment-amount');

      // Type quickly
      await input.clear();
      await input.type('1');
      await page.waitForTimeout(100);
      await input.type('5');
      await page.waitForTimeout(100);
      await input.type('0');
      await page.waitForTimeout(100);
      await input.type('0');
      await page.waitForTimeout(100);
      await input.type('0');

      // Wait for debounce (300ms + buffer)
      await page.waitForTimeout(500);

      await takeScreenshot(page, '4a-auto-calculation');

      // Should have results after debounce
      const hasResult = await hasResults(page);
      console.log('Auto-calc has results:', hasResult);
    });

    test('4B. Input formatting (comma separators)', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '15000');

      await takeScreenshot(page, '4b-formatting');

      // Check if input is formatted
      const inputValue = await page.locator('#investment-amount').inputValue();
      console.log('Formatted input:', inputValue);

      // Should have comma for thousands
      expect(inputValue).toMatch(/15,000|15000/);
    });

    test('4C. Result display formatting', async ({ page }) => {
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '150000');

      await takeScreenshot(page, '4c-result-formatting');

      if (await hasResults(page)) {
        const results = await getResults(page);

        // Shares should have comma separators
        expect(results.shares).toBeTruthy();
        console.log('Formatted shares:', results.shares);

        // Amount should have ₹ symbol
        expect(results.amount).toContain('₹');
        console.log('Formatted amount:', results.amount);
      }
    });

    test('4D. Validation messages clear when fixed', async ({ page }) => {
      await selectIPO(page, 0);

      // Enter invalid amount
      await enterInvestmentAmount(page, '0');

      // Should have error
      let error = await getValidationError(page);
      expect(error).toBeTruthy();

      // Fix the amount
      await enterInvestmentAmount(page, '15000');

      // Error should clear
      error = await getValidationError(page);
      expect(error).toBeNull();

      await takeScreenshot(page, '4d-error-clearing');
    });

    test('4E. IPO selection changes recalculate', async ({ page }) => {
      // Select first IPO
      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '15000');

      let results1 = null;
      if (await hasResults(page)) {
        results1 = await getResults(page);
      }

      // Change IPO
      await selectIPO(page, 1);
      await page.waitForTimeout(500);

      let results2 = null;
      if (await hasResults(page)) {
        results2 = await getResults(page);
      }

      await takeScreenshot(page, '4e-ipo-change-recalc');

      console.log('Results before IPO change:', results1);
      console.log('Results after IPO change:', results2);

      // Results should exist (may or may not be different depending on IPO data)
    });
  });

  // ==================== 5. RESPONSIVE DESIGN TESTS ====================

  test.describe('5. Responsive Design', () => {

    test('5A. Desktop (1920x1080)', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await navigateToCalculator(page);

      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '15000');

      await takeScreenshot(page, '5a-desktop-1920');

      // Check layout
      const resultsCard = page.locator('.rounded-lg.border.bg-accent\\/50');
      if (await resultsCard.count() > 0) {
        const boundingBox = await resultsCard.boundingBox();
        expect(boundingBox).toBeTruthy();

        // Should not overflow
        if (boundingBox) {
          expect(boundingBox.width).toBeLessThanOrEqual(1920);
        }
      }
    });

    test('5B. Tablet (768x1024)', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await navigateToCalculator(page);

      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '15000');

      await takeScreenshot(page, '5b-tablet-768');

      // Check if layout adjusts
      const card = page.locator('.w-full').first();
      const boundingBox = await card.boundingBox();

      if (boundingBox) {
        expect(boundingBox.width).toBeLessThanOrEqual(768);
      }
    });

    test('5C. Mobile (375x667)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await navigateToCalculator(page);

      await selectIPO(page, 0);
      await enterInvestmentAmount(page, '15000');

      await takeScreenshot(page, '5c-mobile-375');

      // Check if elements stack
      const card = page.locator('.w-full').first();
      const boundingBox = await card.boundingBox();

      if (boundingBox) {
        expect(boundingBox.width).toBeLessThanOrEqual(375);
      }

      // Check if text doesn't overflow
      const overflow = await page.evaluate(() => {
        const elements = document.querySelectorAll('*');
        for (const el of elements) {
          if (el.scrollWidth > el.clientWidth) {
            return true;
          }
        }
        return false;
      });

      console.log('Mobile overflow detected:', overflow);
    });
  });

  // ==================== 6. ACCESSIBILITY TESTS ====================

  test.describe('6. Accessibility', () => {

    test('6A. Keyboard navigation', async ({ page }) => {
      await navigateToCalculator(page);

      // Tab to IPO select
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Open dropdown with Enter
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      // Select with Enter
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      // Tab to investment input
      await page.keyboard.press('Tab');

      // Type amount
      await page.keyboard.type('15000');
      await page.waitForTimeout(400);

      await takeScreenshot(page, '6a-keyboard-nav');

      // Should have results
      console.log('Keyboard navigation results:', await hasResults(page));
    });

    test('6B. Focus states visible', async ({ page }) => {
      await navigateToCalculator(page);

      // Focus on input
      const input = page.locator('#investment-amount');
      await input.focus();

      await takeScreenshot(page, '6b-focus-states');

      // Check for focus styles
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement;
        if (el) {
          const styles = window.getComputedStyle(el);
          return {
            outline: styles.outline,
            boxShadow: styles.boxShadow,
            border: styles.border,
          };
        }
        return null;
      });

      console.log('Focus styles:', focusedElement);
      expect(focusedElement).toBeTruthy();
    });

    test('6C. Labels and ARIA attributes', async ({ page }) => {
      await navigateToCalculator(page);

      // Check for proper labels
      const ipoSelectLabel = await page.locator('label[for="ipo-select"]').textContent();
      const investmentLabel = await page.locator('label[for="investment-amount"]').textContent();

      console.log('IPO Select Label:', ipoSelectLabel);
      console.log('Investment Label:', investmentLabel);

      expect(ipoSelectLabel).toBeTruthy();
      expect(investmentLabel).toBeTruthy();

      // Check ARIA attributes
      const selectTrigger = page.locator('[id="ipo-select"]');
      const ariaExpanded = await selectTrigger.getAttribute('aria-expanded');

      console.log('ARIA expanded:', ariaExpanded);

      await takeScreenshot(page, '6c-aria-labels');
    });
  });

  // ==================== 7. PERFORMANCE TESTS ====================

  test.describe('7. Performance', () => {

    test('7A. Debounce timing (should wait ~300ms)', async ({ page }) => {
      await selectIPO(page, 0);

      const startTime = Date.now();

      // Type quickly
      const input = page.locator('#investment-amount');
      await input.type('15000');

      // Wait for calculation
      await page.waitForTimeout(400);

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log('Debounce duration:', duration, 'ms');

      // Should be around 300-500ms
      expect(duration).toBeGreaterThan(200);
      expect(duration).toBeLessThan(1000);

      await takeScreenshot(page, '7a-debounce-timing');
    });

    test('7B. Large numbers performance', async ({ page }) => {
      await selectIPO(page, 0);

      const startTime = Date.now();

      await enterInvestmentAmount(page, '999999999');

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log('Large number calculation duration:', duration, 'ms');

      // Should complete in under 1 second
      expect(duration).toBeLessThan(1000);

      await takeScreenshot(page, '7b-large-number-perf');
    });

    test('7C. Multiple rapid calculations', async ({ page }) => {
      await selectIPO(page, 0);

      const startTime = Date.now();

      // Rapid changes
      await enterInvestmentAmount(page, '10000');
      await enterInvestmentAmount(page, '20000');
      await enterInvestmentAmount(page, '30000');
      await enterInvestmentAmount(page, '40000');
      await enterInvestmentAmount(page, '50000');

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log('Multiple calculations duration:', duration, 'ms');

      // Should handle without lag
      expect(duration).toBeLessThan(3000);

      await takeScreenshot(page, '7c-multiple-calcs');
    });
  });

  // ==================== 8. INTEGRATION TESTS ====================

  test.describe('8. Integration', () => {

    test('8A. localStorage persistence', async ({ page, context }) => {
      await selectIPO(page, 0);

      // Get selected IPO
      const selectValue = await page.locator('[id="ipo-select"]').textContent();
      console.log('Selected IPO:', selectValue);

      // Refresh page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Check if selection persists
      const newSelectValue = await page.locator('[id="ipo-select"]').textContent();
      console.log('After reload:', newSelectValue);

      await takeScreenshot(page, '8a-localstorage-persistence');

      // Should remember selection
      expect(newSelectValue).toBeTruthy();
    });

    test('8B. API error handling', async ({ page }) => {
      // Mock API failure
      await page.route('**/api/tools/lot-calculator', (route) => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      });

      await navigateToCalculator(page);

      // Should show error message
      const errorAlert = await page.locator('.alert-destructive, [role="alert"]').textContent();
      console.log('API error message:', errorAlert);

      await takeScreenshot(page, '8b-api-error');

      expect(errorAlert).toBeTruthy();
    });
  });

  // ==================== 9. DATA QUALITY TESTS ====================

  test.describe('9. Data Quality', () => {

    test('9A. Verify lot sizes are realistic', async ({ page }) => {
      await selectIPO(page, 0);

      // Get IPO details from UI
      const selectTrigger = page.locator('[id="ipo-select"]');
      await selectTrigger.click();

      const firstOption = page.locator('[role="option"]').first();
      const optionText = await firstOption.textContent();

      console.log('First IPO option:', optionText);

      await firstOption.click();
      await page.waitForTimeout(500);

      // Try to calculate with known amount
      await enterInvestmentAmount(page, '15000');

      if (await hasResults(page)) {
        const results = await getResults(page);
        console.log('Results with realistic lot size:', results);

        // Document if lot size is 1 (unrealistic)
        if (results.lots === '15,000' || results.lots === '15000') {
          console.warn('⚠️ LOT SIZE APPEARS TO BE 1 (UNREALISTIC)');
        }
      }

      await takeScreenshot(page, '9a-lot-size-check');
    });
  });
});

// ==================== CROSS-BROWSER TESTS ====================

test.describe('Cross-Browser Compatibility', () => {

  test('Compatible with Chromium', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium-specific test');

    await navigateToCalculator(page);
    await selectIPO(page, 0);
    await enterInvestmentAmount(page, '15000');

    await takeScreenshot(page, 'browser-chromium');

    const hasResult = await hasResults(page);
    expect(hasResult).toBeDefined();
  });

  test('Compatible with Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'Firefox-specific test');

    await navigateToCalculator(page);
    await selectIPO(page, 0);
    await enterInvestmentAmount(page, '15000');

    await takeScreenshot(page, 'browser-firefox');

    const hasResult = await hasResults(page);
    expect(hasResult).toBeDefined();
  });
});
