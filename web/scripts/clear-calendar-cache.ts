#!/usr/bin/env tsx

/**
 * Clear Calendar Cache Script
 */

import { getRedisClient } from '@/lib/cache/redis-client';

async function main() {
  console.log('🗑️  Clearing calendar cache...\n');

  try {
    const redis = getRedisClient();

    // Clear all calendar-related cache keys
    const patterns = [
      'mainboard:calendar:*',
      'ipo:*',
      'calendar:*',
    ];

    let totalDeleted = 0;

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);

      if (keys.length > 0) {
        console.log(`  📦 Found ${keys.length} keys matching "${pattern}"`);
        const deleted = await redis.del(...keys);
        totalDeleted += deleted;
        console.log(`  ✅ Deleted ${deleted} keys\n`);
      } else {
        console.log(`  ℹ️  No keys found matching "${pattern}"\n`);
      }
    }

    console.log('─────────────────────────────────────────');
    console.log(`✅ Cache cleared successfully!`);
    console.log(`   Total keys deleted: ${totalDeleted}`);
    console.log('─────────────────────────────────────────\n');

    console.log('💡 Next steps:');
    console.log('   1. Navigate to: http://localhost:3000/mainboard-ipo-calendar');
    console.log('   2. View November 2025');
    console.log('   3. Verify event count shows ~136 events (not 628)\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    process.exit(1);
  }
}

main();
