import { db, getPoolStats } from '../lib/db';
import { sql } from 'drizzle-orm';

async function testConnectionPool() {
  console.log('[Pool Test] Testing database connection pool...\n');

  try {
    // Test basic connection
    console.log('[Pool Test] Step 1: Testing basic database query...');
    const result = await db.execute(sql`SELECT 1 as test`);
    console.log('✓ Basic query works:', result.rows[0]);
    console.log('');

    // Get initial pool stats
    console.log('[Pool Test] Step 2: Checking pool configuration...');
    const initialStats = getPoolStats();
    console.log('Pool Configuration:');
    console.log(`  - Max connections: ${initialStats.max}`);
    console.log(`  - Total connections: ${initialStats.total}`);
    console.log(`  - Idle connections: ${initialStats.idle}`);
    console.log(`  - Waiting requests: ${initialStats.waiting}`);
    console.log('');

    // Test concurrent connections (simulate load)
    console.log('[Pool Test] Step 3: Testing 30 concurrent queries...');
    console.log('(Each query sleeps for 100ms to simulate work)');

    const testStart = Date.now();
    const promises = Array(30)
      .fill(null)
      .map(async (_, i) => {
        const start = Date.now();
        await db.execute(sql`SELECT pg_sleep(0.1)`);
        const duration = Date.now() - start;
        return { query: i + 1, duration };
      });

    const results = await Promise.all(promises);
    const totalDuration = Date.now() - testStart;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    const maxDuration = Math.max(...results.map((r) => r.duration));
    const minDuration = Math.min(...results.map((r) => r.duration));

    console.log('✓ Concurrent test complete:');
    console.log(`  - Total time: ${totalDuration}ms`);
    console.log(`  - Average query time: ${avgDuration.toFixed(2)}ms`);
    console.log(`  - Min query time: ${minDuration}ms`);
    console.log(`  - Max query time: ${maxDuration}ms`);
    console.log(`  - All 30 queries completed successfully`);
    console.log('');

    // Get final pool stats
    console.log('[Pool Test] Step 4: Final pool statistics...');
    const finalStats = getPoolStats();
    console.log('Final Pool Stats:');
    console.log(`  - Total connections: ${finalStats.total}`);
    console.log(`  - Idle connections: ${finalStats.idle}`);
    console.log(`  - Waiting requests: ${finalStats.waiting}`);
    console.log('');

    // Performance analysis
    console.log('[Pool Test] Performance Analysis:');
    if (finalStats.waiting > 0) {
      console.log(`  ⚠️  WARNING: ${finalStats.waiting} requests waiting for connections`);
      console.log('     Pool may be saturated - consider increasing pool size');
    } else {
      console.log('  ✓ No requests waiting - pool handling load efficiently');
    }

    if (finalStats.total >= finalStats.max * 0.9) {
      console.log(
        `  ⚠️  WARNING: Using ${finalStats.total}/${finalStats.max} connections (>${((finalStats.total / finalStats.max) * 100).toFixed(0)}%)`
      );
      console.log('     Consider horizontal scaling if load increases');
    } else {
      console.log(
        `  ✓ Pool utilization healthy: ${finalStats.total}/${finalStats.max} connections (${((finalStats.total / finalStats.max) * 100).toFixed(0)}%)`
      );
    }
    console.log('');

    console.log('[Pool Test] ✅ All tests passed!');
    console.log('');
    console.log('Summary:');
    console.log(`  - Pool max size: ${initialStats.max} connections`);
    console.log(`  - Concurrent queries: 30 (all successful)`);
    console.log(`  - Average response time: ${avgDuration.toFixed(2)}ms`);
    console.log(`  - Pool saturation: ${finalStats.waiting > 0 ? 'YES ⚠️' : 'NO ✓'}`);
  } catch (error) {
    console.error('[Pool Test] ❌ Test failed:', error);
    throw error;
  }
}

testConnectionPool()
  .then(() => {
    console.log('\n[Pool Test] Exiting...');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[Pool Test] Fatal error:', error);
    process.exit(1);
  });
