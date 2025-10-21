/**
 * Simple Load Testing Script (Node.js)
 *
 * Alternative to k6 - uses Node.js fetch to simulate concurrent users
 * and measure response times for critical API endpoints
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CONCURRENT_USERS = parseInt(process.env.CONCURRENT_USERS) || 50;
const TEST_DURATION_SECONDS = parseInt(process.env.TEST_DURATION) || 120;
const RAMP_UP_SECONDS = parseInt(process.env.RAMP_UP) || 10;

// Test endpoints with realistic weights
const ENDPOINTS = [
  { url: '/api/ipos', weight: 30, name: 'IPO List' },
  { url: '/api/ipos?category=MAINBOARD', weight: 15, name: 'Mainboard IPOs' },
  { url: '/api/ipos?category=SME', weight: 10, name: 'SME IPOs' },
  { url: '/api/ipos?status=UPCOMING', weight: 15, name: 'Upcoming IPOs' },
  { url: '/api/ipos?status=OPEN', weight: 20, name: 'Open IPOs' },
  { url: '/api/subscription/latest', weight: 15, name: 'Latest Subscription' },
  { url: '/api/gmp/latest', weight: 10, name: 'Latest GMP' },
  { url: '/api/calendar', weight: 10, name: 'Calendar' },
];

// Metrics storage
const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  responseTimes: [],
  errors: [],
  byEndpoint: {},
};

// Initialize endpoint metrics
ENDPOINTS.forEach(ep => {
  metrics.byEndpoint[ep.name] = {
    count: 0,
    success: 0,
    failed: 0,
    responseTimes: [],
  };
});

// Select weighted random endpoint
function selectEndpoint() {
  const totalWeight = ENDPOINTS.reduce((sum, ep) => sum + ep.weight, 0);
  let random = Math.random() * totalWeight;

  for (const endpoint of ENDPOINTS) {
    random -= endpoint.weight;
    if (random <= 0) {
      return endpoint;
    }
  }

  return ENDPOINTS[0];
}

// Make request and record metrics
async function makeRequest(userId) {
  const endpoint = selectEndpoint();
  const url = `${BASE_URL}${endpoint.url}`;

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': `LoadTest-User-${userId}`,
      }
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    metrics.totalRequests++;
    metrics.responseTimes.push(duration);
    metrics.byEndpoint[endpoint.name].count++;
    metrics.byEndpoint[endpoint.name].responseTimes.push(duration);

    if (response.ok) {
      metrics.successfulRequests++;
      metrics.byEndpoint[endpoint.name].success++;
    } else {
      metrics.failedRequests++;
      metrics.byEndpoint[endpoint.name].failed++;
      metrics.errors.push({
        endpoint: endpoint.name,
        status: response.status,
        duration,
      });
    }

    return { success: response.ok, duration };
  } catch (error) {
    const duration = Date.now() - startTime;

    metrics.totalRequests++;
    metrics.failedRequests++;
    metrics.byEndpoint[endpoint.name].count++;
    metrics.byEndpoint[endpoint.name].failed++;
    metrics.errors.push({
      endpoint: endpoint.name,
      error: error.message,
      duration,
    });

    return { success: false, duration };
  }
}

// Calculate percentiles
function calculatePercentile(arr, percentile) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// User simulation
async function simulateUser(userId, startDelay) {
  // Ramp up delay
  await new Promise(resolve => setTimeout(resolve, startDelay));

  const userStartTime = Date.now();
  const userEndTime = userStartTime + (TEST_DURATION_SECONDS * 1000);

  while (Date.now() < userEndTime) {
    await makeRequest(userId);

    // Think time between requests (1-3 seconds)
    const thinkTime = Math.random() * 2000 + 1000;
    await new Promise(resolve => setTimeout(resolve, thinkTime));
  }
}

// Generate report
function generateReport() {
  const duration = TEST_DURATION_SECONDS + RAMP_UP_SECONDS;

  console.log('\n='.repeat(60));
  console.log('LOAD TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`\nTest Configuration:`);
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Concurrent Users: ${CONCURRENT_USERS}`);
  console.log(`  Test Duration: ${TEST_DURATION_SECONDS}s (+ ${RAMP_UP_SECONDS}s ramp-up)`);
  console.log(`  Total Duration: ${duration}s`);

  console.log(`\nOverall Metrics:`);
  console.log(`  Total Requests: ${metrics.totalRequests}`);
  console.log(`  Successful: ${metrics.successfulRequests} (${((metrics.successfulRequests/metrics.totalRequests)*100).toFixed(2)}%)`);
  console.log(`  Failed: ${metrics.failedRequests} (${((metrics.failedRequests/metrics.totalRequests)*100).toFixed(2)}%)`);
  console.log(`  Throughput: ${(metrics.totalRequests / duration).toFixed(2)} req/s`);

  console.log(`\nResponse Times (all endpoints):`);
  console.log(`  Min: ${Math.min(...metrics.responseTimes).toFixed(2)}ms`);
  console.log(`  Avg: ${(metrics.responseTimes.reduce((a,b) => a+b, 0) / metrics.responseTimes.length).toFixed(2)}ms`);
  console.log(`  p50: ${calculatePercentile(metrics.responseTimes, 50).toFixed(2)}ms`);
  console.log(`  p90: ${calculatePercentile(metrics.responseTimes, 90).toFixed(2)}ms`);
  console.log(`  p95: ${calculatePercentile(metrics.responseTimes, 95).toFixed(2)}ms`);
  console.log(`  p99: ${calculatePercentile(metrics.responseTimes, 99).toFixed(2)}ms`);
  console.log(`  Max: ${Math.max(...metrics.responseTimes).toFixed(2)}ms`);

  console.log(`\nPer-Endpoint Breakdown:`);
  console.log('='.repeat(60));

  Object.entries(metrics.byEndpoint).forEach(([name, data]) => {
    if (data.count === 0) return;

    const avg = data.responseTimes.reduce((a,b) => a+b, 0) / data.responseTimes.length;
    const p95 = calculatePercentile(data.responseTimes, 95);
    const p99 = calculatePercentile(data.responseTimes, 99);
    const successRate = (data.success / data.count * 100).toFixed(2);

    console.log(`\n${name}:`);
    console.log(`  Requests: ${data.count}`);
    console.log(`  Success Rate: ${successRate}%`);
    console.log(`  Avg Response: ${avg.toFixed(2)}ms`);
    console.log(`  p95: ${p95.toFixed(2)}ms`);
    console.log(`  p99: ${p99.toFixed(2)}ms`);
  });

  console.log(`\nThreshold Analysis:`);
  console.log('='.repeat(60));
  const p50 = calculatePercentile(metrics.responseTimes, 50);
  const p95 = calculatePercentile(metrics.responseTimes, 95);
  const p99 = calculatePercentile(metrics.responseTimes, 99);
  const errorRate = (metrics.failedRequests / metrics.totalRequests * 100);

  console.log(`  ✓ p50 < 200ms: ${p50 < 200 ? 'PASS' : 'FAIL'} (${p50.toFixed(2)}ms)`);
  console.log(`  ✓ p95 < 500ms: ${p95 < 500 ? 'PASS' : 'FAIL'} (${p95.toFixed(2)}ms)`);
  console.log(`  ✓ p99 < 1000ms: ${p99 < 1000 ? 'PASS' : 'FAIL'} (${p99.toFixed(2)}ms)`);
  console.log(`  ✓ Error rate < 1%: ${errorRate < 1 ? 'PASS' : 'FAIL'} (${errorRate.toFixed(2)}%)`);

  if (metrics.errors.length > 0 && metrics.errors.length <= 10) {
    console.log(`\nError Samples (first 10):`);
    metrics.errors.slice(0, 10).forEach((err, i) => {
      console.log(`  ${i+1}. ${err.endpoint}: ${err.status || err.error}`);
    });
  }

  console.log('\n' + '='.repeat(60));

  // Return structured results for JSON export
  return {
    config: {
      baseUrl: BASE_URL,
      concurrentUsers: CONCURRENT_USERS,
      testDuration: TEST_DURATION_SECONDS,
      rampUp: RAMP_UP_SECONDS,
    },
    summary: {
      totalRequests: metrics.totalRequests,
      successful: metrics.successfulRequests,
      failed: metrics.failedRequests,
      throughput: metrics.totalRequests / duration,
      errorRate: errorRate,
    },
    responseTimes: {
      min: Math.min(...metrics.responseTimes),
      avg: metrics.responseTimes.reduce((a,b) => a+b, 0) / metrics.responseTimes.length,
      p50,
      p90: calculatePercentile(metrics.responseTimes, 90),
      p95,
      p99,
      max: Math.max(...metrics.responseTimes),
    },
    thresholds: {
      p50_lt_200ms: p50 < 200,
      p95_lt_500ms: p95 < 500,
      p99_lt_1000ms: p99 < 1000,
      error_rate_lt_1pct: errorRate < 1,
    },
    byEndpoint: Object.entries(metrics.byEndpoint).reduce((acc, [name, data]) => {
      if (data.count === 0) return acc;
      acc[name] = {
        count: data.count,
        successRate: (data.success / data.count * 100),
        avgResponseTime: data.responseTimes.reduce((a,b) => a+b, 0) / data.responseTimes.length,
        p95: calculatePercentile(data.responseTimes, 95),
        p99: calculatePercentile(data.responseTimes, 99),
      };
      return acc;
    }, {}),
  };
}

// Main execution
async function main() {
  console.log('Starting load test...');
  console.log(`Configuration: ${CONCURRENT_USERS} users, ${TEST_DURATION_SECONDS}s duration, ${RAMP_UP_SECONDS}s ramp-up`);
  console.log(`Target: ${BASE_URL}\n`);

  const startTime = Date.now();

  // Create users with staggered start times
  const users = [];
  const rampUpDelay = (RAMP_UP_SECONDS * 1000) / CONCURRENT_USERS;

  for (let i = 0; i < CONCURRENT_USERS; i++) {
    users.push(simulateUser(i, i * rampUpDelay));
  }

  // Wait for all users to complete
  await Promise.all(users);

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nTest completed in ${totalDuration}s`);

  // Generate and export report
  const report = generateReport();

  // Save JSON report
  const fs = require('fs');
  const path = require('path');
  const outputPath = path.join(__dirname, '../../test-results/phase-5/simple-load-test-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { makeRequest, generateReport, calculatePercentile };
