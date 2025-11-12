import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface APIResponse {
  success: boolean;
  data: any[];
  meta?: any;
}

interface ValidationResult {
  page: string;
  url: string;
  totalIPOs: number;
  expectedSegment: string;
  violations: any[];
  status: 'PASS' | 'FAIL';
  screenshot?: string;
  apiResponse?: any;
}

const results: ValidationResult[] = [];

test.describe('Phase 4: Cross-Contamination Validation', () => {
  test.beforeAll(async () => {
    // Ensure results directory exists
    const resultsDir = path.join(process.cwd(), 'test-results', 'phase-4');
    fs.mkdirSync(resultsDir, { recursive: true });
  });

  test('1. MAINBOARD Page - No SME Cross-Contamination', async ({ page }) => {
    console.log('\n=== Testing MAINBOARD Page ===');

    // Navigate to mainboard page
    await page.goto('http://localhost:3000/mainboard-ipos');
    await page.waitForLoadState('networkidle');

    // Take screenshot
    const screenshotPath = path.join('test-results', 'phase-4', 'mainboard-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Capture API response by intercepting network
    let apiData: any = null;
    page.on('response', async (response) => {
      if (response.url().includes('/api/ipos') && response.url().includes('category=MAINBOARD')) {
        try {
          apiData = await response.json();
          console.log('Captured MAINBOARD API response');
        } catch (e) {
          console.error('Failed to parse API response:', e);
        }
      }
    });

    // Reload to trigger API call
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Give time for API capture

    // Validate API response
    const violations: any[] = [];
    let totalIPOs = 0;

    if (apiData && apiData.data) {
      totalIPOs = apiData.data.length;
      console.log(`Total IPOs in MAINBOARD API: ${totalIPOs}`);

      // Check each IPO for segment violation
      apiData.data.forEach((ipo: any, index: number) => {
        if (ipo.segment !== 'MAINBOARD') {
          violations.push({
            index,
            companyName: ipo.companyName || ipo.company_name,
            expectedSegment: 'MAINBOARD',
            actualSegment: ipo.segment,
            id: ipo.id,
            slug: ipo.slug
          });
          console.error(`❌ VIOLATION: ${ipo.companyName} has segment=${ipo.segment}`);
        }
      });
    }

    // Record results
    results.push({
      page: 'MAINBOARD IPOs',
      url: '/mainboard-ipos',
      totalIPOs,
      expectedSegment: 'MAINBOARD',
      violations,
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      screenshot: screenshotPath,
      apiResponse: apiData
    });

    // Assert no violations
    expect(violations.length, `Found ${violations.length} segment violations in MAINBOARD page`).toBe(0);

    console.log(`✓ MAINBOARD validation: ${violations.length === 0 ? 'PASS' : 'FAIL'}`);
  });

  test('2. SME Page - No MAINBOARD Cross-Contamination', async ({ page }) => {
    console.log('\n=== Testing SME Page ===');

    // Navigate to SME page
    await page.goto('http://localhost:3000/sme-ipos');
    await page.waitForLoadState('networkidle');

    // Take screenshot
    const screenshotPath = path.join('test-results', 'phase-4', 'sme-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Capture API response
    let apiData: any = null;
    page.on('response', async (response) => {
      if (response.url().includes('/api/ipos') && response.url().includes('category=SME')) {
        try {
          apiData = await response.json();
          console.log('Captured SME API response');
        } catch (e) {
          console.error('Failed to parse API response:', e);
        }
      }
    });

    // Reload to trigger API call
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Validate API response
    const violations: any[] = [];
    let totalIPOs = 0;

    if (apiData && apiData.data) {
      totalIPOs = apiData.data.length;
      console.log(`Total IPOs in SME API: ${totalIPOs}`);

      // Check each IPO for segment violation
      apiData.data.forEach((ipo: any, index: number) => {
        if (ipo.segment !== 'SME') {
          violations.push({
            index,
            companyName: ipo.companyName || ipo.company_name,
            expectedSegment: 'SME',
            actualSegment: ipo.segment,
            id: ipo.id,
            slug: ipo.slug
          });
          console.error(`❌ VIOLATION: ${ipo.companyName} has segment=${ipo.segment}`);
        }
      });
    }

    // Record results
    results.push({
      page: 'SME IPOs',
      url: '/sme-ipos',
      totalIPOs,
      expectedSegment: 'SME',
      violations,
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      screenshot: screenshotPath,
      apiResponse: apiData
    });

    // Assert no violations
    expect(violations.length, `Found ${violations.length} segment violations in SME page`).toBe(0);

    console.log(`✓ SME validation: ${violations.length === 0 ? 'PASS' : 'FAIL'}`);
  });

  test('3. Direct API Test - MAINBOARD Endpoint', async ({ request }) => {
    console.log('\n=== Testing MAINBOARD API Endpoint ===');

    const response = await request.get('http://localhost:3000/api/ipos?category=MAINBOARD&status=all&limit=100');
    const apiData: APIResponse = await response.json();

    expect(response.ok()).toBeTruthy();
    expect(apiData.success).toBe(true);

    const violations: any[] = [];
    const totalIPOs = apiData.data.length;

    console.log(`Total IPOs: ${totalIPOs}`);

    apiData.data.forEach((ipo: any, index: number) => {
      if (ipo.segment !== 'MAINBOARD') {
        violations.push({
          index,
          companyName: ipo.companyName || ipo.company_name,
          expectedSegment: 'MAINBOARD',
          actualSegment: ipo.segment,
          id: ipo.id
        });
      }
    });

    results.push({
      page: 'API: MAINBOARD',
      url: '/api/ipos?category=MAINBOARD',
      totalIPOs,
      expectedSegment: 'MAINBOARD',
      violations,
      status: violations.length === 0 ? 'PASS' : 'FAIL'
    });

    expect(violations.length).toBe(0);
    console.log(`✓ MAINBOARD API: ${violations.length === 0 ? 'PASS' : 'FAIL'}`);
  });

  test('4. Direct API Test - SME Endpoint', async ({ request }) => {
    console.log('\n=== Testing SME API Endpoint ===');

    const response = await request.get('http://localhost:3000/api/ipos?category=SME&status=all&limit=100');
    const apiData: APIResponse = await response.json();

    expect(response.ok()).toBeTruthy();
    expect(apiData.success).toBe(true);

    const violations: any[] = [];
    const totalIPOs = apiData.data.length;

    console.log(`Total IPOs: ${totalIPOs}`);

    apiData.data.forEach((ipo: any, index: number) => {
      if (ipo.segment !== 'SME') {
        violations.push({
          index,
          companyName: ipo.companyName || ipo.company_name,
          expectedSegment: 'SME',
          actualSegment: ipo.segment,
          id: ipo.id
        });
      }
    });

    results.push({
      page: 'API: SME',
      url: '/api/ipos?category=SME',
      totalIPOs,
      expectedSegment: 'SME',
      violations,
      status: violations.length === 0 ? 'PASS' : 'FAIL'
    });

    expect(violations.length).toBe(0);
    console.log(`✓ SME API: ${violations.length === 0 ? 'PASS' : 'FAIL'}`);
  });

  test('5. Special Categories - NCD Page', async ({ page }) => {
    console.log('\n=== Testing NCD Page ===');

    // Try to navigate to NCD page
    const response = await page.goto('http://localhost:3000/ncd-ipos', {
      waitUntil: 'networkidle',
      timeout: 10000
    });

    const screenshotPath = path.join('test-results', 'phase-4', 'ncd-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const pageExists = response?.status() !== 404;

    results.push({
      page: 'NCD IPOs',
      url: '/ncd-ipos',
      totalIPOs: 0,
      expectedSegment: 'NCD',
      violations: [],
      status: pageExists ? 'PASS' : 'FAIL',
      screenshot: screenshotPath
    });

    console.log(`NCD page status: ${pageExists ? 'EXISTS' : 'NOT FOUND (404)'}`);
  });

  test('6. Special Categories - OFS Page', async ({ page }) => {
    console.log('\n=== Testing OFS Page ===');

    const response = await page.goto('http://localhost:3000/ofs-ipos', {
      waitUntil: 'networkidle',
      timeout: 10000
    });

    const screenshotPath = path.join('test-results', 'phase-4', 'ofs-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const pageExists = response?.status() !== 404;

    results.push({
      page: 'OFS IPOs',
      url: '/ofs-ipos',
      totalIPOs: 0,
      expectedSegment: 'OFS',
      violations: [],
      status: pageExists ? 'PASS' : 'FAIL',
      screenshot: screenshotPath
    });

    console.log(`OFS page status: ${pageExists ? 'EXISTS' : 'NOT FOUND (404)'}`);
  });

  test('7. Special Categories - Rights Issues Page', async ({ page }) => {
    console.log('\n=== Testing Rights Issues Page ===');

    const response = await page.goto('http://localhost:3000/rights-issues', {
      waitUntil: 'networkidle',
      timeout: 10000
    });

    const screenshotPath = path.join('test-results', 'phase-4', 'rights-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const pageExists = response?.status() !== 404;

    results.push({
      page: 'Rights Issues',
      url: '/rights-issues',
      totalIPOs: 0,
      expectedSegment: 'RIGHTS',
      violations: [],
      status: pageExists ? 'PASS' : 'FAIL',
      screenshot: screenshotPath
    });

    console.log(`Rights page status: ${pageExists ? 'EXISTS' : 'NOT FOUND (404)'}`);
  });

  test('8. Special Categories - FPO Page', async ({ page }) => {
    console.log('\n=== Testing FPO Page ===');

    const response = await page.goto('http://localhost:3000/fpo-ipos', {
      waitUntil: 'networkidle',
      timeout: 10000
    });

    const screenshotPath = path.join('test-results', 'phase-4', 'fpo-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const pageExists = response?.status() !== 404;

    results.push({
      page: 'FPO IPOs',
      url: '/fpo-ipos',
      totalIPOs: 0,
      expectedSegment: 'FPO',
      violations: [],
      status: pageExists ? 'PASS' : 'FAIL',
      screenshot: screenshotPath
    });

    console.log(`FPO page status: ${pageExists ? 'EXISTS' : 'NOT FOUND (404)'}`);
  });

  test.afterAll(async () => {
    // Generate summary report
    const reportPath = path.join(process.cwd(), 'test-results', 'phase-4', 'api-validation-results.json');

    const summary = {
      timestamp: new Date().toISOString(),
      testMode: 'Headed Playwright + API Testing',
      totalTests: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      criticalViolations: results.filter(r => r.violations.length > 0),
      crossContaminationDetected: results.some(r => r.violations.length > 0) ? 'YES' : 'NO',
      results
    };

    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('API VALIDATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Cross-Contamination: ${summary.crossContaminationDetected}`);
    console.log(`Report: ${reportPath}`);
  });
});
