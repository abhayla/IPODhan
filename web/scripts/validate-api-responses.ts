import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

interface IPO {
  id: string;
  companyName: string;
  segment: string;
  status: string;
  slug: string;
}

interface APIResponse {
  success: boolean;
  data: IPO[];
  meta?: any;
}

interface ValidationResult {
  endpoint: string;
  totalIPOs: number;
  expectedSegment: string;
  violations: any[];
  status: 'PASS' | 'FAIL';
  sampleIPOs?: any[];
}

const BASE_URL = 'http://localhost:3000';
const results: ValidationResult[] = [];

async function validateEndpoint(
  endpoint: string,
  expectedSegment: string,
  description: string
): Promise<ValidationResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${description}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Expected Segment: ${expectedSegment}`);
  console.log('='.repeat(80));

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const data: APIResponse = await response.json();

    if (!data.success) {
      console.error('❌ API returned success=false');
      return {
        endpoint,
        totalIPOs: 0,
        expectedSegment,
        violations: [{ error: 'API returned success=false' }],
        status: 'FAIL'
      };
    }

    const totalIPOs = data.data.length;
    console.log(`Total IPOs returned: ${totalIPOs}`);

    // Check for violations
    const violations: any[] = [];
    data.data.forEach((ipo, index) => {
      if (ipo.segment !== expectedSegment) {
        violations.push({
          index,
          companyName: ipo.companyName,
          expectedSegment,
          actualSegment: ipo.segment,
          id: ipo.id,
          slug: ipo.slug,
          status: ipo.status
        });
      }
    });

    // Show sample IPOs
    const sampleSize = Math.min(5, totalIPOs);
    const sampleIPOs = data.data.slice(0, sampleSize).map(ipo => ({
      companyName: ipo.companyName,
      segment: ipo.segment,
      status: ipo.status
    }));

    console.log(`\nSample IPOs (first ${sampleSize}):`);
    sampleIPOs.forEach((ipo, idx) => {
      console.log(`  ${idx + 1}. ${ipo.companyName} - ${ipo.segment} (${ipo.status})`);
    });

    // Report violations
    if (violations.length > 0) {
      console.error(`\n❌ CRITICAL: Found ${violations.length} cross-contamination violations!`);
      violations.forEach((v, idx) => {
        console.error(`  ${idx + 1}. ${v.companyName}: expected=${v.expectedSegment}, actual=${v.actualSegment}`);
      });
    } else {
      console.log('\n✓ PASS: No cross-contamination detected');
    }

    return {
      endpoint,
      totalIPOs,
      expectedSegment,
      violations,
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      sampleIPOs
    };
  } catch (error: any) {
    console.error('❌ Failed to fetch endpoint:', error.message);
    return {
      endpoint,
      totalIPOs: 0,
      expectedSegment,
      violations: [{ error: error.message }],
      status: 'FAIL'
    };
  }
}

async function validateSpecialCategory(
  endpoint: string,
  categoryName: string
): Promise<{ exists: boolean; status: number; error?: string }> {
  console.log(`\nChecking special category: ${categoryName}`);
  console.log(`Endpoint: ${endpoint}`);

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const exists = response.status !== 404;

    console.log(`Status: ${response.status} - ${exists ? 'EXISTS' : 'NOT FOUND'}`);

    return {
      exists,
      status: response.status
    };
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    return {
      exists: false,
      status: 0,
      error: error.message
    };
  }
}

async function main() {
  console.log('\n' + '#'.repeat(80));
  console.log('# PHASE 4: API RESPONSE CROSS-CONTAMINATION VALIDATION');
  console.log('#'.repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Base URL: ${BASE_URL}`);

  // Test 1: MAINBOARD API (all statuses)
  const mainboardAll = await validateEndpoint(
    '/api/ipos?category=MAINBOARD&status=all&limit=100',
    'MAINBOARD',
    'MAINBOARD IPOs - All Statuses'
  );
  results.push(mainboardAll);

  // Test 2: MAINBOARD API (open only)
  const mainboardOpen = await validateEndpoint(
    '/api/ipos?category=MAINBOARD&status=open&limit=50',
    'MAINBOARD',
    'MAINBOARD IPOs - Open Only'
  );
  results.push(mainboardOpen);

  // Test 3: MAINBOARD API (upcoming)
  const mainboardUpcoming = await validateEndpoint(
    '/api/ipos?category=MAINBOARD&status=upcoming&limit=50',
    'MAINBOARD',
    'MAINBOARD IPOs - Upcoming'
  );
  results.push(mainboardUpcoming);

  // Test 4: SME API (all statuses)
  const smeAll = await validateEndpoint(
    '/api/ipos?category=SME&status=all&limit=100',
    'SME',
    'SME IPOs - All Statuses'
  );
  results.push(smeAll);

  // Test 5: SME API (open only)
  const smeOpen = await validateEndpoint(
    '/api/ipos?category=SME&status=open&limit=50',
    'SME',
    'SME IPOs - Open Only'
  );
  results.push(smeOpen);

  // Test 6: SME API (upcoming)
  const smeUpcoming = await validateEndpoint(
    '/api/ipos?category=SME&status=upcoming&limit=50',
    'SME',
    'SME IPOs - Upcoming'
  );
  results.push(smeUpcoming);

  // Test Special Categories
  console.log('\n' + '='.repeat(80));
  console.log('SPECIAL CATEGORIES AVAILABILITY');
  console.log('='.repeat(80));

  const specialCategories = {
    OFS: await validateSpecialCategory('/ofs-ipos', 'OFS (Offer for Sale)'),
    NCD: await validateSpecialCategory('/ncd-ipos', 'NCD (Non-Convertible Debentures)'),
    Rights: await validateSpecialCategory('/rights-issues', 'Rights Issues'),
    FPO: await validateSpecialCategory('/fpo-ipos', 'FPO (Follow-on Public Offering)')
  };

  // Generate Summary
  console.log('\n' + '#'.repeat(80));
  console.log('# VALIDATION SUMMARY');
  console.log('#'.repeat(80));

  const totalTests = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const totalViolations = results.reduce((sum, r) => sum + r.violations.length, 0);

  console.log(`Total API Tests: ${totalTests}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Violations: ${totalViolations}`);
  console.log(`\nCross-Contamination Status: ${totalViolations === 0 ? '✓ ZERO DETECTED' : '✗ VIOLATIONS FOUND'}`);

  console.log('\nSpecial Categories:');
  console.log(`  OFS: ${specialCategories.OFS.exists ? '✓ EXISTS' : '✗ NOT FOUND'}`);
  console.log(`  NCD: ${specialCategories.NCD.exists ? '✓ EXISTS' : '✗ NOT FOUND'}`);
  console.log(`  Rights: ${specialCategories.Rights.exists ? '✓ EXISTS' : '✗ NOT FOUND'}`);
  console.log(`  FPO: ${specialCategories.FPO.exists ? '✓ EXISTS' : '✗ NOT FOUND'}`);

  // Save results
  const reportDir = path.join(process.cwd(), 'test-results', 'phase-4');
  fs.mkdirSync(reportDir, { recursive: true });

  const reportPath = path.join(reportDir, 'api-response-validation.json');
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    summary: {
      totalTests,
      passed,
      failed,
      totalViolations,
      crossContamination: totalViolations === 0 ? 'ZERO' : 'DETECTED'
    },
    apiTests: results,
    specialCategories
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  // Exit with error if violations found
  if (totalViolations > 0) {
    console.error('\n❌ VALIDATION FAILED: Cross-contamination detected');
    process.exit(1);
  } else {
    console.log('\n✓ VALIDATION PASSED: Zero cross-contamination');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
