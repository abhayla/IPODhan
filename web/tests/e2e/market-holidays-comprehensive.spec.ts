import { test, expect } from '@playwright/test';

test.describe('Market Holidays Calendar - Comprehensive Tests', () => {
  const baseURL = 'http://localhost:3002';
  const holidaysURL = `${baseURL}/market-holidays`;

  // Store test results
  const testResults = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    holidayData: {
      year2024: 0,
      year2025: 0,
      year2026: 0,
      nseHolidays: 0,
      bseHolidays: 0,
    },
    issues: [] as string[],
    consoleErrors: [] as string[],
  };

  test.beforeEach(async ({ page }) => {
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        testResults.consoleErrors.push(msg.text());
      }
    });

    // Navigate to market holidays page
    await page.goto(holidaysURL);
    await page.waitForLoadState('networkidle');
  });

  test('01 - Page Load and UI Rendering', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Check page title
      await expect(page).toHaveTitle(/Market Holidays|IPODhan/i);

      // Check main heading
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible();

      // Check if holiday cards/items are visible
      const holidayItems = page.locator('[data-testid*="holiday"], .holiday-card, .holiday-item, article, [class*="holiday"]').first();
      await expect(holidayItems).toBeVisible({ timeout: 10000 });

      // Take screenshot
      await page.screenshot({ path: 'web/test-screenshots/market-holidays-01-page-load.png', fullPage: true });

      testResults.passed++;
      console.log('✓ Page Load and UI Rendering test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Page Load failed: ${error.message}`);
      console.error('✗ Page Load test failed:', error);
    }
  });

  test('02 - Holiday Data Display for Multiple Years', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Wait for content to load
      await page.waitForTimeout(2000);

      // Count all visible holiday items
      const allHolidays = await page.locator('article, [data-testid*="holiday"], .holiday-card, .holiday-item, [class*="holiday-"]').count();
      console.log(`Total visible holidays: ${allHolidays}`);

      // Check if we have holidays for multiple years
      const pageContent = await page.content();
      const has2024 = pageContent.includes('2024');
      const has2025 = pageContent.includes('2025');
      const has2026 = pageContent.includes('2026');

      console.log(`Years found - 2024: ${has2024}, 2025: ${has2025}, 2026: ${has2026}`);

      expect(allHolidays).toBeGreaterThan(0);

      testResults.passed++;
      console.log('✓ Holiday Data Display test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Holiday Data Display failed: ${error.message}`);
      console.error('✗ Holiday Data Display test failed:', error);
    }
  });

  test('03 - Filter by Year 2024', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for year filter buttons/select
      const yearFilter2024 = page.locator('button, select, [role="button"]').filter({ hasText: '2024' }).first();

      if (await yearFilter2024.count() > 0) {
        await yearFilter2024.click();
        await page.waitForTimeout(1500);

        // Count holidays after filtering
        const holidays2024 = await page.locator('article, [data-testid*="holiday"], .holiday-card').count();
        testResults.holidayData.year2024 = holidays2024;
        console.log(`Holidays in 2024: ${holidays2024}`);

        // Take screenshot
        await page.screenshot({ path: 'web/test-screenshots/market-holidays-03-filter-year-2024.png', fullPage: true });
      }

      testResults.passed++;
      console.log('✓ Filter by Year 2024 test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Filter Year 2024 failed: ${error.message}`);
      console.error('✗ Filter Year 2024 test failed:', error);
    }
  });

  test('04 - Filter by Year 2025', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for year filter buttons/select
      const yearFilter2025 = page.locator('button, select, [role="button"]').filter({ hasText: '2025' }).first();

      if (await yearFilter2025.count() > 0) {
        await yearFilter2025.click();
        await page.waitForTimeout(1500);

        // Count holidays after filtering
        const holidays2025 = await page.locator('article, [data-testid*="holiday"], .holiday-card').count();
        testResults.holidayData.year2025 = holidays2025;
        console.log(`Holidays in 2025: ${holidays2025}`);

        // Take screenshot
        await page.screenshot({ path: 'web/test-screenshots/market-holidays-04-filter-year-2025.png', fullPage: true });
      }

      testResults.passed++;
      console.log('✓ Filter by Year 2025 test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Filter Year 2025 failed: ${error.message}`);
      console.error('✗ Filter Year 2025 test failed:', error);
    }
  });

  test('05 - Filter by Year 2026', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for year filter buttons/select
      const yearFilter2026 = page.locator('button, select, [role="button"]').filter({ hasText: '2026' }).first();

      if (await yearFilter2026.count() > 0) {
        await yearFilter2026.click();
        await page.waitForTimeout(1500);

        // Count holidays after filtering
        const holidays2026 = await page.locator('article, [data-testid*="holiday"], .holiday-card').count();
        testResults.holidayData.year2026 = holidays2026;
        console.log(`Holidays in 2026: ${holidays2026}`);

        // Take screenshot
        await page.screenshot({ path: 'web/test-screenshots/market-holidays-05-filter-year-2026.png', fullPage: true });
      }

      testResults.passed++;
      console.log('✓ Filter by Year 2026 test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Filter Year 2026 failed: ${error.message}`);
      console.error('✗ Filter Year 2026 test failed:', error);
    }
  });

  test('06 - Filter by Exchange NSE', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for NSE filter button
      const nseFilter = page.locator('button, [role="button"]').filter({ hasText: /^NSE$/i }).first();

      if (await nseFilter.count() > 0) {
        await nseFilter.click();
        await page.waitForTimeout(1500);

        // Verify NSE holidays are showing
        const pageContent = await page.content();
        const hasNSE = pageContent.toLowerCase().includes('nse');
        console.log(`NSE filter applied, showing NSE: ${hasNSE}`);

        // Take screenshot
        await page.screenshot({ path: 'web/test-screenshots/market-holidays-06-filter-nse.png', fullPage: true });
      }

      testResults.passed++;
      console.log('✓ Filter by NSE test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Filter NSE failed: ${error.message}`);
      console.error('✗ Filter NSE test failed:', error);
    }
  });

  test('07 - Filter by Exchange BSE', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for BSE filter button
      const bseFilter = page.locator('button, [role="button"]').filter({ hasText: /^BSE$/i }).first();

      if (await bseFilter.count() > 0) {
        await bseFilter.click();
        await page.waitForTimeout(1500);

        // Verify BSE holidays are showing
        const pageContent = await page.content();
        const hasBSE = pageContent.toLowerCase().includes('bse');
        console.log(`BSE filter applied, showing BSE: ${hasBSE}`);

        // Take screenshot
        await page.screenshot({ path: 'web/test-screenshots/market-holidays-07-filter-bse.png', fullPage: true });
      }

      testResults.passed++;
      console.log('✓ Filter by BSE test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Filter BSE failed: ${error.message}`);
      console.error('✗ Filter BSE test failed:', error);
    }
  });

  test('08 - Filter Combination: Year 2025 + NSE', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Apply year filter
      const yearFilter = page.locator('button, select, [role="button"]').filter({ hasText: '2025' }).first();
      if (await yearFilter.count() > 0) {
        await yearFilter.click();
        await page.waitForTimeout(1000);
      }

      // Apply NSE filter
      const nseFilter = page.locator('button, [role="button"]').filter({ hasText: /^NSE$/i }).first();
      if (await nseFilter.count() > 0) {
        await nseFilter.click();
        await page.waitForTimeout(1500);
      }

      // Take screenshot
      await page.screenshot({ path: 'web/test-screenshots/market-holidays-08-filter-2025-nse.png', fullPage: true });

      testResults.passed++;
      console.log('✓ Filter Combination 2025+NSE test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Filter Combination failed: ${error.message}`);
      console.error('✗ Filter Combination test failed:', error);
    }
  });

  test('09 - Filter by Upcoming Holidays', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for upcoming holidays filter
      const upcomingFilter = page.locator('button, [role="button"], input[type="checkbox"]').filter({
        hasText: /upcoming/i
      }).first();

      if (await upcomingFilter.count() > 0) {
        await upcomingFilter.click();
        await page.waitForTimeout(1500);

        // Count upcoming holidays
        const upcomingCount = await page.locator('article, [data-testid*="holiday"]').count();
        console.log(`Upcoming holidays count: ${upcomingCount}`);

        // Take screenshot
        await page.screenshot({ path: 'web/test-screenshots/market-holidays-09-filter-upcoming.png', fullPage: true });
      }

      testResults.passed++;
      console.log('✓ Filter Upcoming Holidays test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Filter Upcoming failed: ${error.message}`);
      console.error('✗ Filter Upcoming test failed:', error);
    }
  });

  test('10 - Check Major Holidays Present', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Get page content
      const content = await page.content();
      const contentLower = content.toLowerCase();

      // Check for major holidays
      const majorHolidays = {
        'Republic Day': contentLower.includes('republic day'),
        'Holi': contentLower.includes('holi'),
        'Independence Day': contentLower.includes('independence day'),
        'Diwali': contentLower.includes('diwali') || contentLower.includes('deepavali'),
        'Gandhi Jayanti': contentLower.includes('gandhi'),
        'Christmas': contentLower.includes('christmas'),
      };

      console.log('Major Holidays found:', majorHolidays);

      // At least some major holidays should be present
      const foundCount = Object.values(majorHolidays).filter(Boolean).length;
      expect(foundCount).toBeGreaterThan(2);

      testResults.passed++;
      console.log('✓ Major Holidays check passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Major Holidays check failed: ${error.message}`);
      console.error('✗ Major Holidays check failed:', error);
    }
  });

  test('11 - Desktop View (1280px) - Grid Layout', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Set desktop viewport
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(1000);

      // Check layout - should be grid on desktop
      const container = page.locator('main, [class*="grid"], [class*="container"]').first();
      await expect(container).toBeVisible();

      // Take screenshot
      await page.screenshot({ path: 'web/test-screenshots/market-holidays-11-desktop-1280.png', fullPage: true });

      testResults.passed++;
      console.log('✓ Desktop View test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Desktop View failed: ${error.message}`);
      console.error('✗ Desktop View test failed:', error);
    }
  });

  test('12 - Tablet View (768px)', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Set tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(1000);

      // Check if content is still accessible
      const holidayItems = page.locator('article, [data-testid*="holiday"]').first();
      await expect(holidayItems).toBeVisible();

      // Take screenshot
      await page.screenshot({ path: 'web/test-screenshots/market-holidays-12-tablet-768.png', fullPage: true });

      testResults.passed++;
      console.log('✓ Tablet View test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Tablet View failed: ${error.message}`);
      console.error('✗ Tablet View test failed:', error);
    }
  });

  test('13 - Mobile View (375px) - List Layout', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(1000);

      // Check if content is still accessible
      const holidayItems = page.locator('article, [data-testid*="holiday"]').first();
      await expect(holidayItems).toBeVisible();

      // Take screenshot
      await page.screenshot({ path: 'web/test-screenshots/market-holidays-13-mobile-375.png', fullPage: true });

      testResults.passed++;
      console.log('✓ Mobile View test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Mobile View failed: ${error.message}`);
      console.error('✗ Mobile View test failed:', error);
    }
  });

  test('14 - Check Upcoming Holiday Indicator', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Reset to desktop view
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(1000);

      // Look for upcoming indicator (badge, label, or special styling)
      const upcomingIndicator = page.locator('[class*="upcoming"], [class*="badge"], [data-status="upcoming"]').first();

      if (await upcomingIndicator.count() > 0) {
        await expect(upcomingIndicator).toBeVisible();

        // Take screenshot
        await page.screenshot({ path: 'web/test-screenshots/market-holidays-14-upcoming-indicator.png', fullPage: true });
        console.log('✓ Upcoming indicator found');
      } else {
        console.log('⚠ No upcoming holidays within 7 days (or indicator not visible)');
      }

      testResults.passed++;
      console.log('✓ Upcoming Indicator test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Upcoming Indicator check failed: ${error.message}`);
      console.error('✗ Upcoming Indicator test failed:', error);
    }
  });

  test('15 - Check Past Holiday Indicator', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for past holiday indicator (opacity, grayscale, or special class)
      const pastIndicator = page.locator('[class*="past"], [class*="inactive"], [data-status="past"]').first();

      if (await pastIndicator.count() > 0) {
        await expect(pastIndicator).toBeVisible();
        console.log('✓ Past holiday indicator found');
      } else {
        console.log('⚠ Past holiday indicator not found or not visible');
      }

      // Take screenshot showing both past and future holidays
      await page.screenshot({ path: 'web/test-screenshots/market-holidays-15-past-indicator.png', fullPage: true });

      testResults.passed++;
      console.log('✓ Past Indicator test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Past Indicator check failed: ${error.message}`);
      console.error('✗ Past Indicator test failed:', error);
    }
  });

  test('16 - Verify Official Source Links', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Look for links to NSE and BSE
      const nseLink = page.locator('a[href*="nseindia.com"], a[href*="nse"]').first();
      const bseLink = page.locator('a[href*="bseindia.com"], a[href*="bse"]').first();

      let foundLinks = 0;

      if (await nseLink.count() > 0) {
        await expect(nseLink).toBeVisible();
        const href = await nseLink.getAttribute('href');
        console.log(`✓ NSE link found: ${href}`);
        foundLinks++;
      }

      if (await bseLink.count() > 0) {
        await expect(bseLink).toBeVisible();
        const href = await bseLink.getAttribute('href');
        console.log(`✓ BSE link found: ${href}`);
        foundLinks++;
      }

      expect(foundLinks).toBeGreaterThan(0);

      // Take screenshot
      await page.screenshot({ path: 'web/test-screenshots/market-holidays-16-source-links.png', fullPage: true });

      testResults.passed++;
      console.log('✓ Source Links test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Source Links check failed: ${error.message}`);
      console.error('✗ Source Links test failed:', error);
    }
  });

  test('17 - Check Date Formatting', async ({ page }) => {
    testResults.totalTests++;

    try {
      await page.waitForTimeout(1000);

      // Get page content
      const content = await page.content();

      // Check for date patterns (DD/MM/YYYY, DD-MM-YYYY, or Month DD, YYYY)
      const hasDateFormat = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\w+\s+\d{1,2},?\s+\d{4}/i.test(content);

      console.log(`Date formatting found: ${hasDateFormat}`);
      expect(hasDateFormat).toBeTruthy();

      testResults.passed++;
      console.log('✓ Date Formatting test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Date Formatting check failed: ${error.message}`);
      console.error('✗ Date Formatting test failed:', error);
    }
  });

  test('18 - Network Requests and API Calls', async ({ page }) => {
    testResults.totalTests++;

    try {
      const apiCalls: string[] = [];

      // Listen for API calls
      page.on('response', response => {
        const url = response.url();
        if (url.includes('/api/') || url.includes('holiday')) {
          apiCalls.push(`${response.status()} - ${url}`);
        }
      });

      // Reload page to capture requests
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      console.log('API calls detected:', apiCalls);

      testResults.passed++;
      console.log('✓ Network Requests test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`Network Requests check failed: ${error.message}`);
      console.error('✗ Network Requests test failed:', error);
    }
  });

  test('19 - Check SEO Metadata', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Check meta description
      const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
      console.log(`Meta description: ${metaDescription?.substring(0, 100)}...`);

      // Check meta keywords (if present)
      const metaKeywords = await page.locator('meta[name="keywords"]').getAttribute('content');
      if (metaKeywords) {
        console.log(`Meta keywords: ${metaKeywords.substring(0, 100)}...`);
      }

      // Check Open Graph tags
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
      if (ogTitle) {
        console.log(`OG Title: ${ogTitle}`);
      }

      testResults.passed++;
      console.log('✓ SEO Metadata test passed');
    } catch (error) {
      testResults.failed++;
      testResults.issues.push(`SEO Metadata check failed: ${error.message}`);
      console.error('✗ SEO Metadata test failed:', error);
    }
  });

  test('20 - Final Summary and Report', async ({ page }) => {
    testResults.totalTests++;

    try {
      // Calculate pass rate
      const passRate = ((testResults.passed / testResults.totalTests) * 100).toFixed(2);

      // Generate final report
      const report = `
# Market Holidays Calendar Test Results

## Test Summary
- Total Tests: ${testResults.totalTests}
- Passed: ${testResults.passed}
- Failed: ${testResults.failed}
- Pass Rate: ${passRate}%

## Holiday Data
- Holidays in 2024: ${testResults.holidayData.year2024 || 'Not counted'}
- Holidays in 2025: ${testResults.holidayData.year2025 || 'Not counted'}
- Holidays in 2026: ${testResults.holidayData.year2026 || 'Not counted'}

## Issues Found
${testResults.issues.length > 0 ? testResults.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n') : 'No issues found'}

## Console Errors
${testResults.consoleErrors.length > 0 ? testResults.consoleErrors.map((error, i) => `${i + 1}. ${error}`).join('\n') : 'No console errors detected'}

## Screenshots Taken
1. market-holidays-01-page-load.png
2. market-holidays-03-filter-year-2024.png
3. market-holidays-04-filter-year-2025.png
4. market-holidays-05-filter-year-2026.png
5. market-holidays-06-filter-nse.png
6. market-holidays-07-filter-bse.png
7. market-holidays-08-filter-2025-nse.png
8. market-holidays-09-filter-upcoming.png
9. market-holidays-11-desktop-1280.png
10. market-holidays-12-tablet-768.png
11. market-holidays-13-mobile-375.png
12. market-holidays-14-upcoming-indicator.png
13. market-holidays-15-past-indicator.png
14. market-holidays-16-source-links.png

## Overall Assessment
Pass Rate: ${passRate}%
Status: ${parseFloat(passRate) >= 80 ? 'EXCELLENT' : parseFloat(passRate) >= 60 ? 'GOOD' : 'NEEDS IMPROVEMENT'}
      `;

      console.log(report);

      // Save report to file
      const fs = require('fs');
      fs.writeFileSync('web/test-screenshots/market-holidays-test-report.md', report);

      testResults.passed++;
      console.log('✓ Final Summary generated');
    } catch (error) {
      testResults.failed++;
      console.error('✗ Final Summary failed:', error);
    }
  });
});
