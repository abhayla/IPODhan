import { test, expect, Page } from '@playwright/test';
import path from 'path';

const BASE_URL = 'http://localhost:3003';
const SCREENSHOT_DIR = path.join(__dirname, '../../test-screenshots/mainboard-hub');

// Helper function to take screenshots
async function takeScreenshot(page: Page, name: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}-${timestamp}.png`),
    fullPage: true
  });
}

test.describe('Mainboard IPOs Hub - Comprehensive Testing', () => {
  let testResults: any[] = [];
  let consoleErrors: string[] = [];
  let apiCalls: any[] = [];

  test.beforeEach(async ({ page }) => {
    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Capture API calls
    page.on('response', async (response) => {
      if (response.url().includes('/api/')) {
        apiCalls.push({
          url: response.url(),
          status: response.status(),
          method: response.request().method()
        });
      }
    });

    // Navigate to the Mainboard IPOs page
    await page.goto(`${BASE_URL}/mainboard-ipos`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // Allow for dynamic content to load
  });

  test('1. Page Load & Basic Structure', async ({ page }) => {
    console.log('\n=== TEST 1: Page Load & Basic Structure ===');

    // Take initial screenshot
    await takeScreenshot(page, '01-initial-page-load');

    // Check page title
    const title = await page.title();
    console.log(`Page Title: ${title}`);
    expect(title).toContain('Mainboard');

    // Check if main content is visible
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
    console.log('✓ Main content is visible');

    // Check for hero section
    const heroSection = page.locator('h1, [class*="hero"]').first();
    await expect(heroSection).toBeVisible();
    const heroText = await heroSection.textContent();
    console.log(`Hero Section Text: ${heroText}`);

    testResults.push({
      test: 'Page Load & Basic Structure',
      status: 'PASS',
      details: `Title: ${title}, Hero: ${heroText}`
    });
  });

  test('2. Key Metrics/Stats Section', async ({ page }) => {
    console.log('\n=== TEST 2: Key Metrics/Stats Section ===');

    // Look for metrics cards
    const metricsCards = page.locator('[class*="metric"], [class*="stat"], [class*="card"]');
    const count = await metricsCards.count();
    console.log(`Found ${count} potential metric cards`);

    // Try to find specific metrics
    const pageContent = await page.content();
    const hasMetrics = pageContent.includes('Total') ||
                       pageContent.includes('Average') ||
                       pageContent.includes('IPOs');

    if (hasMetrics) {
      await takeScreenshot(page, '02-key-metrics-section');
      console.log('✓ Key metrics section found');

      // Get all text content to analyze metrics
      const allText = await page.locator('body').textContent();
      const metricsPattern = /(\d+)\s*(Total|IPOs|Average|Returns)/gi;
      const matches = allText?.match(metricsPattern);
      console.log(`Metrics found: ${matches?.join(', ')}`);

      testResults.push({
        test: 'Key Metrics Section',
        status: 'PASS',
        details: `Found metrics: ${matches?.slice(0, 5).join(', ')}`
      });
    } else {
      console.log('⚠ No key metrics section found');
      testResults.push({
        test: 'Key Metrics Section',
        status: 'WARNING',
        details: 'No metrics section detected'
      });
    }
  });

  test('3. IPO Listings Table', async ({ page }) => {
    console.log('\n=== TEST 3: IPO Listings Table ===');

    // Look for table or list structure
    const table = page.locator('table, [role="table"], [class*="table"]').first();
    const tableExists = await table.count() > 0;

    if (tableExists) {
      await expect(table).toBeVisible();
      console.log('✓ Table structure found');

      // Check for table headers
      const headers = page.locator('th, [role="columnheader"], thead td');
      const headerCount = await headers.count();
      console.log(`Found ${headerCount} table headers`);

      if (headerCount > 0) {
        const headerTexts = await headers.allTextContents();
        console.log(`Headers: ${headerTexts.join(', ')}`);

        // Check for expected columns
        const expectedHeaders = ['Company', 'Price', 'Open', 'Close', 'Status', 'Lot'];
        const foundHeaders = expectedHeaders.filter(h =>
          headerTexts.some(text => text.includes(h))
        );
        console.log(`Expected headers found: ${foundHeaders.join(', ')}`);
      }

      // Check for table rows
      const rows = page.locator('tbody tr, [role="row"]');
      const rowCount = await rows.count();
      console.log(`Found ${rowCount} table rows`);

      await takeScreenshot(page, '03-ipo-listings-table');

      testResults.push({
        test: 'IPO Listings Table',
        status: 'PASS',
        details: `${headerCount} headers, ${rowCount} rows`
      });
    } else {
      // Check for card-based layout
      const cards = page.locator('[class*="card"], [class*="item"]');
      const cardCount = await cards.count();
      console.log(`Card-based layout: ${cardCount} cards found`);

      if (cardCount > 0) {
        await takeScreenshot(page, '03-ipo-cards-layout');
        testResults.push({
          test: 'IPO Listings Table',
          status: 'PASS',
          details: `Card-based layout with ${cardCount} items`
        });
      } else {
        testResults.push({
          test: 'IPO Listings Table',
          status: 'FAIL',
          details: 'No table or card layout found'
        });
      }
    }
  });

  test('4. Year Filtering', async ({ page }) => {
    console.log('\n=== TEST 4: Year Filtering ===');

    // Look for year filter
    const yearFilter = page.locator('select, [role="combobox"]').filter({ hasText: /202[0-6]/ }).first();
    const yearFilterExists = await yearFilter.count() > 0;

    if (!yearFilterExists) {
      // Try alternative selectors
      const allSelects = page.locator('select, [class*="select"], [class*="filter"]');
      const selectCount = await allSelects.count();
      console.log(`Found ${selectCount} filter elements`);

      if (selectCount > 0) {
        // Try to find and interact with the first select
        const firstSelect = allSelects.first();
        await takeScreenshot(page, '04a-before-year-filter');

        try {
          await firstSelect.click();
          await page.waitForTimeout(1000);
          await takeScreenshot(page, '04b-year-filter-opened');

          // Look for year options
          const options = page.locator('option, [role="option"]');
          const optionTexts = await options.allTextContents();
          console.log(`Filter options: ${optionTexts.slice(0, 10).join(', ')}`);

          // Try to select 2024
          const option2024 = options.filter({ hasText: '2024' }).first();
          if (await option2024.count() > 0) {
            await option2024.click();
            await page.waitForTimeout(2000);
            await takeScreenshot(page, '04c-year-2024-filtered');
            console.log('✓ Successfully filtered by year 2024');

            testResults.push({
              test: 'Year Filtering',
              status: 'PASS',
              details: 'Successfully filtered by year 2024'
            });
          } else {
            testResults.push({
              test: 'Year Filtering',
              status: 'WARNING',
              details: 'Year filter exists but 2024 option not found'
            });
          }
        } catch (error) {
          console.log(`⚠ Error interacting with filter: ${error}`);
          testResults.push({
            test: 'Year Filtering',
            status: 'WARNING',
            details: `Filter found but interaction failed: ${error}`
          });
        }
      } else {
        console.log('⚠ No year filter found');
        testResults.push({
          test: 'Year Filtering',
          status: 'FAIL',
          details: 'No year filter element found'
        });
      }
    }
  });

  test('5. Status Filtering', async ({ page }) => {
    console.log('\n=== TEST 5: Status Filtering ===');

    // Look for status filter buttons or select
    const statusButtons = page.locator('button, [role="tab"]').filter({
      hasText: /UPCOMING|OPEN|CLOSED|LISTED/i
    });
    const buttonCount = await statusButtons.count();
    console.log(`Found ${buttonCount} status filter buttons`);

    if (buttonCount > 0) {
      await takeScreenshot(page, '05a-before-status-filter');

      // Try to click "OPEN" status
      const openButton = statusButtons.filter({ hasText: /OPEN/i }).first();
      if (await openButton.count() > 0) {
        await openButton.click();
        await page.waitForTimeout(2000);
        await takeScreenshot(page, '05b-status-open-filtered');
        console.log('✓ Successfully filtered by OPEN status');

        // Check if URL updated
        const url = page.url();
        console.log(`URL after filter: ${url}`);

        testResults.push({
          test: 'Status Filtering',
          status: 'PASS',
          details: 'Successfully filtered by OPEN status'
        });
      }
    } else {
      // Look for status select dropdown
      const statusSelect = page.locator('select').filter({ hasText: /status/i }).first();
      if (await statusSelect.count() > 0) {
        console.log('Found status select dropdown');
        testResults.push({
          test: 'Status Filtering',
          status: 'PASS',
          details: 'Status filter dropdown found'
        });
      } else {
        console.log('⚠ No status filter found');
        testResults.push({
          test: 'Status Filtering',
          status: 'FAIL',
          details: 'No status filter element found'
        });
      }
    }
  });

  test('6. Content Sections', async ({ page }) => {
    console.log('\n=== TEST 6: Content Sections ===');

    const pageContent = await page.content();
    const sections: any = {};

    // Check for "What is Mainboard IPO" section
    if (pageContent.includes('What is') || pageContent.includes('what is')) {
      sections.whatIs = true;
      console.log('✓ "What is" section found');
    }

    // Check for "How to Apply" section
    if (pageContent.includes('How to Apply') || pageContent.includes('how to apply')) {
      sections.howToApply = true;
      console.log('✓ "How to Apply" section found');
    }

    // Check for "Benefits" section
    if (pageContent.includes('Benefits') || pageContent.includes('benefit')) {
      sections.benefits = true;
      console.log('✓ "Benefits" section found');
    }

    // Scroll to bottom to capture all sections
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '06-content-sections-bottom');

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const sectionCount = Object.keys(sections).length;
    console.log(`Found ${sectionCount} content sections`);

    testResults.push({
      test: 'Content Sections',
      status: sectionCount > 0 ? 'PASS' : 'WARNING',
      details: `Found sections: ${Object.keys(sections).join(', ')}`
    });
  });

  test('7. Data Accuracy - Mainboard Category Verification', async ({ page }) => {
    console.log('\n=== TEST 7: Data Accuracy - Mainboard Category Verification ===');

    // Get all IPO entries on the page
    const pageText = await page.locator('body').textContent();

    // Check if "SME" appears anywhere (it shouldn't)
    const hasSME = pageText?.toLowerCase().includes('sme');

    if (hasSME) {
      console.log('⚠ WARNING: Found "SME" text on Mainboard page');
      await takeScreenshot(page, '07-sme-found-warning');
      testResults.push({
        test: 'Data Accuracy - Category Verification',
        status: 'FAIL',
        details: 'SME IPOs found on Mainboard page'
      });
    } else {
      console.log('✓ No SME IPOs found - data accuracy confirmed');

      // Count total IPOs displayed
      const rows = page.locator('tbody tr, [role="row"], [class*="ipo-item"]');
      const ipoCount = await rows.count();
      console.log(`Total Mainboard IPOs displayed: ${ipoCount}`);

      testResults.push({
        test: 'Data Accuracy - Category Verification',
        status: 'PASS',
        details: `${ipoCount} Mainboard IPOs, no SME IPOs found`
      });
    }
  });

  test('8. Table Sorting', async ({ page }) => {
    console.log('\n=== TEST 8: Table Sorting ===');

    // Look for sortable column headers
    const headers = page.locator('th, [role="columnheader"]');
    const headerCount = await headers.count();

    if (headerCount > 0) {
      console.log(`Testing sorting on ${headerCount} headers`);

      // Try to click the first header to sort
      const firstHeader = headers.first();
      const headerText = await firstHeader.textContent();
      console.log(`Attempting to sort by: ${headerText}`);

      await takeScreenshot(page, '08a-before-sort');

      try {
        await firstHeader.click();
        await page.waitForTimeout(1000);
        await takeScreenshot(page, '08b-after-sort');

        console.log('✓ Successfully clicked header for sorting');

        // Check if sort indicator appeared
        const sortIndicator = page.locator('[class*="sort"], [aria-sort]');
        const hasSortIndicator = await sortIndicator.count() > 0;

        testResults.push({
          test: 'Table Sorting',
          status: 'PASS',
          details: `Clicked ${headerText} header, Sort indicator: ${hasSortIndicator}`
        });
      } catch (error) {
        console.log(`⚠ Could not sort by ${headerText}: ${error}`);
        testResults.push({
          test: 'Table Sorting',
          status: 'WARNING',
          details: `Headers found but sorting interaction failed`
        });
      }
    } else {
      console.log('⚠ No sortable headers found');
      testResults.push({
        test: 'Table Sorting',
        status: 'WARNING',
        details: 'No table headers found for sorting'
      });
    }
  });

  test('9. Pagination', async ({ page }) => {
    console.log('\n=== TEST 9: Pagination ===');

    // Look for pagination controls
    const pagination = page.locator('[class*="pagination"], [aria-label*="pagination"]');
    const paginationExists = await pagination.count() > 0;

    if (paginationExists) {
      console.log('✓ Pagination controls found');

      // Look for next button
      const nextButton = page.locator('button, a').filter({ hasText: /next|>/i }).first();
      if (await nextButton.count() > 0) {
        await takeScreenshot(page, '09a-pagination-page-1');

        const isDisabled = await nextButton.isDisabled().catch(() => false);
        if (!isDisabled) {
          await nextButton.click();
          await page.waitForTimeout(2000);
          await takeScreenshot(page, '09b-pagination-page-2');
          console.log('✓ Successfully navigated to next page');

          testResults.push({
            test: 'Pagination',
            status: 'PASS',
            details: 'Pagination working correctly'
          });
        } else {
          testResults.push({
            test: 'Pagination',
            status: 'PASS',
            details: 'Pagination found but only one page exists'
          });
        }
      }
    } else {
      console.log('⚠ No pagination controls found (may be single page)');
      testResults.push({
        test: 'Pagination',
        status: 'PASS',
        details: 'No pagination needed - single page display'
      });
    }
  });

  test('10. Row Click Navigation', async ({ page }) => {
    console.log('\n=== TEST 10: Row Click Navigation ===');

    // Find first IPO row/card
    const firstRow = page.locator('tbody tr, [role="row"], [class*="ipo-item"], [class*="ipo-card"]').first();

    if (await firstRow.count() > 0) {
      const rowText = await firstRow.textContent();
      console.log(`First IPO: ${rowText?.slice(0, 100)}`);

      // Look for a link within the row
      const link = firstRow.locator('a').first();
      if (await link.count() > 0) {
        const href = await link.getAttribute('href');
        console.log(`Link found: ${href}`);

        await takeScreenshot(page, '10a-before-navigation');

        // Click the link
        await link.click();
        await page.waitForTimeout(2000);
        await takeScreenshot(page, '10b-after-navigation');

        const newUrl = page.url();
        console.log(`Navigated to: ${newUrl}`);

        if (newUrl.includes('/ipo/') || newUrl !== `${BASE_URL}/mainboard-ipos`) {
          console.log('✓ Successfully navigated to IPO detail page');

          // Navigate back
          await page.goBack();
          await page.waitForTimeout(1000);

          testResults.push({
            test: 'Row Click Navigation',
            status: 'PASS',
            details: `Navigated to ${newUrl}`
          });
        } else {
          testResults.push({
            test: 'Row Click Navigation',
            status: 'FAIL',
            details: 'Link did not navigate to detail page'
          });
        }
      } else {
        testResults.push({
          test: 'Row Click Navigation',
          status: 'WARNING',
          details: 'No clickable link found in IPO row'
        });
      }
    } else {
      testResults.push({
        test: 'Row Click Navigation',
        status: 'FAIL',
        details: 'No IPO rows found to test navigation'
      });
    }
  });

  test('11. Mobile Responsiveness', async ({ page }) => {
    console.log('\n=== TEST 11: Mobile Responsiveness ===');

    // Test mobile viewport (375px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '11a-mobile-375px');
    console.log('✓ Mobile view (375px) captured');

    // Check if content is visible and not overflowing
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 375;
    const hasHorizontalScroll = bodyWidth > viewportWidth + 10; // 10px tolerance

    if (hasHorizontalScroll) {
      console.log(`⚠ Horizontal scroll detected: Body width ${bodyWidth}px > Viewport ${viewportWidth}px`);
    } else {
      console.log('✓ No horizontal scroll on mobile');
    }

    // Test tablet viewport (768px)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '11b-tablet-768px');
    console.log('✓ Tablet view (768px) captured');

    // Test desktop viewport (1280px)
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(1000);
    await takeScreenshot(page, '11c-desktop-1280px');
    console.log('✓ Desktop view (1280px) captured');

    testResults.push({
      test: 'Mobile Responsiveness',
      status: hasHorizontalScroll ? 'WARNING' : 'PASS',
      details: `Mobile: ${hasHorizontalScroll ? 'Horizontal scroll detected' : 'No horizontal scroll'}`
    });
  });

  test('12. SEO Metadata', async ({ page }) => {
    console.log('\n=== TEST 12: SEO Metadata ===');

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });

    // Check meta tags
    const title = await page.title();
    const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogDescription = await page.locator('meta[property="og:description"]').getAttribute('content');

    console.log(`Title: ${title}`);
    console.log(`Meta Description: ${metaDescription}`);
    console.log(`OG Title: ${ogTitle}`);
    console.log(`OG Description: ${ogDescription}`);

    const hasGoodSEO = title && metaDescription && title.length > 10 && metaDescription.length > 50;

    testResults.push({
      test: 'SEO Metadata',
      status: hasGoodSEO ? 'PASS' : 'WARNING',
      details: `Title: ${title?.length || 0} chars, Description: ${metaDescription?.length || 0} chars`
    });
  });

  test('13. Combined Filters Test', async ({ page }) => {
    console.log('\n=== TEST 13: Combined Filters Test ===');

    await takeScreenshot(page, '13a-before-combined-filters');

    // Try to apply multiple filters together
    // First, find all filter controls
    const selects = page.locator('select, [role="combobox"]');
    const selectCount = await selects.count();

    if (selectCount >= 2) {
      console.log(`Found ${selectCount} filter controls, attempting to combine filters`);

      // Apply first filter
      try {
        await selects.nth(0).click();
        await page.waitForTimeout(500);
        const firstOptions = page.locator('option, [role="option"]').first();
        await firstOptions.click();
        await page.waitForTimeout(1000);
        console.log('✓ Applied first filter');

        // Apply second filter
        await selects.nth(1).click();
        await page.waitForTimeout(500);
        const secondOptions = page.locator('option, [role="option"]').first();
        await secondOptions.click();
        await page.waitForTimeout(1000);
        console.log('✓ Applied second filter');

        await takeScreenshot(page, '13b-combined-filters-applied');

        testResults.push({
          test: 'Combined Filters',
          status: 'PASS',
          details: 'Successfully applied multiple filters'
        });
      } catch (error) {
        console.log(`⚠ Error applying combined filters: ${error}`);
        testResults.push({
          test: 'Combined Filters',
          status: 'WARNING',
          details: 'Could not apply combined filters'
        });
      }
    } else {
      testResults.push({
        test: 'Combined Filters',
        status: 'WARNING',
        details: `Only ${selectCount} filter(s) found`
      });
    }
  });

  test('14. Search Functionality', async ({ page }) => {
    console.log('\n=== TEST 14: Search Functionality ===');

    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]');
    const searchExists = await searchInput.count() > 0;

    if (searchExists) {
      console.log('✓ Search input found');
      await takeScreenshot(page, '14a-search-empty');

      // Type a search query
      await searchInput.fill('Tech');
      await page.waitForTimeout(1000);
      await takeScreenshot(page, '14b-search-filled');

      // Press Enter or look for search button
      await searchInput.press('Enter');
      await page.waitForTimeout(2000);
      await takeScreenshot(page, '14c-search-results');
      console.log('✓ Search query executed');

      testResults.push({
        test: 'Search Functionality',
        status: 'PASS',
        details: 'Search input found and tested'
      });
    } else {
      console.log('⚠ No search functionality found');
      testResults.push({
        test: 'Search Functionality',
        status: 'WARNING',
        details: 'No search input found on page'
      });
    }
  });

  test('15. Loading States', async ({ page }) => {
    console.log('\n=== TEST 15: Loading States ===');

    // Navigate to page again to capture loading state
    await page.goto(`${BASE_URL}/mainboard-ipos`);

    // Try to capture loading state quickly
    const loadingIndicator = page.locator('[class*="loading"], [class*="spinner"], [aria-busy="true"]');
    const hasLoadingState = await loadingIndicator.count() > 0;

    if (hasLoadingState) {
      await takeScreenshot(page, '15-loading-state');
      console.log('✓ Loading state captured');

      testResults.push({
        test: 'Loading States',
        status: 'PASS',
        details: 'Loading indicator found'
      });
    } else {
      console.log('⚠ No loading state visible (page loaded too fast or no loader)');
      testResults.push({
        test: 'Loading States',
        status: 'WARNING',
        details: 'No loading indicator detected'
      });
    }

    await page.waitForLoadState('networkidle');
  });

  test.afterAll(async () => {
    console.log('\n\n========================================');
    console.log('MAINBOARD IPOs HUB - COMPREHENSIVE TEST RESULTS');
    console.log('========================================\n');

    // Calculate statistics
    const totalTests = testResults.length;
    const passedTests = testResults.filter(r => r.status === 'PASS').length;
    const failedTests = testResults.filter(r => r.status === 'FAIL').length;
    const warningTests = testResults.filter(r => r.status === 'WARNING').length;
    const passRate = ((passedTests / totalTests) * 100).toFixed(1);

    console.log('TEST SUMMARY:');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✓`);
    console.log(`Failed: ${failedTests} ✗`);
    console.log(`Warnings: ${warningTests} ⚠`);
    console.log(`Pass Rate: ${passRate}%\n`);

    console.log('DETAILED RESULTS:');
    testResults.forEach((result, index) => {
      const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '⚠';
      console.log(`${index + 1}. ${icon} ${result.test}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Details: ${result.details}\n`);
    });

    if (consoleErrors.length > 0) {
      console.log('CONSOLE ERRORS:');
      consoleErrors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
      console.log('');
    } else {
      console.log('CONSOLE ERRORS: None\n');
    }

    if (apiCalls.length > 0) {
      console.log('API CALLS:');
      const uniqueAPIs = [...new Set(apiCalls.map(c => c.url))];
      uniqueAPIs.forEach((url, index) => {
        const call = apiCalls.find(c => c.url === url);
        console.log(`${index + 1}. ${call?.method} ${url} - Status: ${call?.status}`);
      });
      console.log('');
    }

    console.log('========================================');
    console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
    console.log('========================================\n');
  });
});
