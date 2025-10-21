/**
 * Quick validation test for Lot Calculator
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3003';

test.describe('Lot Calculator - Quick Validation', () => {
  test('can load page and select IPO', async ({ page }) => {
    await page.goto(`${BASE_URL}/tools/lot-calculator`);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check if page loaded
    const title = await page.textContent('h1');
    console.log('Page title:', title);
    expect(title).toContain('IPO Lot');

    // Wait for dropdown to be available (not loading)
    await page.waitForSelector('[id="ipo-select"]', { timeout: 30000 });

    // Click to open dropdown
    await page.click('[id="ipo-select"]');

    // Wait for options
    await page.waitForSelector('[role="option"]', { state: 'visible', timeout: 10000 });

    // Get first option
    const firstOption = page.locator('[role="option"]').first();
    const optionText = await firstOption.textContent();
    console.log('First IPO option:', optionText);

    await firstOption.click();

    // Enter investment amount
    await page.fill('#investment-amount', '15000');

    // Wait for calculation
    await page.waitForTimeout(500);

    // Take screenshot
    await page.screenshot({ path: 'test-results/phase-3/screenshots/quick-test.png', fullPage: true });

    console.log('Test completed successfully!');
  });
});
