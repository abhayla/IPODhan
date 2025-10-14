/**
 * Calculate and Update IPO Ratings
 *
 * Script to calculate ratings for all IPOs in the database
 * based on financial data, subscriptions, GMP, and other factors
 *
 * Usage: npm run calculate-ratings
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables first
config({ path: resolve(__dirname, '../.env.local') });

import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  IPORepository,
  SubscriptionRepository,
  GMPRepository,
  FinancialDataRepository,
} from '@/lib/repositories';
import { calculateIPORating } from '@/lib/utils/rating-calculator';
import { ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';

async function calculateAllRatings() {
  console.log('\n='.repeat(60));
  console.log('IPO Rating Calculation Started');
  console.log('='.repeat(60));

  try {
    // Initialize Redis (optional)
    let redis;
    try {
      redis = getRedisClient();
    } catch {
      console.log('⚠️  Redis unavailable - continuing without cache');
      redis = {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 1,
        flushdb: async () => 'OK',
      } as any;
    }

    // Initialize repositories
    const ipoRepo = new IPORepository(db, redis);
    const finRepo = new FinancialDataRepository(db, redis);
    const subRepo = new SubscriptionRepository(db, redis);
    const gmpRepo = new GMPRepository(db, redis);

    // Fetch all IPOs
    console.log('\n[1/3] Fetching all IPOs...');
    const result = await ipoRepo.findAll({ limit: 100 });
    const allIPOs = result.data;
    console.log(`✓ Found ${allIPOs.length} IPOs`);

    // Calculate ratings for each IPO
    console.log('\n[2/3] Calculating ratings...');
    let updatedCount = 0;
    let skippedCount = 0;

    for (const ipo of allIPOs) {
      try {
        // Fetch related data
        const [financialData, subscriptions, gmpRecords] = await Promise.all([
          finRepo.findByIPO(ipo.id),
          subRepo.findByIPO({ ipoId: ipo.id }),
          gmpRepo.findByIPO({ ipoId: ipo.id }),
        ]);

        // Calculate rating
        const ratingResult = calculateIPORating(
          ipo,
          financialData,
          subscriptions,
          gmpRecords
        );

        // Only update if we have sufficient data confidence
        if (ratingResult.confidence >= 40) {
          // Update the IPO with the calculated rating
          await ipoRepo.updateRating(
            ipo.id,
            ratingResult.rating,
            ratingResult.rationale
          );

          console.log(
            `✓ ${ipo.companyName}: ${ratingResult.rating}★ (${ratingResult.score}/100, ${ratingResult.confidence}% confidence)`
          );
          console.log(`  Rationale: ${ratingResult.rationale}`);
          updatedCount++;
        } else {
          console.log(
            `⚠️  ${ipo.companyName}: Skipped (insufficient data, ${ratingResult.confidence}% confidence)`
          );
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error calculating rating for ${ipo.companyName}:`, error);
      }
    }

    // Clear cache to ensure fresh data
    console.log('\n[3/3] Clearing cache...');
    try {
      await redis.flushdb();
      console.log('✓ Cache cleared');
    } catch {
      console.log('⚠️  Could not clear cache (Redis unavailable)');
    }

    // Summary
    console.log('\n='.repeat(60));
    console.log('Rating Calculation Complete');
    console.log(`✓ Updated: ${updatedCount} IPOs`);
    console.log(`⚠️  Skipped: ${skippedCount} IPOs (insufficient data)`);
    console.log('='.repeat(60));
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Rating calculation failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the script
calculateAllRatings();