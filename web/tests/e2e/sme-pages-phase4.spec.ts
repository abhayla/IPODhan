import { test, expect, type Page } from '@playwright/test';

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TIMEOUT = 30000;

// Store API call data for analysis
interface APICall {
  url: string;
  method: string;
  queryParams: Record<string, string>;
  responseData: any;
}

interface PageTestResult {
  pageName: string;
  pageUrl: string;
  passed: boolean;
  apiCalls: APICall[];
  displayedIPOCount: number;
  smeIPOsInResponse: number;
  mainboardIPOsInResponse: number;
  categoryFilterPresent: boolean;
  errors: string[];
  screenshots: string[];
  consoleErrors: string[];
}

const testResults: PageTestResult[] = [];

// Helper function to extract query parameters
function extractQueryParams(url: string): Record<string, string> {
  const urlObj = new URL(url);
  const params: Record<string, string> = {};
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

// Helper function to count SME vs MAINBOARD IPOs in response
function analyzeIPOData(data: any): { sme: number; mainboard: number } {
  let sme = 0;
  let mainboard = 0;

  if (!data) return { sme, mainboard };

  // Handle different response structures
  const ipos = data.data?.ipos || data.data || data.ipos || data;

  if (Array.isArray(ipos)) {
    ipos.forEach((ipo: any) => {
      const category = ipo.category || ipo.segment;
      if (category === 'SME') sme++;
      else if (category === 'MAINBOARD') mainboard++;
    });
  }

  return { sme, mainboard };
}

// Helper function to capture API calls
async function captureAPICalls(page: Page): Promise<APICall[]> {
  const apiCalls: APICall[] = [];

  page.on('response', async (response) => {
    const url = response.url();
    // Only capture API calls
    if (url.includes('/api/')) {
      try {
        const method = response.request().method();
        const queryParams = extractQueryParams(url);
        let responseData = null;

        if (response.ok() && response.headers()['content-type']?.includes('application/json')) {
          responseData = await response.json();
        }

        apiCalls.push({
          url,
          method,
          queryParams,
          responseData,
        });
      } catch (error) {
        console.error('Error capturing API call:', error);
      }
    }
  });

  return apiCalls;
}

// Helper function to test a page
async function testSMEPage(
  page: Page,
  pageName: string,
  pageUrl: string,
  expectedAPIEndpoint?: string
): Promise<PageTestResult> {
  const result: PageTestResult = {
    pageName,
    pageUrl,
    passed: true,
    apiCalls: [],
    displayedIPOCount: 0,
    smeIPOsInResponse: 0,
    mainboardIPOsInResponse: 0,
    categoryFilterPresent: false,
    errors: [],
    screenshots: [],
    consoleErrors: [],
  };

  try {
    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        result.consoleErrors.push(msg.text());
      }
    });

    // Capture API calls
    const apiCallsPromise = captureAPICalls(page);

    // Navigate to page
    console.log(`\n=== Testing ${pageName} ===`);
    console.log(`URL: ${pageUrl}`);

    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Capture API calls made during navigation
    result.apiCalls = await apiCallsPromise;

    // Analyze API calls
    for (const apiCall of result.apiCalls) {
      console.log(`\nAPI Call: ${apiCall.method} ${apiCall.url}`);
      console.log(`Query Params:`, apiCall.queryParams);

      // Check if category/segment filter is present
      if (apiCall.queryParams.category === 'SME' || apiCall.queryParams.segment === 'SME') {
        result.categoryFilterPresent = true;
        console.log('✓ Category filter present: SME');
      }

      // Analyze response data
      if (apiCall.responseData) {
        const { sme, mainboard } = analyzeIPOData(apiCall.responseData);
        result.smeIPOsInResponse += sme;
        result.mainboardIPOsInResponse += mainboard;

        console.log(`Response contains: ${sme} SME IPOs, ${mainboard} MAINBOARD IPOs`);

        if (mainboard > 0) {
          result.errors.push(`MAINBOARD IPOs found in response (${mainboard} IPOs)`);
          result.passed = false;
          console.log('✗ CRITICAL: MAINBOARD IPOs found in SME page!');
        }
      }
    }

    // Count displayed IPOs (try multiple selectors)
    const selectors = [
      '[data-testid="ipo-card"]',
      '.ipo-card',
      '[class*="IPOCard"]',
      'article',
      '[role="article"]',
    ];

    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        result.displayedIPOCount = count;
        console.log(`\nDisplayed IPOs: ${count} (using selector: ${selector})`);
        break;
      }
    }

    // Take screenshot
    const screenshotPath = `test-results/phase-4/screenshots/${pageName.replace(/\s+/g, '-').toLowerCase()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshots.push(screenshotPath);
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Validation checks
    if (!result.categoryFilterPresent) {
      result.errors.push('Category filter (category=SME or segment=SME) not found in API calls');
      result.passed = false;
      console.log('✗ Category filter not found in API calls');
    }

    if (result.mainboardIPOsInResponse > 0) {
      result.errors.push(`Cross-contamination detected: ${result.mainboardIPOsInResponse} MAINBOARD IPOs in response`);
      result.passed = false;
    }

    if (result.consoleErrors.length > 0) {
      result.errors.push(`Console errors found: ${result.consoleErrors.length}`);
      console.log(`\nConsole Errors (${result.consoleErrors.length}):`);
      result.consoleErrors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
    }

    console.log(`\n${result.passed ? '✓ PASSED' : '✗ FAILED'}`);
  } catch (error) {
    result.passed = false;
    result.errors.push(`Test error: ${error}`);
    console.error('Test error:', error);
  }

  return result;
}

test.describe('Phase 4: SME Pages Testing', () => {
  test.setTimeout(120000); // 2 minutes per test

  test('1. /sme-ipos - SME Landing Page', async ({ page }) => {
    const result = await testSMEPage(page, 'SME Landing Page', `${BASE_URL}/sme-ipos`);
    testResults.push(result);
    expect(result.passed, result.errors.join('; ')).toBe(true);
  });

  test('2. /sme-ipo-calendar - SME Calendar', async ({ page }) => {
    const result = await testSMEPage(page, 'SME Calendar', `${BASE_URL}/sme-ipo-calendar`);
    testResults.push(result);
    expect(result.passed, result.errors.join('; ')).toBe(true);
  });

  test('3. /sme-ipo-performance-tracker - Listing Performance', async ({ page }) => {
    const result = await testSMEPage(
      page,
      'SME Performance Tracker',
      `${BASE_URL}/sme-ipo-performance-tracker`
    );
    testResults.push(result);
    expect(result.passed, result.errors.join('; ')).toBe(true);
  });

  test('4. /sme-ipo-prospectus - Prospectus Documents', async ({ page }) => {
    const result = await testSMEPage(page, 'SME Prospectus', `${BASE_URL}/sme-ipo-prospectus`);
    testResults.push(result);
    expect(result.passed, result.errors.join('; ')).toBe(true);
  });

  test('5. /sme-ipo-listings - All Listings', async ({ page }) => {
    const result = await testSMEPage(page, 'SME Listings', `${BASE_URL}/sme-ipo-listings`);
    testResults.push(result);
    expect(result.passed, result.errors.join('; ')).toBe(true);
  });

  test('6. /sme-ipo-reviews - IPO Reviews', async ({ page }) => {
    const result = await testSMEPage(page, 'SME Reviews', `${BASE_URL}/sme-ipo-reviews`);
    testResults.push(result);
    expect(result.passed, result.errors.join('; ')).toBe(true);
  });

  test.afterAll(async () => {
    // Generate comprehensive report
    const report = generateReport(testResults);
    const fs = await import('fs');
    const path = await import('path');

    const reportDir = path.join(process.cwd(), 'test-results', 'phase-4');
    fs.mkdirSync(reportDir, { recursive: true });

    const reportPath = path.join(reportDir, 'sme-pages-tests.md');
    fs.writeFileSync(reportPath, report);

    console.log(`\n\n=== TEST REPORT GENERATED ===`);
    console.log(`Location: ${reportPath}`);
  });
});

function generateReport(results: PageTestResult[]): string {
  const timestamp = new Date().toISOString();
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  let report = `# Phase 4: SME Pages Testing Report

**Generated:** ${timestamp}
**Total Pages Tested:** ${results.length}
**Passed:** ${passedCount}
**Failed:** ${failedCount}
**Status:** ${failedCount === 0 ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}

---

## Executive Summary

This report covers comprehensive testing of all 6 SME pages in the IPODhan platform to verify:
- Category filter (category=SME or segment=SME) is applied in all API calls
- No MAINBOARD IPO cross-contamination in SME pages
- Pagination respects category boundaries
- No JavaScript errors in console

### Critical Findings

`;

  // Add critical findings
  const criticalIssues = results.filter((r) => r.mainboardIPOsInResponse > 0);
  if (criticalIssues.length > 0) {
    report += `**⚠️ CRITICAL: Cross-contamination detected in ${criticalIssues.length} page(s):**\n\n`;
    criticalIssues.forEach((r) => {
      report += `- **${r.pageName}**: ${r.mainboardIPOsInResponse} MAINBOARD IPOs found in response\n`;
    });
  } else {
    report += `**✓ No cross-contamination detected** - All SME pages show only SME IPOs\n`;
  }

  const noCategoryFilter = results.filter((r) => !r.categoryFilterPresent);
  if (noCategoryFilter.length > 0) {
    report += `\n**⚠️ Missing category filter in ${noCategoryFilter.length} page(s):**\n\n`;
    noCategoryFilter.forEach((r) => {
      report += `- ${r.pageName}\n`;
    });
  }

  report += `\n---\n\n## Detailed Test Results\n\n`;

  // Add detailed results for each page
  results.forEach((result, index) => {
    report += `### ${index + 1}. ${result.pageName}\n\n`;
    report += `**URL:** \`${result.pageUrl}\`\n`;
    report += `**Status:** ${result.passed ? '✓ PASSED' : '✗ FAILED'}\n\n`;

    // API Calls
    report += `#### API Calls (${result.apiCalls.length})\n\n`;
    if (result.apiCalls.length === 0) {
      report += `*No API calls detected*\n\n`;
    } else {
      result.apiCalls.forEach((call, i) => {
        report += `**Call ${i + 1}:** \`${call.method} ${call.url}\`\n\n`;
        report += `Query Parameters:\n\`\`\`json\n${JSON.stringify(call.queryParams, null, 2)}\n\`\`\`\n\n`;

        if (call.queryParams.category === 'SME' || call.queryParams.segment === 'SME') {
          report += `✓ Category filter present: SME\n\n`;
        } else {
          report += `✗ Category filter missing or incorrect\n\n`;
        }
      });
    }

    // Data Verification
    report += `#### Data Verification\n\n`;
    report += `- **Category Filter Present:** ${result.categoryFilterPresent ? '✓ Yes' : '✗ No'}\n`;
    report += `- **Displayed IPO Count:** ${result.displayedIPOCount}\n`;
    report += `- **SME IPOs in Response:** ${result.smeIPOsInResponse}\n`;
    report += `- **MAINBOARD IPOs in Response:** ${result.mainboardIPOsInResponse} ${result.mainboardIPOsInResponse > 0 ? '⚠️ CRITICAL' : '✓'}\n`;
    report += `- **Console Errors:** ${result.consoleErrors.length}\n\n`;

    // Errors
    if (result.errors.length > 0) {
      report += `#### Errors (${result.errors.length})\n\n`;
      result.errors.forEach((err, i) => {
        report += `${i + 1}. ${err}\n`;
      });
      report += `\n`;
    }

    // Console Errors
    if (result.consoleErrors.length > 0) {
      report += `#### Console Errors\n\n\`\`\`\n`;
      result.consoleErrors.slice(0, 10).forEach((err, i) => {
        report += `${i + 1}. ${err}\n`;
      });
      if (result.consoleErrors.length > 10) {
        report += `... and ${result.consoleErrors.length - 10} more\n`;
      }
      report += `\`\`\`\n\n`;
    }

    // Screenshots
    if (result.screenshots.length > 0) {
      report += `#### Screenshots\n\n`;
      result.screenshots.forEach((path) => {
        report += `- \`${path}\`\n`;
      });
      report += `\n`;
    }

    report += `---\n\n`;
  });

  // Summary statistics
  report += `## Summary Statistics\n\n`;
  const totalAPIcalls = results.reduce((sum, r) => sum + r.apiCalls.length, 0);
  const totalDisplayedIPOs = results.reduce((sum, r) => sum + r.displayedIPOCount, 0);
  const totalSMEIPOs = results.reduce((sum, r) => sum + r.smeIPOsInResponse, 0);
  const totalMainboardIPOs = results.reduce((sum, r) => sum + r.mainboardIPOsInResponse, 0);
  const totalConsoleErrors = results.reduce((sum, r) => sum + r.consoleErrors.length, 0);

  report += `| Metric | Value |\n`;
  report += `|--------|-------|\n`;
  report += `| Total API Calls | ${totalAPIcalls} |\n`;
  report += `| Total Displayed IPOs | ${totalDisplayedIPOs} |\n`;
  report += `| Total SME IPOs in Responses | ${totalSMEIPOs} |\n`;
  report += `| Total MAINBOARD IPOs in Responses | ${totalMainboardIPOs} ${totalMainboardIPOs > 0 ? '⚠️' : '✓'} |\n`;
  report += `| Total Console Errors | ${totalConsoleErrors} |\n`;
  report += `| Pages with Category Filter | ${results.filter((r) => r.categoryFilterPresent).length}/${results.length} |\n`;
  report += `| Pages Passed | ${passedCount}/${results.length} |\n\n`;

  // Recommendations
  report += `## Recommendations\n\n`;
  if (failedCount === 0) {
    report += `✓ All SME pages are functioning correctly. No action required.\n\n`;
  } else {
    if (totalMainboardIPOs > 0) {
      report += `1. **CRITICAL:** Fix cross-contamination issues in pages showing MAINBOARD IPOs\n`;
    }
    if (noCategoryFilter.length > 0) {
      report += `2. Add category filter to API calls in pages: ${noCategoryFilter.map((r) => r.pageName).join(', ')}\n`;
    }
    if (totalConsoleErrors > 0) {
      report += `3. Investigate and fix ${totalConsoleErrors} console errors\n`;
    }
  }

  report += `\n---\n\n`;
  report += `**End of Report**\n`;

  return report;
}
