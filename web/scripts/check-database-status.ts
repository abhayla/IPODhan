/**
 * Database Status Checker for Testing
 * Phase 1, Iteration 1
 */

import { db } from '../lib/db';
import {
  ipos,
  scraperLogs,
  pipelineStatus,
  ipoDetails,
  ipoFinancials,
  subscriptions,
  gmpRecords,
  gmpTracking,
  listingPerformance,
  ipoReviews,
  documents,
  marketHolidays,
  registrars
} from '../drizzle/migrations/schema';
import { count, desc, sql } from 'drizzle-orm';

async function checkDatabaseStatus() {
  console.log('========================================');
  console.log('IPODhan Database Status Check');
  console.log('========================================\n');

  try {
    // Count all tables
    console.log('📊 TABLE COUNTS:');
    console.log('----------------------------------------');

    const [ipoCount] = await db.select({ count: count() }).from(ipos);
    console.log(`✓ ipos: ${ipoCount.count}`);

    const [detailsCount] = await db.select({ count: count() }).from(ipoDetails);
    console.log(`✓ ipo_details: ${detailsCount.count}`);

    const [financialsCount] = await db.select({ count: count() }).from(ipoFinancials);
    console.log(`✓ ipo_financials: ${financialsCount.count}`);

    const [subscriptionsCount] = await db.select({ count: count() }).from(subscriptions);
    console.log(`✓ subscriptions: ${subscriptionsCount.count}`);

    const [gmpRecordsCount] = await db.select({ count: count() }).from(gmpRecords);
    console.log(`✓ gmp_records: ${gmpRecordsCount.count}`);

    const [gmpTrackingCount] = await db.select({ count: count() }).from(gmpTracking);
    console.log(`✓ gmp_tracking: ${gmpTrackingCount.count}`);

    const [listingCount] = await db.select({ count: count() }).from(listingPerformance);
    console.log(`✓ listing_performance: ${listingCount.count}`);

    const [reviewsCount] = await db.select({ count: count() }).from(ipoReviews);
    console.log(`✓ ipo_reviews: ${reviewsCount.count}`);

    const [docsCount] = await db.select({ count: count() }).from(documents);
    console.log(`✓ documents: ${docsCount.count}`);

    const [holidaysCount] = await db.select({ count: count() }).from(marketHolidays);
    console.log(`✓ market_holidays: ${holidaysCount.count}`);

    const [registrarsCount] = await db.select({ count: count() }).from(registrars);
    console.log(`✓ registrars: ${registrarsCount.count}`);

    const [logsCount] = await db.select({ count: count() }).from(scraperLogs);
    console.log(`✓ scraper_logs: ${logsCount.count}`);

    const [pipelineCount] = await db.select({ count: count() }).from(pipelineStatus);
    console.log(`✓ pipeline_status: ${pipelineCount.count}`);

    // Check IPO status distribution
    console.log('\n📈 IPO STATUS DISTRIBUTION:');
    console.log('----------------------------------------');
    const statusDist = await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM ipos
      GROUP BY status
      ORDER BY count DESC
    `);
    statusDist.rows.forEach((row: any) => {
      console.log(`  ${row.status}: ${row.count}`);
    });

    // Check IPO category distribution
    console.log('\n📊 IPO CATEGORY DISTRIBUTION:');
    console.log('----------------------------------------');
    const categoryDist = await db.execute(sql`
      SELECT category, COUNT(*) as count
      FROM ipos
      GROUP BY category
      ORDER BY count DESC
    `);
    categoryDist.rows.forEach((row: any) => {
      console.log(`  ${row.category}: ${row.count}`);
    });

    // Check recent scraper logs
    console.log('\n🔍 RECENT SCRAPER LOGS (Last 10):');
    console.log('----------------------------------------');
    const recentLogs = await db
      .select()
      .from(scraperLogs)
      .orderBy(desc(scraperLogs.createdAt))
      .limit(10);

    if (recentLogs.length === 0) {
      console.log('  ⚠️  NO SCRAPER LOGS FOUND');
    } else {
      recentLogs.forEach((log) => {
        const timestamp = new Date(log.createdAt).toLocaleString();
        console.log(`  [${timestamp}] ${log.source}: ${log.status}`);
        console.log(`    → Processed: ${log.recordsProcessed}, Failed: ${log.recordsFailed}, Duration: ${log.durationMs}ms`);
        if (log.errorMessage) {
          console.log(`    → Error: ${log.errorMessage.substring(0, 100)}`);
        }
      });
    }

    // Check pipeline status
    console.log('\n⚙️  PIPELINE STATUS:');
    console.log('----------------------------------------');
    const pipelines = await db
      .select()
      .from(pipelineStatus)
      .orderBy(desc(pipelineStatus.lastRunAt));

    if (pipelines.length === 0) {
      console.log('  ⚠️  NO PIPELINE STATUS RECORDS FOUND');
    } else {
      pipelines.forEach((pipeline) => {
        console.log(`  ${pipeline.source} (${pipeline.pipelineType}): ${pipeline.status}`);
        console.log(`    → Last Success: ${pipeline.lastSuccessAt ? new Date(pipeline.lastSuccessAt).toLocaleString() : 'Never'}`);
        console.log(`    → Consecutive Failures: ${pipeline.consecutiveFailures}`);
        console.log(`    → Records: Processed=${pipeline.recordsProcessed}, Inserted=${pipeline.recordsInserted}, Updated=${pipeline.recordsUpdated}`);
      });
    }

    console.log('\n========================================');
    console.log('✅ Database check completed successfully');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database check failed:', error);
    process.exit(1);
  }
}

checkDatabaseStatus();
