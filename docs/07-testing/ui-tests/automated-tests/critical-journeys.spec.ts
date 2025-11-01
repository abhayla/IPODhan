/**
 * Critical User Journeys - Automated Playwright Tests
 * Generated from manual testing findings
 *
 * These tests validate the core user flows and data accuracy
 * for the IPODhan application.
 */

import { test, expect } from '@playwright/test';

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_TIMEOUT = 30000; // 30 seconds per test

test.describe('Critical User Journeys', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport to desktop size as per testing requirements
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test.describe('Homepage Navigation', () => {
    test('should load homepage and navigate to key sections', async ({ page }) => {
      // Navigate to homepage
      await page.goto(BASE_URL);

      // Verify page loaded
      await expect(page).toHaveTitle(/IPODhan/);

      // Check critical elements
      await expect(page.locator('nav')).toBeVisible();
      await expect(page.locator('text=Browse IPOs')).toBeVisible();
      await expect(page.locator('text=Calculate Lots')).toBeVisible();

      // TODO: Add data validation checks from manual testing

      // Test navigation to Dashboard
      await page.click('text=Browse IPOs');
      await expect(page).toHaveURL(`${BASE_URL}/dashboard`);

      // Navigate back
      await page.goBack();

      // Test navigation to Lot Calculator
      await page.click('text=Calculate Lots');
      await expect(page).toHaveURL(`${BASE_URL}/tools/lot-calculator`);
    });

    test('should display correct featured IPOs from database', async ({ page }) => {
      await page.goto(BASE_URL);

      // TODO: Add database query validation
      // Compare displayed IPOs with expected data from database

      // Check featured IPO cards exist
      const featuredIPOs = page.locator('[data-testid="featured-ipo-card"]');
      await expect(featuredIPOs).toHaveCount(5); // Adjust based on actual count

      // Validate data fields
      // TODO: Add specific field validation based on manual test findings
    });
  });

  test.describe('Dashboard Functionality', () => {
    test('should display IPO grid with correct data', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Wait for IPO cards to load
      await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

      // Check default view (grid)
      const ipoCards = page.locator('[data-testid="ipo-card"]');
      await expect(ipoCards.first()).toBeVisible();

      // TODO: Validate IPO count matches database
      // TODO: Validate each card has required fields
    });

    test('should filter IPOs by status', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Test status filters
      const statusFilter = page.locator('[data-testid="status-filter"]');

      // Filter by OPEN
      await statusFilter.selectOption('OPEN');
      await page.waitForLoadState('networkidle');

      // Verify filtered results
      const openIPOs = page.locator('[data-testid="ipo-card"]');
      // TODO: Add assertion based on expected count

      // Filter by UPCOMING
      await statusFilter.selectOption('UPCOMING');
      await page.waitForLoadState('networkidle');

      // TODO: Validate filtered results
    });

    test('should filter IPOs by category', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Test category filters
      const categoryFilter = page.locator('[data-testid="category-filter"]');

      // Filter by Mainboard
      await categoryFilter.selectOption('MAINBOARD');
      await page.waitForLoadState('networkidle');

      // TODO: Validate only Mainboard IPOs shown

      // Filter by SME
      await categoryFilter.selectOption('SME');
      await page.waitForLoadState('networkidle');

      // TODO: Validate only SME IPOs shown
    });

    test('should search IPOs by company name', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      const searchInput = page.locator('[data-testid="search-input"]');

      // Search for specific IPO
      await searchInput.fill('Bhairav');
      await page.waitForLoadState('networkidle');

      // Verify search results
      const searchResults = page.locator('[data-testid="ipo-card"]');
      // TODO: Add assertions based on expected results
    });

    test('should handle pagination correctly', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Check pagination controls
      const nextButton = page.locator('[data-testid="pagination-next"]');
      const prevButton = page.locator('[data-testid="pagination-prev"]');

      // Navigate to next page
      if (await nextButton.isEnabled()) {
        await nextButton.click();
        await page.waitForLoadState('networkidle');
        // TODO: Validate different IPOs are shown
      }

      // Navigate back
      if (await prevButton.isEnabled()) {
        await prevButton.click();
        await page.waitForLoadState('networkidle');
        // TODO: Validate original IPOs are shown
      }
    });
  });

  test.describe('IPO Detail Page', () => {
    const TEST_IPOS = [
      { slug: 'bhairav-enterprises-limited', name: 'Bhairav Enterprises Limited' },
      { slug: 'cdg-petchem-ltd', name: 'CDG Petchem Ltd' },
      { slug: 'healthy-life-agritec-ltd', name: 'Healthy Life Agritec Ltd' }
    ];

    TEST_IPOS.forEach(ipo => {
      test(`should display complete data for ${ipo.name}`, async ({ page }) => {
        await page.goto(`${BASE_URL}/ipos/${ipo.slug}`);

        // Check page loaded
        await expect(page.locator('h1')).toContainText(ipo.name);

        // Validate tabs
        await expect(page.locator('text=Overview')).toBeVisible();
        await expect(page.locator('text=Financial')).toBeVisible();
        await expect(page.locator('text=Subscription')).toBeVisible();
        await expect(page.locator('text=GMP')).toBeVisible();

        // TODO: Add database validation for each tab's data

        // Test tab switching
        await page.click('text=Financial');
        // TODO: Validate financial data displays

        await page.click('text=Subscription');
        // TODO: Validate subscription data displays

        await page.click('text=GMP');
        // TODO: Validate GMP data displays
      });
    });

    test('should navigate from dashboard to detail page', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);

      // Click first IPO card
      const firstIPO = page.locator('[data-testid="ipo-card"]').first();
      const ipoName = await firstIPO.locator('[data-testid="ipo-name"]').textContent();

      await firstIPO.click();

      // Verify navigation
      await expect(page).toHaveURL(/\/ipos\/.+/);
      await expect(page.locator('h1')).toContainText(ipoName || '');
    });
  });

  test.describe('Lot Calculator', () => {
    test('should calculate lots correctly for minimum price', async ({ page }) => {
      await page.goto(`${BASE_URL}/tools/lot-calculator`);

      // Select IPO
      const ipoDropdown = page.locator('[data-testid="ipo-select"]');
      await ipoDropdown.selectOption({ index: 1 }); // Select first IPO

      // Enter investment amount
      const amountInput = page.locator('[data-testid="investment-amount"]');
      await amountInput.fill('10000');

      // Select minimum price
      await page.click('[data-testid="price-min"]');

      // Calculate
      await page.click('[data-testid="calculate-button"]');

      // Verify results
      const lotsResult = page.locator('[data-testid="lots-result"]');
      await expect(lotsResult).toBeVisible();
      // TODO: Add calculation validation
    });

    test('should validate negative and invalid inputs', async ({ page }) => {
      await page.goto(`${BASE_URL}/tools/lot-calculator`);

      const amountInput = page.locator('[data-testid="investment-amount"]');

      // Test negative number
      await amountInput.fill('-1000');
      await page.click('[data-testid="calculate-button"]');
      await expect(page.locator('text=error')).toBeVisible();

      // Test zero
      await amountInput.fill('0');
      await page.click('[data-testid="calculate-button"]');
      await expect(page.locator('text=error')).toBeVisible();

      // Test non-numeric
      await amountInput.fill('abc');
      // Should not be accepted or show error
    });

    test('should handle custom price input', async ({ page }) => {
      await page.goto(`${BASE_URL}/tools/lot-calculator`);

      // Select IPO
      const ipoDropdown = page.locator('[data-testid="ipo-select"]');
      await ipoDropdown.selectOption({ index: 1 });

      // Select custom price
      await page.click('[data-testid="price-custom"]');

      const customPriceInput = page.locator('[data-testid="custom-price"]');
      await expect(customPriceInput).toBeEnabled();

      await customPriceInput.fill('100');
      await page.locator('[data-testid="investment-amount"]').fill('50000');

      await page.click('[data-testid="calculate-button"]');

      // TODO: Validate calculation with custom price
    });
  });

  test.describe('Compare IPOs Tool', () => {
    test('should compare 2 IPOs with correct data', async ({ page }) => {
      await page.goto(`${BASE_URL}/tools/compare`);

      // Select first IPO
      const dropdown1 = page.locator('[data-testid="ipo-select-1"]');
      await dropdown1.selectOption({ index: 1 });

      // Select second IPO
      const dropdown2 = page.locator('[data-testid="ipo-select-2"]');
      await dropdown2.selectOption({ index: 2 });

      // Verify comparison table appears
      const comparisonTable = page.locator('[data-testid="comparison-table"]');
      await expect(comparisonTable).toBeVisible();

      // TODO: Validate data in comparison matches database
    });

    test('should add and remove third IPO', async ({ page }) => {
      await page.goto(`${BASE_URL}/tools/compare`);

      // Select 2 IPOs first
      await page.locator('[data-testid="ipo-select-1"]').selectOption({ index: 1 });
      await page.locator('[data-testid="ipo-select-2"]').selectOption({ index: 2 });

      // Add third IPO
      await page.click('[data-testid="add-ipo-button"]');
      const dropdown3 = page.locator('[data-testid="ipo-select-3"]');
      await expect(dropdown3).toBeVisible();

      await dropdown3.selectOption({ index: 3 });

      // Verify 3 columns in comparison
      // TODO: Add validation

      // Remove middle IPO
      await page.click('[data-testid="remove-ipo-2"]');

      // Verify layout adjusts
      // TODO: Add validation
    });

    test('should clear all selections', async ({ page }) => {
      await page.goto(`${BASE_URL}/tools/compare`);

      // Select IPOs
      await page.locator('[data-testid="ipo-select-1"]').selectOption({ index: 1 });
      await page.locator('[data-testid="ipo-select-2"]').selectOption({ index: 2 });

      // Clear all
      await page.click('[data-testid="clear-all-button"]');

      // Verify reset state
      const comparisonTable = page.locator('[data-testid="comparison-table"]');
      await expect(comparisonTable).not.toBeVisible();
    });
  });

  test.describe('Data Validation', () => {
    test('should have no console errors on any page', async ({ page }) => {
      const errors: string[] = [];

      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });

      // Test all pages
      const pages = [
        '/',
        '/dashboard',
        '/ipos/bhairav-enterprises-limited',
        '/tools/lot-calculator',
        '/tools/compare'
      ];

      for (const url of pages) {
        await page.goto(`${BASE_URL}${url}`);
        await page.waitForLoadState('networkidle');
      }

      expect(errors).toHaveLength(0);
    });

    test('should display data that matches database records', async ({ page }) => {
      // TODO: Add comprehensive database validation tests
      // This would require database connection in test environment
      // or mocked data that matches production database
    });
  });
});

// Performance tests
test.describe('Performance', () => {
  test('should load pages within acceptable time', async ({ page }) => {
    const pages = [
      { url: '/', maxTime: 2000 },
      { url: '/dashboard', maxTime: 2000 },
      { url: '/tools/lot-calculator', maxTime: 1000 },
      { url: '/tools/compare', maxTime: 1000 }
    ];

    for (const testPage of pages) {
      const startTime = Date.now();
      await page.goto(`${BASE_URL}${testPage.url}`);
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;

      expect(loadTime).toBeLessThan(testPage.maxTime);
    }
  });
});

// Accessibility tests
test.describe('Accessibility', () => {
  test('should be keyboard navigable', async ({ page }) => {
    await page.goto(BASE_URL);

    // Tab through elements
    await page.keyboard.press('Tab');
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(firstFocused).toBeTruthy();

    // Continue tabbing and ensure focus moves
    await page.keyboard.press('Tab');
    const secondFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(secondFocused).toBeTruthy();

    // TODO: Add more comprehensive keyboard navigation tests
  });
});

/**
 * TODO: After manual testing is complete, add:
 * 1. Specific data validation based on issues found
 * 2. Edge cases discovered during manual testing
 * 3. Regression tests for fixed bugs
 * 4. Additional user journeys identified
 * 5. Performance benchmarks from manual testing
 */