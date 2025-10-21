/**
 * Phase 4: Mainboard API Testing Script
 *
 * Tests all 6 Mainboard page API endpoints to verify:
 * 1. segment=MAINBOARD filter is applied
 * 2. No SME cross-contamination
 * 3. Response counts match database
 */

const http = require('http');

const BASE_URL = 'http://localhost:3006';
const EXPECTED_MAINBOARD_COUNT = 223; // From database

// API endpoints to test
const API_TESTS = [
  {
    name: 'Mainboard IPOs List',
    path: '/api/ipos?segment=MAINBOARD&limit=50',
    page: '/mainboard-ipos',
    checkSegment: true,
    checkCount: true,
  },
  {
    name: 'Mainboard Calendar',
    path: '/api/ipos?segment=MAINBOARD&status=UPCOMING&limit=20',
    page: '/mainboard-ipo-calendar',
    checkSegment: true,
    checkCount: false, // Only UPCOMING subset
  },
  {
    name: 'Mainboard Performance Tracker',
    path: '/api/ipos?segment=MAINBOARD&status=LISTED&limit=50',
    page: '/mainboard-ipo-performance-tracker',
    checkSegment: true,
    checkCount: false, // Only LISTED subset
  },
  {
    name: 'Mainboard Prospectus',
    path: '/api/ipos?segment=MAINBOARD&limit=50',
    page: '/mainboard-ipo-prospectus',
    checkSegment: true,
    checkCount: false,
  },
  {
    name: 'Mainboard Listings',
    path: '/api/ipos?segment=MAINBOARD&status=LISTED&limit=50',
    page: '/mainboard-ipo-listings',
    checkSegment: true,
    checkCount: false, // Only LISTED subset
  },
  {
    name: 'Mainboard Reviews',
    path: '/api/ipos?segment=MAINBOARD&limit=20',
    page: '/mainboard-ipo-reviews',
    checkSegment: true,
    checkCount: false,
  },
];

/**
 * Make HTTP GET request
 */
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    http.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Validate API response
 */
function validateResponse(test, response) {
  const results = {
    testName: test.name,
    page: test.page,
    apiPath: test.path,
    status: 'PASS',
    issues: [],
    stats: {
      totalIPOs: 0,
      mainboardIPOs: 0,
      smeIPOs: 0,
      otherIPOs: 0,
    },
  };

  // Check response structure
  if (!response.data || !Array.isArray(response.data.data)) {
    results.status = 'FAIL';
    results.issues.push('Invalid response structure: missing data array');
    return results;
  }

  const ipos = response.data.data;
  results.stats.totalIPOs = ipos.length;

  // Check each IPO's segment
  ipos.forEach((ipo, index) => {
    if (!ipo.segment) {
      results.stats.otherIPOs++;
      results.issues.push(`IPO at index ${index} (${ipo.companyName}) has null segment`);
    } else if (ipo.segment === 'MAINBOARD') {
      results.stats.mainboardIPOs++;
    } else if (ipo.segment === 'SME') {
      results.stats.smeIPOs++;
      results.status = 'FAIL';
      results.issues.push(`CRITICAL: SME IPO found at index ${index}: ${ipo.companyName}`);
    } else {
      results.stats.otherIPOs++;
      results.issues.push(`Unknown segment "${ipo.segment}" at index ${index}: ${ipo.companyName}`);
    }
  });

  // Check for SME cross-contamination
  if (test.checkSegment && results.stats.smeIPOs > 0) {
    results.status = 'FAIL';
    results.issues.unshift(`CRITICAL: Found ${results.stats.smeIPOs} SME IPOs in MAINBOARD results`);
  }

  // Check total count if applicable
  if (test.checkCount && response.data.pagination) {
    const totalFromAPI = response.data.pagination.total;
    const diff = Math.abs(totalFromAPI - EXPECTED_MAINBOARD_COUNT);
    const percentDiff = (diff / EXPECTED_MAINBOARD_COUNT) * 100;

    results.stats.totalFromAPI = totalFromAPI;
    results.stats.expectedTotal = EXPECTED_MAINBOARD_COUNT;
    results.stats.difference = diff;
    results.stats.percentDiff = percentDiff.toFixed(2) + '%';

    if (percentDiff > 10) {
      results.status = 'WARN';
      results.issues.push(`Count mismatch: API reports ${totalFromAPI}, DB has ${EXPECTED_MAINBOARD_COUNT} (${results.stats.percentDiff} diff)`);
    }
  }

  // Add pagination info
  if (response.data.pagination) {
    results.pagination = response.data.pagination;
  }

  return results;
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('='.repeat(80));
  console.log('Phase 4: Mainboard Pages API Testing');
  console.log('='.repeat(80));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Expected MAINBOARD IPOs in DB: ${EXPECTED_MAINBOARD_COUNT}`);
  console.log(`Test Time: ${new Date().toISOString()}`);
  console.log('='.repeat(80));
  console.log('');

  const allResults = [];
  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  for (const test of API_TESTS) {
    console.log(`Testing: ${test.name}`);
    console.log(`API: ${test.path}`);
    console.log(`Page: ${test.page}`);

    try {
      const response = await makeRequest(test.path);

      if (response.status !== 200) {
        console.log(`  ❌ FAIL: HTTP ${response.status}`);
        failCount++;
        allResults.push({
          testName: test.name,
          status: 'FAIL',
          issues: [`HTTP ${response.status}`],
        });
        continue;
      }

      const results = validateResponse(test, response);
      allResults.push(results);

      // Print results
      console.log(`  Status: ${results.status}`);
      console.log(`  Total IPOs: ${results.stats.totalIPOs}`);
      console.log(`  Mainboard IPOs: ${results.stats.mainboardIPOs}`);
      console.log(`  SME IPOs: ${results.stats.smeIPOs}`);

      if (results.stats.otherIPOs > 0) {
        console.log(`  Other/Null Segment: ${results.stats.otherIPOs}`);
      }

      if (results.pagination) {
        console.log(`  Total in DB (from API): ${results.pagination.total}`);
      }

      if (results.issues.length > 0) {
        console.log(`  Issues (${results.issues.length}):`);
        results.issues.forEach((issue) => {
          console.log(`    - ${issue}`);
        });
      }

      if (results.status === 'PASS') {
        console.log(`  ✅ PASS`);
        passCount++;
      } else if (results.status === 'WARN') {
        console.log(`  ⚠️  WARN`);
        warnCount++;
      } else {
        console.log(`  ❌ FAIL`);
        failCount++;
      }

    } catch (error) {
      console.log(`  ❌ ERROR: ${error.message}`);
      failCount++;
      allResults.push({
        testName: test.name,
        status: 'FAIL',
        issues: [error.message],
      });
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('Test Summary');
  console.log('='.repeat(80));
  console.log(`Total Tests: ${API_TESTS.length}`);
  console.log(`✅ Passed: ${passCount}`);
  console.log(`⚠️  Warnings: ${warnCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log('');

  // Critical Issues Summary
  const criticalIssues = allResults
    .filter(r => r.issues && r.issues.some(i => i.includes('CRITICAL')))
    .map(r => ({
      test: r.testName,
      issues: r.issues.filter(i => i.includes('CRITICAL')),
    }));

  if (criticalIssues.length > 0) {
    console.log('⚠️  CRITICAL ISSUES FOUND:');
    criticalIssues.forEach(({ test, issues }) => {
      console.log(`\n${test}:`);
      issues.forEach(issue => console.log(`  - ${issue}`));
    });
    console.log('');
  }

  // Overall Status
  if (failCount > 0) {
    console.log('❌ OVERALL STATUS: FAILED');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log('⚠️  OVERALL STATUS: PASSED WITH WARNINGS');
    process.exit(0);
  } else {
    console.log('✅ OVERALL STATUS: ALL TESTS PASSED');
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
