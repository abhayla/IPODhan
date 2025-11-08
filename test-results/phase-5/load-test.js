// Performance Load Testing Script for IPODhan
// Node.js implementation for cross-platform compatibility

const https = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:3006';
const ITERATIONS = 100;
const CONCURRENT = 20;
const OUTPUT_FILE = 'D:\\Abhay\\VibeCoding\\IPODhan\\test-results\\phase-5\\load-test-results.json';

const endpoints = [
  { path: '/api/ipos?segment=MAINBOARD&limit=20', name: 'IPO List - Mainboard' },
  { path: '/api/ipos?status=OPEN&limit=20', name: 'IPO List - Open' },
  { path: '/api/ipos?status=UPCOMING&limit=20', name: 'IPO List - Upcoming' },
  { path: '/api/ipos?status=LISTED&limit=50', name: 'IPO List - Listed' },
  { path: '/api/ipos?segment=SME&limit=20', name: 'IPO List - SME' },
];

// Helper function to make HTTP request and measure time
function makeRequest(url) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const endTime = Date.now();
        resolve({
          status: res.statusCode,
          time: endTime - startTime,
          success: res.statusCode === 200
        });
      });
    }).on('error', () => {
      const endTime = Date.now();
      resolve({
        status: 0,
        time: endTime - startTime,
        success: false
      });
    });
  });
}

// Test a single endpoint
async function testEndpoint(endpoint) {
  console.log(`\nTesting: ${endpoint.name}`);
  console.log(`Endpoint: ${endpoint.path}`);

  const times = [];
  let success = 0;
  let failed = 0;

  // Warm-up request
  await makeRequest(BASE_URL + endpoint.path);

  // Sequential test
  console.log(`Running ${ITERATIONS} sequential requests...`);
  const startTest = Date.now();

  for (let i = 0; i < ITERATIONS; i++) {
    const result = await makeRequest(BASE_URL + endpoint.path);

    if (result.success) {
      times.push(result.time);
      success++;
    } else {
      failed++;
    }

    if ((i + 1) % 10 === 0) {
      process.stdout.write('.');
    }
  }

  const endTest = Date.now();
  const totalTestTime = (endTest - startTest) / 1000; // seconds

  console.log(' Done!');

  // Calculate statistics
  if (times.length === 0) {
    return {
      endpoint: endpoint.name,
      path: endpoint.path,
      error: 'All requests failed'
    };
  }

  times.sort((a, b) => a - b);

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = times[0];
  const max = times[times.length - 1];
  const p50 = times[Math.floor(times.length * 0.50)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const rps = success / totalTestTime;

  const results = {
    endpoint: endpoint.name,
    path: endpoint.path,
    iterations: ITERATIONS,
    success,
    failed,
    errorRate: ((failed / ITERATIONS) * 100).toFixed(2) + '%',
    times: {
      min: `${min}ms`,
      max: `${max}ms`,
      avg: `${avg.toFixed(2)}ms`,
      p50: `${p50}ms`,
      p95: `${p95}ms`,
      p99: `${p99}ms`
    },
    performance: {
      rps: rps.toFixed(2),
      totalTime: `${totalTestTime.toFixed(2)}s`
    },
    targets: {
      p95: {
        value: p95,
        target: 500,
        status: p95 < 500 ? '✅ PASS' : '❌ FAIL'
      },
      p99: {
        value: p99,
        target: 1000,
        status: p99 < 1000 ? '✅ PASS' : '❌ FAIL'
      }
    }
  };

  // Print results
  console.log('\nResults:');
  console.log(`  Success: ${success}/${ITERATIONS}`);
  console.log(`  Failed: ${failed}/${ITERATIONS}`);
  console.log(`  Error Rate: ${results.errorRate}`);
  console.log(`  Min: ${min}ms`);
  console.log(`  Avg: ${avg.toFixed(2)}ms`);
  console.log(`  p50: ${p50}ms`);
  console.log(`  p95: ${p95}ms ${results.targets.p95.status}`);
  console.log(`  p99: ${p99}ms ${results.targets.p99.status}`);
  console.log(`  Max: ${max}ms`);
  console.log(`  RPS: ${rps.toFixed(2)} requests/sec`);

  return results;
}

// Test all endpoints with concurrent requests
async function testConcurrent(endpoint, concurrency) {
  console.log(`\nConcurrent Test: ${endpoint.name} (${concurrency} concurrent)`);

  const times = [];
  const startTime = Date.now();

  // Run requests in batches
  for (let i = 0; i < ITERATIONS; i += concurrency) {
    const batch = [];
    const batchSize = Math.min(concurrency, ITERATIONS - i);

    for (let j = 0; j < batchSize; j++) {
      batch.push(makeRequest(BASE_URL + endpoint.path));
    }

    const results = await Promise.all(batch);
    results.forEach(r => {
      if (r.success) times.push(r.time);
    });

    process.stdout.write('.');
  }

  const endTime = Date.now();
  const totalTime = (endTime - startTime) / 1000;

  console.log(' Done!');

  if (times.length === 0) {
    return { error: 'All requests failed' };
  }

  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const rps = times.length / totalTime;

  console.log(`  Avg: ${avg.toFixed(2)}ms`);
  console.log(`  p95: ${p95}ms`);
  console.log(`  p99: ${p99}ms`);
  console.log(`  RPS: ${rps.toFixed(2)} requests/sec`);

  return {
    concurrency,
    avg: `${avg.toFixed(2)}ms`,
    p95: `${p95}ms`,
    p99: `${p99}ms`,
    rps: rps.toFixed(2)
  };
}

// Main execution
async function main() {
  console.log('=== IPODhan Performance Load Testing ===');
  console.log(`Start Time: ${new Date().toISOString()}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Concurrent: ${CONCURRENT}`);

  const allResults = {
    metadata: {
      startTime: new Date().toISOString(),
      baseUrl: BASE_URL,
      iterations: ITERATIONS,
      concurrent: CONCURRENT
    },
    sequential: [],
    concurrent: []
  };

  // Sequential tests
  console.log('\n=== Sequential Load Tests ===');
  for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint);
    allResults.sequential.push(result);

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Concurrent tests (on most critical endpoint)
  console.log('\n=== Concurrent Load Tests ===');
  const criticalEndpoint = endpoints[0]; // Mainboard list
  const concurrentResult = await testConcurrent(criticalEndpoint, CONCURRENT);
  allResults.concurrent.push({
    endpoint: criticalEndpoint.name,
    ...concurrentResult
  });

  // Save results
  allResults.metadata.endTime = new Date().toISOString();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));

  console.log('\n=== Load Testing Complete ===');
  console.log(`Results saved to: ${OUTPUT_FILE}`);

  // Summary
  console.log('\n=== Performance Summary ===');
  allResults.sequential.forEach(result => {
    if (!result.error) {
      console.log(`${result.endpoint}:`);
      console.log(`  p95: ${result.times.p95} ${result.targets.p95.status}`);
      console.log(`  p99: ${result.times.p99} ${result.targets.p99.status}`);
    }
  });
}

main().catch(console.error);
