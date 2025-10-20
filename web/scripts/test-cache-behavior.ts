/**
 * Cache Behavior Test Script
 *
 * Tests cache HIT/MISS scenarios for Phase 1 Iteration 3
 *
 * Usage: npx tsx scripts/test-cache-behavior.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { getRedisClient } from '../lib/cache/redis-client';
import { Pool } from 'pg';

async function testCacheBehavior() {
  console.log('\n🧪 Phase 1 Iteration 3: Cache HIT/MISS Validation\n');
  console.log('='.repeat(60));

  const redis = getRedisClient();

  try {
    // Test 1: Redis Connection
    console.log('\n📌 Test 1: Redis Connection');
    const pingResult = await redis.ping();
    console.log(`✓ Redis connection successful: ${pingResult}`);

    // Test 2: Clear Cache
    console.log('\n📌 Test 2: Clear Cache');
    await redis.flushdb();
    console.log('✓ All caches cleared');

    // Test 3: Check for IPO slugs
    console.log('\n📌 Test 3: Finding test IPO slug');

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL ||
        `postgresql://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`,
    });

    const result = await pool.query(`
      SELECT slug, company_name, status
      FROM ipos
      WHERE status IN ('OPEN', 'CLOSED', 'LISTED')
      LIMIT 5
    `);

    if (result.rows.length === 0) {
      console.log('⚠️  No IPOs found in database for testing');
      process.exit(1);
    }

    const testSlug = result.rows[0].slug;
    const testCompanyName = result.rows[0].company_name;
    console.log(`✓ Using test IPO: ${testCompanyName} (${testSlug})`);

    // Test 4: Cache MISS - First Request
    console.log('\n📌 Test 4: Cache MISS Scenario (First Request)');
    const cacheKey = `ipo:slug:${testSlug}`;

    const cacheExists1 = await redis.exists(cacheKey);
    console.log(`   Cache key exists before request: ${cacheExists1 === 1 ? 'YES' : 'NO'}`);

    const startTime1 = Date.now();
    const response1 = await fetch(`http://localhost:3000/api/ipos/${testSlug}`);
    const duration1 = Date.now() - startTime1;
    const data1 = await response1.json();

    console.log(`   Response time: ${duration1}ms`);
    console.log(`   Status: ${response1.status}`);
    console.log(`   Success: ${data1.success ? 'YES' : 'NO'}`);

    // Check cache after request
    const cacheExists2 = await redis.exists(cacheKey);
    console.log(`   Cache key exists after request: ${cacheExists2 === 1 ? 'YES ✓' : 'NO ✗'}`);

    if (cacheExists2 === 1) {
      const ttl = await redis.ttl(cacheKey);
      console.log(`   Cache TTL: ${ttl} seconds (Expected: ~900s for IPO detail)`);
    }

    // Test 5: Cache HIT - Second Request
    console.log('\n📌 Test 5: Cache HIT Scenario (Second Request)');

    const startTime2 = Date.now();
    const response2 = await fetch(`http://localhost:3000/api/ipos/${testSlug}`);
    const duration2 = Date.now() - startTime2;
    const data2 = await response2.json();

    console.log(`   Response time: ${duration2}ms (Expected: < 50ms for cache HIT)`);
    console.log(`   Status: ${response2.status}`);
    console.log(`   Success: ${data2.success ? 'YES' : 'NO'}`);

    // Compare response times
    const improvement = duration1 - duration2;
    const improvementPercent = ((improvement / duration1) * 100).toFixed(1);
    console.log(`   Performance improvement: ${improvement}ms (${improvementPercent}%)`);

    // Test 6: Verify Data Consistency
    console.log('\n📌 Test 6: Data Consistency Check');
    const ipoId1 = data1.data?.ipo?.id;
    const ipoId2 = data2.data?.ipo?.id;
    console.log(`   First request IPO ID: ${ipoId1}`);
    console.log(`   Second request IPO ID: ${ipoId2}`);
    console.log(`   Data consistent: ${ipoId1 === ipoId2 ? 'YES ✓' : 'NO ✗'}`);

    // Test 7: Cache Key Inspection
    console.log('\n📌 Test 7: Cache Key Inspection');
    const allKeys = await redis.keys('*');
    console.log(`   Total cache keys: ${allKeys.length}`);
    console.log(`   Cache keys:`);
    allKeys.slice(0, 10).forEach(key => console.log(`     - ${key}`));
    if (allKeys.length > 10) {
      console.log(`     ... and ${allKeys.length - 10} more`);
    }

    // Test 8: Test Cache Deletion
    console.log('\n📌 Test 8: Cache Deletion & Re-population');
    await redis.del(cacheKey);
    const cacheExistsAfterDel = await redis.exists(cacheKey);
    console.log(`   Cache key exists after deletion: ${cacheExistsAfterDel === 1 ? 'YES ✗' : 'NO ✓'}`);

    const startTime3 = Date.now();
    const response3 = await fetch(`http://localhost:3000/api/ipos/${testSlug}`);
    const duration3 = Date.now() - startTime3;
    console.log(`   Response time after deletion: ${duration3}ms (Should be similar to first request)`);

    const cacheExistsAfterReq = await redis.exists(cacheKey);
    console.log(`   Cache key re-created: ${cacheExistsAfterReq === 1 ? 'YES ✓' : 'NO ✗'}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary:\n');
    console.log(`   ✓ Redis connection working`);
    console.log(`   ${cacheExists2 === 1 ? '✓' : '✗'} Cache MISS creates cache key`);
    console.log(`   ${duration2 < duration1 ? '✓' : '✗'} Cache HIT faster than MISS (${duration2}ms vs ${duration1}ms)`);
    console.log(`   ${ipoId1 === ipoId2 ? '✓' : '✗'} Data consistency between requests`);
    console.log(`   ${cacheExistsAfterReq === 1 ? '✓' : '✗'} Cache re-population after deletion`);
    console.log(`   ${duration2 < 50 ? '✓' : '⚠️'} Cache HIT < 50ms (Actual: ${duration2}ms)`);

    // Success criteria check
    const allPassed =
      cacheExists2 === 1 &&
      duration2 < duration1 &&
      ipoId1 === ipoId2 &&
      cacheExistsAfterReq === 1;

    if (allPassed) {
      console.log('\n✅ All cache validation tests PASSED!');
    } else {
      console.log('\n⚠️  Some cache validation tests FAILED');
    }

    await pool.end();
    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testCacheBehavior();
