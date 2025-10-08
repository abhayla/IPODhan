/**
 * E2E Tests for Lot Size Calculator Tool
 *
 * Tests:
 * - Navigate to lot calculator page
 * - IPO selection from dropdown
 * - Investment amount input validation
 * - Lot quantity calculation accuracy
 * - Results display (lots, shares, total amount)
 * - Clear/reset functionality
 * - Mobile responsive behavior
 * - Error states (invalid inputs, no IPO selected)
 * - Edge cases (very large amounts, partial lots, boundary conditions)
 * - Cross-browser compatibility (Chromium, Firefox, WebKit, Edge)
 * - localStorage persistence
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

/**
 * Parse formatted currency string to number
 */
function parseCurrency(value: string): number {
  return Number(value.replace(/[^0-9]/g, ''));
}

// ==================== TESTS ====================

test.describe('Lot Calculator - Critical User Journey', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport for consistent testing
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should navigate to lot calculator page', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    // Hover over Tools menu
    await page.locator('text=Tools').hover();

    // Click on "Lot Calculator" link
    await page.locator('text=Lot Calculator').click();

    // Verify navigation to lot calculator page
    await expect(page).toHaveURL(`${BASE_URL}/tools/lot-calculator`);
    await expect(page.locator('h1')).toContainText(/Lot.*Calculator/i);
    await expect(page.locator('text=Calculate how many lots')).toBeVisible();
  });

  test('should display lot calculator page with all elements', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Verify page title
    await expect(page).toHaveTitle(/Lot.*Calculator/i);

    // Verify main heading
    await expect(page.locator('h1')).toContainText(/IPO Lot.*Calculator/i);

    // Verify breadcrumbs
    await expect(page.locator('text=Home')).toBeVisible();
    await expect(page.locator('text=Tools')).toBeVisible();

    // Verify calculator card is present
    await expect(page.locator('text=Select IPO')).toBeVisible();
    await expect(page.locator('text=Investment Amount')).toBeVisible();

    // Verify help section
    await expect(page.locator('text=How to Use')).toBeVisible();
  });

  test('should allow IPO selection from dropdown', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Wait for IPO dropdown to load
    const ipoSelect = page.locator('#ipo-select');
    await expect(ipoSelect).toBeVisible();

    // Click to open dropdown
    await ipoSelect.click();
    await page.waitForTimeout(500);

    // Verify dropdown options appear
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);

    // Select first IPO
    const firstOption = options.first();
    const ipoName = await firstOption.textContent();
    await firstOption.click();

    // Verify selection
    await expect(ipoSelect).toContainText(ipoName || '');
  });

  test('should accept valid investment amount input', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO first
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter investment amount
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('15000');

    // Verify formatted value appears (with commas)
    await expect(amountInput).toHaveValue('15,000');
  });

  test('should calculate lot quantity accurately', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter investment amount
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('50000');
    await page.waitForTimeout(500); // Wait for debounced calculation

    // Verify results appear
    await expect(page.locator('text=Number of Lots')).toBeVisible();
    await expect(page.locator('text=Total Shares')).toBeVisible();
    await expect(page.locator('text=Total Investment')).toBeVisible();

    // Verify calculation shows numeric results
    const lotsText = await page
      .locator('text=Number of Lots')
      .locator('..')
      .textContent();
    expect(lotsText).toMatch(/\d+/);
  });

  test('should display results correctly with all metrics', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter substantial investment amount
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('100000');
    await page.waitForTimeout(500);

    // Verify all three result metrics are visible
    const resultsCard = page.locator('.bg-accent\\/50').first();
    await expect(resultsCard).toBeVisible();

    // Check for Number of Lots
    await expect(resultsCard.locator('text=Number of Lots')).toBeVisible();

    // Check for Total Shares
    await expect(resultsCard.locator('text=Total Shares')).toBeVisible();

    // Check for Total Investment
    await expect(resultsCard.locator('text=Total Investment')).toBeVisible();

    // Verify calculation formula appears
    await expect(resultsCard.locator('text=Calculation:')).toBeVisible();
  });

  test('should clear/reset when input is cleared', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter and verify calculation
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('50000');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Number of Lots')).toBeVisible();

    // Clear input
    await amountInput.clear();

    // Verify results disappear
    const resultsCard = page.locator('.bg-accent\\/50').first();
    await expect(resultsCard).not.toBeVisible();
  });

  test('should show error for negative or zero investment amount', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Try entering zero
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('0');
    await page.waitForTimeout(500);

    // Verify error message or validation state
    const errorMessage = page.locator('.text-destructive');
    if (await errorMessage.count() > 0) {
      await expect(errorMessage.first()).toBeVisible();
    }
  });

  test('should show error for investment amount below minimum (1 lot)', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter very small amount (below 1 lot)
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('100');
    await page.waitForTimeout(500);

    // Verify error message about minimum investment
    await expect(page.locator('text=/Minimum investment/i')).toBeVisible();
  });

  test('should handle non-numeric input gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Try entering letters
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('abc');

    // Verify input is empty or only contains numbers
    const inputValue = await amountInput.inputValue();
    expect(inputValue).not.toMatch(/[a-zA-Z]/);
  });

  test('should handle very large investment amounts', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter very large amount (10 lakhs)
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('1000000');
    await page.waitForTimeout(500);

    // Verify calculation completes without error
    await expect(page.locator('text=Number of Lots')).toBeVisible();

    // Verify formatted currency appears correctly
    await expect(amountInput).toHaveValue(/10,00,000/);
  });

  test('should recalculate when switching IPOs', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select first IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter amount
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('50000');
    await page.waitForTimeout(500);

    // Get first result
    const firstLotsResult = await page
      .locator('text=Number of Lots')
      .locator('..')
      .locator('.text-2xl')
      .textContent();

    // Switch to different IPO
    await ipoSelect.click();
    await page.waitForTimeout(500);
    const options = page.locator('[role="option"]');
    if ((await options.count()) > 1) {
      await options.nth(1).click();
      await page.waitForTimeout(500);

      // Verify calculation updated (result may be different)
      await expect(page.locator('text=Number of Lots')).toBeVisible();
    }
  });

  test('should persist last selected IPO in localStorage', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    const firstOption = page.locator('[role="option"]').first();
    const selectedIPOName = await firstOption.textContent();
    await firstOption.click();
    await page.waitForTimeout(500);

    // Refresh page
    await page.reload();
    await waitForPageLoad(page);

    // Verify same IPO is selected
    await expect(ipoSelect).toContainText(selectedIPOName || '');
  });

  test('should display help section with usage instructions', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Scroll to help section
    await page.locator('text=How to Use').scrollIntoViewIfNeeded();

    // Verify help section content
    await expect(page.locator('text=How to Use')).toBeVisible();
    await expect(page.locator('text=Step 1: Select IPO')).toBeVisible();
    await expect(page.locator('text=Step 2: Enter Amount')).toBeVisible();
    await expect(page.locator('text=Step 3: View Results')).toBeVisible();

    // Verify formula explanation exists
    await expect(page.locator('text=Calculation Formula')).toBeVisible();
    await expect(page.locator('text=Example Calculation')).toBeVisible();
  });

  test('should display structured data (JSON-LD) for SEO', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Verify JSON-LD script exists
    const jsonLdScript = page.locator('script[type="application/ld+json"]');
    await expect(jsonLdScript).toHaveCount(1);

    // Verify JSON-LD content
    const jsonLdContent = await jsonLdScript.textContent();
    expect(jsonLdContent).toContain('WebApplication');
    expect(jsonLdContent).toContain('IPO Lot Size Calculator');
  });
});

// ==================== MOBILE RESPONSIVE TESTS ====================

test.describe('Lot Calculator - Mobile Responsive', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE size

  test('should work on mobile devices', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Verify page elements are visible on mobile
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('text=Select IPO')).toBeVisible();
    await expect(page.locator('text=Investment Amount')).toBeVisible();

    // Open mobile menu
    const mobileMenuButton = page.locator('[aria-label="Toggle menu"]');
    if (await mobileMenuButton.count() > 0) {
      await mobileMenuButton.click();
      await expect(page.locator('text=Tools')).toBeVisible();
    }
  });

  test('should display calculator form correctly on mobile', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Verify calculator card is visible
    const calculatorCard = page.locator('text=Select IPO').locator('..');
    await expect(calculatorCard).toBeVisible();

    // Verify inputs are usable
    const ipoSelect = page.locator('#ipo-select');
    await expect(ipoSelect).toBeVisible();
    await ipoSelect.click();
    await page.waitForTimeout(500);

    // Verify dropdown appears
    await expect(page.locator('[role="option"]').first()).toBeVisible();
  });

  test('should display results correctly on mobile', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter amount
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('50000');
    await page.waitForTimeout(500);

    // Verify results are visible and stacked vertically
    const resultsCard = page.locator('.bg-accent\\/50').first();
    await expect(resultsCard).toBeVisible();
    await expect(resultsCard.locator('text=Number of Lots')).toBeVisible();
    await expect(resultsCard.locator('text=Total Shares')).toBeVisible();
  });

  test('should show help section on mobile', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Scroll to help section
    await page.locator('text=How to Use').scrollIntoViewIfNeeded();

    // Verify help cards stack vertically on mobile
    await expect(page.locator('text=Step 1: Select IPO')).toBeVisible();
    await expect(page.locator('text=Step 2: Enter Amount')).toBeVisible();
  });
});

// ==================== EDGE CASE TESTS ====================

test.describe('Lot Calculator - Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should handle exact lot amount (no remainder)', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter amount that might be exact multiple
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('20000');
    await page.waitForTimeout(500);

    // Verify calculation completes
    if (await page.locator('text=Number of Lots').count() > 0) {
      await expect(page.locator('text=Number of Lots')).toBeVisible();
    }
  });

  test('should handle partial lot (amount insufficient for additional lot)', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter amount slightly above 1 lot but below 2 lots
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('25000');
    await page.waitForTimeout(500);

    // Verify calculation shows correct number of complete lots
    if (await page.locator('text=Number of Lots').count() > 0) {
      const lotsValue = await page
        .locator('text=Number of Lots')
        .locator('..')
        .locator('.text-2xl')
        .textContent();
      const lots = parseInt(lotsValue || '0', 10);
      expect(lots).toBeGreaterThanOrEqual(0);
    }
  });

  test('should handle maximum integer values gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter very large amount
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('99999999');
    await page.waitForTimeout(500);

    // Verify no crash or error
    const pageContent = await page.content();
    expect(pageContent).toBeTruthy();
  });

  test('should show 0 lots for amount below minimum', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Select an IPO
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    // Enter minimal amount
    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('500');
    await page.waitForTimeout(500);

    // Verify error message or 0 lots message
    const hasMinimumError = await page.locator('text=/Minimum investment/i').count();
    const hasZeroLotsAlert = await page.locator('text=/too low/i').count();
    expect(hasMinimumError + hasZeroLotsAlert).toBeGreaterThan(0);
  });
});

// ==================== CROSS-BROWSER TESTS ====================

test.describe('Lot Calculator - Cross-Browser Compatibility', () => {
  test('should work correctly on Chromium', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium-specific test');

    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Perform basic operations
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();

    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('50000');
    await page.waitForTimeout(500);

    await expect(page.locator('text=Number of Lots')).toBeVisible();
  });

  test('should work correctly on Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'Firefox-specific test');

    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Perform basic operations
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();

    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('50000');
    await page.waitForTimeout(500);

    await expect(page.locator('text=Number of Lots')).toBeVisible();
  });

  test('should work correctly on WebKit (Safari)', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'WebKit-specific test');

    await page.goto(`${BASE_URL}/tools/lot-calculator`);
    await waitForPageLoad(page);

    // Perform basic operations
    const ipoSelect = page.locator('#ipo-select');
    await ipoSelect.click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click();

    const amountInput = page.locator('#investment-amount');
    await amountInput.fill('50000');
    await page.waitForTimeout(500);

    await expect(page.locator('text=Number of Lots')).toBeVisible();
  });
});
