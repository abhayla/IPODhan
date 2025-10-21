/**
 * API Performance Test Script
 *
 * Tests API endpoint performance with and without Redis
 */

interface TestResult {
  endpoint: string;
  status: number;
  responseTime: number;
  success: boolean;
  error?: string;
  cacheStatus?: 'HIT' | 'MISS' | 'ERROR';
}

async function testEndpoint(url: string): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(url);
    const responseTime = Date.now() - startTime;

    return {
      endpoint: url,
      status: response.status,
      responseTime,
      success: response.ok,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      endpoint: url,
      status: 0,
      responseTime,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runTests(label: string): Promise<TestResult[]> {
  const baseUrl = 'http://localhost:3007';
  const endpoints = [
    '/api/ipos/open',
    '/api/ipos/upcoming',
    '/api/ipos/closed',
    '/api/health',
  ];

  console.log(`\n=== ${label} ===\n`);

  const results: TestResult[] = [];

  for (const endpoint of endpoints) {
    const url = `${baseUrl}${endpoint}`;
    console.log(`Testing: ${endpoint}`);

    // Run 3 times and take average
    const times: number[] = [];
    let lastResult: TestResult | null = null;

    for (let i = 0; i < 3; i++) {
      const result = await testEndpoint(url);
      times.push(result.responseTime);
      lastResult = result;

      if (!result.success) {
        console.log(`  Attempt ${i + 1}: ✗ ${result.status} (${result.responseTime}ms) - ${result.error || 'Failed'}`);
      } else {
        console.log(`  Attempt ${i + 1}: ✓ ${result.status} (${result.responseTime}ms)`);
      }
    }

    const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    console.log(`  Average: ${avgTime}ms (min: ${minTime}ms, max: ${maxTime}ms)`);

    if (lastResult) {
      results.push({
        ...lastResult,
        responseTime: avgTime,
      });
    }
  }

  return results;
}

function printSummary(label: string, results: TestResult[]) {
  console.log(`\n=== ${label} Summary ===\n`);

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`Total Endpoints: ${results.length}`);
  console.log(`Successful: ${successCount} ✓`);
  console.log(`Failed: ${failCount} ✗`);

  if (results.length > 0) {
    const avgResponseTime = Math.round(
      results.reduce((sum, r) => sum + r.responseTime, 0) / results.length
    );
    console.log(`Average Response Time: ${avgResponseTime}ms`);
  }

  console.log('\nDetailed Results:');
  console.log('─'.repeat(80));
  console.log('Endpoint'.padEnd(30) + 'Status'.padEnd(10) + 'Time'.padEnd(15) + 'Result');
  console.log('─'.repeat(80));

  results.forEach(r => {
    const endpoint = r.endpoint.replace('http://localhost:3007', '').padEnd(30);
    const status = String(r.status).padEnd(10);
    const time = `${r.responseTime}ms`.padEnd(15);
    const result = r.success ? '✓ Success' : `✗ ${r.error || 'Failed'}`;

    console.log(endpoint + status + time + result);
  });
  console.log('─'.repeat(80));
}

async function main() {
  console.log('=== API Performance Test ===');
  console.log('This script tests API endpoints and measures response times');

  const results = await runTests('Baseline Test (Redis Working)');
  printSummary('Baseline Test', results);

  console.log('\n✓ Test complete');
}

main().catch(console.error);
