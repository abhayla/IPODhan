/**
 * Manual SME Pages Testing Script
 * Tests all 6 SME pages by making HTTP requests and analyzing responses
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3000';

interface PageTest {
  name: string;
  url: string;
  passed: boolean;
  apiCalls: Array<{
    url: string;
    method: string;
    params: Record<string, string>;
    smeCount: number;
    mainboardCount: number;
  }>;
  errors: string[];
  categoryFilterPresent: boolean;
}

const results: PageTest[] = [];

async function testPage(browser: Browser, name: string, url: string): Promise<PageTest> {
  const page = await browser.newPage();
  const result: PageTest = {
    name,
    url,
    passed: true,
    apiCalls: [],
    errors: [],
    categoryFilterPresent: false,
  };

  try {
    console.log(`\n====== Testing: ${name} ======`);
    console.log(`URL: ${url}`);

    // Capture API calls
    page.on('response', async (response) => {
      const reqUrl = response.url();
      if (reqUrl.includes('/api/')) {
        try {
          const urlObj = new URL(reqUrl);
          const params: Record<string, string> = {};
          urlObj.searchParams.forEach((value, key) => {
            params[key] = value;
          });

          // Check for category filter
          if (params.category === 'SME' || params.segment === 'SME') {
            result.categoryFilterPresent = true;
          }

          let smeCount = 0;
          let mainboardCount = 0;

          if (response.ok() && response.headers()['content-type']?.includes('json')) {
            const data = await response.json();
            const ipos = data.data?.ipos || data.data || data.ipos || data;

            if (Array.isArray(ipos)) {
              ipos.forEach((ipo: any) => {
                const category = ipo.category || ipo.segment;
                if (category === 'SME') smeCount++;
                else if (category === 'MAINBOARD') mainboardCount++;
              });
            }
          }

          result.apiCalls.push({
            url: reqUrl,
            method: response.request().method(),
            params,
            smeCount,
            mainboardCount,
          });

          console.log(`  API: ${response.request().method()} ${reqUrl}`);
          console.log(`  Params:`, params);
          console.log(`  SME: ${smeCount}, MAINBOARD: ${mainboardCount}`);

          if (mainboardCount > 0) {
            const error = `MAINBOARD IPOs found: ${mainboardCount}`;
            result.errors.push(error);
            result.passed = false;
            console.log(`  ❌ ${error}`);
          }
        } catch (e) {
          console.error(`  Error processing response:`, e);
        }
      }
    });

    // Navigate and wait
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Validation
    if (!result.categoryFilterPresent) {
      result.errors.push('No SME category filter found in API calls');
      result.passed = false;
    }

    console.log(`Result: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    if (result.errors.length > 0) {
      console.log(`Errors:`, result.errors);
    }
  } catch (error) {
    result.passed = false;
    result.errors.push(`Test error: ${error}`);
    console.error(`Error testing ${name}:`, error);
  } finally {
    await page.close();
  }

  return result;
}

async function main() {
  console.log('Starting SME Pages Manual Test...\n');

  const browser = await chromium.launch({ headless: false });

  try {
    // Test all 6 pages
    results.push(await testPage(browser, 'SME Landing Page', `${BASE_URL}/sme-ipos`));
    results.push(await testPage(browser, 'SME Calendar', `${BASE_URL}/sme-ipo-calendar`));
    results.push(
      await testPage(browser, 'SME Performance Tracker', `${BASE_URL}/sme-ipo-performance-tracker`)
    );
    results.push(await testPage(browser, 'SME Prospectus', `${BASE_URL}/sme-ipo-prospectus`));
    results.push(await testPage(browser, 'SME Listings', `${BASE_URL}/sme-ipo-listings`));
    results.push(await testPage(browser, 'SME Reviews', `${BASE_URL}/sme-ipo-reviews`));

    // Generate report
    const report = generateReport(results);
    const reportDir = path.join(process.cwd(), 'test-results', 'phase-4');
    fs.mkdirSync(reportDir, { recursive: true });

    const reportPath = path.join(reportDir, 'sme-pages-tests.md');
    fs.writeFileSync(reportPath, report);

    console.log(`\n\n✅ Test complete!`);
    console.log(`Report saved to: ${reportPath}`);

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  } finally {
    await browser.close();
  }
}

function generateReport(results: PageTest[]): string {
  const timestamp = new Date().toISOString();
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  let report = `# Phase 4: SME Pages Testing Report

**Generated:** ${timestamp}
**Total Pages Tested:** ${results.length}
**Passed:** ${passed}
**Failed:** ${failed}
**Status:** ${failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}

---

## Executive Summary

This report covers comprehensive testing of all 6 SME pages to verify:
- Category filter (category=SME or segment=SME) applied in API calls
- No MAINBOARD IPO cross-contamination
- API response data integrity

`;

  // Critical findings
  const contaminated = results.filter((r) =>
    r.apiCalls.some((call) => call.mainboardCount > 0)
  );

  if (contaminated.length > 0) {
    report += `### ⚠️ CRITICAL ISSUES\n\n`;
    contaminated.forEach((r) => {
      const totalMainboard = r.apiCalls.reduce((sum, call) => sum + call.mainboardCount, 0);
      report += `- **${r.name}**: ${totalMainboard} MAINBOARD IPOs found\n`;
    });
    report += `\n`;
  } else {
    report += `### ✅ No Cross-Contamination Detected\n\nAll SME pages correctly filter for SME IPOs only.\n\n`;
  }

  const noFilter = results.filter((r) => !r.categoryFilterPresent);
  if (noFilter.length > 0) {
    report += `### ⚠️ Missing Category Filters\n\n`;
    noFilter.forEach((r) => {
      report += `- ${r.name}\n`;
    });
    report += `\n`;
  }

  report += `---\n\n## Detailed Results\n\n`;

  results.forEach((result, index) => {
    report += `### ${index + 1}. ${result.name}\n\n`;
    report += `**URL:** \`${result.url}\`\n`;
    report += `**Status:** ${result.passed ? '✅ PASSED' : '❌ FAILED'}\n`;
    report += `**Category Filter Present:** ${result.categoryFilterPresent ? '✅ Yes' : '❌ No'}\n\n`;

    if (result.apiCalls.length > 0) {
      report += `#### API Calls\n\n`;
      result.apiCalls.forEach((call, i) => {
        report += `**Call ${i + 1}:** \`${call.method} ${call.url}\`\n\n`;
        report += `Query Parameters:\n\`\`\`json\n${JSON.stringify(call.params, null, 2)}\n\`\`\`\n\n`;
        report += `- SME IPOs: ${call.smeCount}\n`;
        report += `- MAINBOARD IPOs: ${call.mainboardCount} ${call.mainboardCount > 0 ? '⚠️' : '✅'}\n\n`;
      });
    } else {
      report += `*No API calls detected*\n\n`;
    }

    if (result.errors.length > 0) {
      report += `#### Errors\n\n`;
      result.errors.forEach((err, i) => {
        report += `${i + 1}. ${err}\n`;
      });
      report += `\n`;
    }

    report += `---\n\n`;
  });

  // Statistics
  const totalAPICalls = results.reduce((sum, r) => sum + r.apiCalls.length, 0);
  const totalSME = results.reduce(
    (sum, r) => sum + r.apiCalls.reduce((s, call) => s + call.smeCount, 0),
    0
  );
  const totalMainboard = results.reduce(
    (sum, r) => sum + r.apiCalls.reduce((s, call) => s + call.mainboardCount, 0),
    0
  );

  report += `## Summary Statistics\n\n`;
  report += `| Metric | Value |\n`;
  report += `|--------|-------|\n`;
  report += `| Total API Calls | ${totalAPICalls} |\n`;
  report += `| Total SME IPOs | ${totalSME} |\n`;
  report += `| Total MAINBOARD IPOs | ${totalMainboard} ${totalMainboard > 0 ? '⚠️' : '✅'} |\n`;
  report += `| Pages with Category Filter | ${results.filter((r) => r.categoryFilterPresent).length}/${results.length} |\n`;
  report += `| Pages Passed | ${passed}/${results.length} |\n\n`;

  report += `## Recommendations\n\n`;
  if (failed === 0 && totalMainboard === 0) {
    report += `✅ All SME pages are functioning correctly. No action required.\n\n`;
  } else {
    if (totalMainboard > 0) {
      report += `1. **CRITICAL:** Fix cross-contamination - MAINBOARD IPOs appearing in SME pages\n`;
    }
    if (noFilter.length > 0) {
      report += `2. Add category/segment filter to API calls in: ${noFilter.map((r) => r.name).join(', ')}\n`;
    }
  }

  report += `\n---\n*End of Report*\n`;

  return report;
}

main().catch(console.error);
