/**
 * Redis Fault Tolerance Test Script
 *
 * Comprehensive testing of graceful degradation when Redis fails
 */

interface TestResult {
  endpoint: string;
  status: number;
  responseTime: number;
  success: boolean;
  error?: string;
}

interface ScenarioResults {
  scenario: string;
  timestamp: string;
  redisStatus: 'AVAILABLE' | 'UNAVAILABLE';
  tests: TestResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    avgResponseTime: number;
  };
}

const BASE_URL = 'http://localhost:3007';

const ENDPOINTS = [
  '/api/health',
  '/api/ipos?status=OPEN&limit=5',
  '/api/ipos?status=UPCOMING&limit=5',
  '/api/ipos?status=CLOSED&limit=5',
  '/api/ipos/history?limit=5',
];

async function testEndpoint(url: string, label: string): Promise<TestResult> {
  const fullUrl = `${BASE_URL}${url}`;
  const startTime = Date.now();

  try {
    const response = await fetch(fullUrl, {
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    const responseTime = Date.now() - startTime;

    return {
      endpoint: label,
      status: response.status,
      responseTime,
      success: response.ok,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      endpoint: label,
      status: 0,
      responseTime,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runTestSuite(label: string, redisStatus: 'AVAILABLE' | 'UNAVAILABLE'): Promise<ScenarioResults> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${label}`);
  console.log(`Redis Status: ${redisStatus}`);
  console.log(`${'='.repeat(80)}\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < ENDPOINTS.length; i++) {
    const endpoint = ENDPOINTS[i];
    const shortLabel = endpoint.replace(/\?.*$/, '').replace(/\//g, '/').substring(0, 40);

    console.log(`[${i + 1}/${ENDPOINTS.length}] Testing: ${shortLabel}`);

    const result = await testEndpoint(endpoint, endpoint);
    results.push(result);

    if (result.success) {
      console.log(`  ✓ Status: ${result.status} | Time: ${result.responseTime}ms`);
    } else {
      console.log(`  ✗ Status: ${result.status} | Time: ${result.responseTime}ms | Error: ${result.error || 'Failed'}`);
    }
  }

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgResponseTime = Math.round(
    results.reduce((sum, r) => sum + r.responseTime, 0) / results.length
  );

  const scenarioResults: ScenarioResults = {
    scenario: label,
    timestamp: new Date().toISOString(),
    redisStatus,
    tests: results,
    summary: {
      totalTests: results.length,
      passed,
      failed,
      avgResponseTime,
    },
  };

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`Summary: ${passed}/${results.length} tests passed | Avg time: ${avgResponseTime}ms`);
  console.log(`${'─'.repeat(80)}\n`);

  return scenarioResults;
}

function printComparison(baseline: ScenarioResults, degraded: ScenarioResults) {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PERFORMANCE COMPARISON');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Endpoint'.padEnd(45) + 'Redis Working'.padEnd(18) + 'Redis Down'.padEnd(18) + 'Delta');
  console.log('─'.repeat(80));

  baseline.tests.forEach((baseTest, index) => {
    const degradedTest = degraded.tests[index];
    const endpoint = baseTest.endpoint.substring(0, 44);
    const baseTime = `${baseTest.responseTime}ms`;
    const degradedTime = degradedTest.success ? `${degradedTest.responseTime}ms` : 'FAILED';
    const delta = degradedTest.success
      ? `+${degradedTest.responseTime - baseTest.responseTime}ms`
      : 'N/A';

    console.log(
      endpoint.padEnd(45) +
      baseTime.padEnd(18) +
      degradedTime.padEnd(18) +
      delta
    );
  });

  console.log('─'.repeat(80));
  console.log(
    'AVERAGE'.padEnd(45) +
    `${baseline.summary.avgResponseTime}ms`.padEnd(18) +
    `${degraded.summary.avgResponseTime}ms`.padEnd(18) +
    `+${degraded.summary.avgResponseTime - baseline.summary.avgResponseTime}ms`
  );
  console.log('─'.repeat(80));

  const degradationFactor = (degraded.summary.avgResponseTime / baseline.summary.avgResponseTime).toFixed(2);
  console.log(`\nPerformance Degradation: ${degradationFactor}x slower without Redis`);

  if (degraded.summary.failed > 0) {
    console.log(`⚠️  WARNING: ${degraded.summary.failed} endpoint(s) failed without Redis`);
  } else {
    console.log(`✓ All endpoints operational without Redis (graceful degradation working)`);
  }
}

async function saveResults(results: ScenarioResults[], outputPath: string) {
  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results saved to: ${outputPath}`);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    REDIS FAULT TOLERANCE TEST SUITE                          ║');
  console.log('║                                                                               ║');
  console.log('║  This script tests the application\'s ability to function without Redis       ║');
  console.log('║  Phase 5 Enhancement #24 - CRITICAL                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  const allResults: ScenarioResults[] = [];

  // SCENARIO 1: Baseline with Redis working
  console.log('\n📊 SCENARIO 1: Baseline Performance (Redis Working)\n');
  const baseline = await runTestSuite('Baseline with Redis', 'AVAILABLE');
  allResults.push(baseline);

  console.log('\n⚠️  MANUAL ACTION REQUIRED:');
  console.log('Please stop Redis service now:');
  console.log('  1. Open Task Manager');
  console.log('  2. Find Redis process (PID: look for redis-server.exe)');
  console.log('  3. End the process');
  console.log('\nOR run: taskkill /F /IM redis-server.exe\n');
  console.log('Press Enter when Redis is stopped...');

  // Wait for user confirmation
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  // SCENARIO 2: Redis unavailable
  console.log('\n📊 SCENARIO 2: Fault Tolerance Test (Redis Down)\n');
  const degraded = await runTestSuite('Application without Redis', 'UNAVAILABLE');
  allResults.push(degraded);

  // Print comparison
  printComparison(baseline, degraded);

  // Save results
  const outputPath = 'test-results/phase-5/redis-fault-tolerance-raw.json';
  await saveResults(allResults, outputPath);

  console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           TEST SUITE COMPLETE                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  process.exit(degraded.summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
