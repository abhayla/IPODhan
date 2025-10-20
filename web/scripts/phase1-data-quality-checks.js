// Phase 1: Comprehensive Data Quality Checks
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function runPhase1Checks() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔍 PHASE 1: DATA QUALITY CHECKS\n');
    console.log(`Connected to: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);
    console.log('═'.repeat(80));

    // ==================== SCRAPER HEALTH MONITORING ====================
    console.log('\n📊 TASK 2: SCRAPER HEALTH MONITORING\n');

    console.log('Recent Scraper Execution History (Last 20):');
    console.log('-'.repeat(80));
    const scraperLogs = await pool.query(`
      SELECT source, status, records_processed, records_failed,
             duration_ms, error_message, created_at
      FROM scraper_logs
      ORDER BY created_at DESC
      LIMIT 20;
    `);

    if (scraperLogs.rows.length === 0) {
      console.log('❌ NO SCRAPER LOGS FOUND');
    } else {
      scraperLogs.rows.forEach((log, index) => {
        const statusEmoji = log.status === 'SUCCESS' ? '✅' : log.status === 'ERROR' ? '❌' : '⚠️';
        console.log(`${index + 1}. ${statusEmoji} ${log.source} - ${log.status}`);
        console.log(`   Processed: ${log.records_processed || 0} | Failed: ${log.records_failed || 0} | Duration: ${log.duration_ms}ms`);
        console.log(`   Time: ${log.created_at}`);
        if (log.error_message) console.log(`   Error: ${log.error_message}`);
        console.log('');
      });
    }

    console.log('\nPipeline Status:');
    console.log('-'.repeat(80));
    const pipelineStatus = await pool.query(`
      SELECT source, pipeline_type, status, last_success_at,
             consecutive_failures, records_processed, execution_time_ms,
             last_run_at
      FROM pipeline_status
      ORDER BY last_run_at DESC NULLS LAST;
    `);

    if (pipelineStatus.rows.length === 0) {
      console.log('❌ NO PIPELINE STATUS RECORDS');
    } else {
      pipelineStatus.rows.forEach((ps, index) => {
        const statusEmoji = ps.status === 'SUCCESS' ? '✅' : ps.status === 'ERROR' ? '❌' : '⚠️';
        const failEmoji = ps.consecutive_failures === 0 ? '✅' : '⚠️';
        console.log(`${index + 1}. ${statusEmoji} ${ps.source} (${ps.pipeline_type})`);
        console.log(`   Status: ${ps.status} | ${failEmoji} Consecutive Failures: ${ps.consecutive_failures}`);
        console.log(`   Last Success: ${ps.last_success_at || 'NEVER'}`);
        console.log(`   Last Run: ${ps.last_run_at || 'NEVER'}`);
        console.log(`   Processed: ${ps.records_processed || 0} | Execution Time: ${ps.execution_time_ms || 0}ms`);
        console.log('');
      });
    }

    console.log('\nStale Scrapers (>48 hours since success):');
    console.log('-'.repeat(80));
    const staleScraper = await pool.query(`
      SELECT source, last_success_at,
             EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600 as hours_since_success
      FROM pipeline_status
      WHERE last_success_at < NOW() - INTERVAL '48 hours'
         OR last_success_at IS NULL;
    `);

    if (staleScraper.rows.length === 0) {
      console.log('✅ No stale scrapers - all updated within 48 hours');
    } else {
      staleScraper.rows.forEach((stale) => {
        console.log(`⚠️  ${stale.source}: ${stale.hours_since_success ? Math.round(stale.hours_since_success) + ' hours' : 'NEVER RUN'}`);
      });
    }

    // ==================== DATA INTEGRITY CHECKS ====================
    console.log('\n\n═'.repeat(80));
    console.log('\n📊 TASK 4: DATA INTEGRITY CHECKS\n');

    console.log('Foreign Key Integrity:');
    console.log('-'.repeat(80));

    const orphanedDetails = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipo_details WHERE ipo_id NOT IN (SELECT id FROM ipos);
    `);
    console.log(`Orphaned ipo_details: ${orphanedDetails.rows[0].count} ${orphanedDetails.rows[0].count === '0' ? '✅' : '❌'}`);

    const orphanedReviews = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipo_reviews WHERE ipo_id IS NOT NULL AND ipo_id NOT IN (SELECT id FROM ipos);
    `);
    console.log(`Orphaned ipo_reviews: ${orphanedReviews.rows[0].count} ${orphanedReviews.rows[0].count === '0' ? '✅' : '❌'}`);

    const orphanedFinancials = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipo_financials WHERE ipo_id NOT IN (SELECT id FROM ipos);
    `);
    console.log(`Orphaned ipo_financials: ${orphanedFinancials.rows[0].count} ${orphanedFinancials.rows[0].count === '0' ? '✅' : '❌'}`);

    console.log('\nDuplicate Detection:');
    console.log('-'.repeat(80));
    const duplicateSlugs = await pool.query(`
      SELECT slug, COUNT(*) as count
      FROM ipos
      GROUP BY slug
      HAVING COUNT(*) > 1;
    `);

    if (duplicateSlugs.rows.length === 0) {
      console.log('✅ No duplicate slugs found');
    } else {
      console.log(`❌ Found ${duplicateSlugs.rows.length} duplicate slugs:`);
      duplicateSlugs.rows.forEach(dup => {
        console.log(`   - ${dup.slug}: ${dup.count} occurrences`);
      });
    }

    console.log('\nDate Logic Validation:');
    console.log('-'.repeat(80));

    const invalidDateRanges = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE close_date < open_date;
    `);
    console.log(`Invalid date ranges (close < open): ${invalidDateRanges.rows[0].count} ${invalidDateRanges.rows[0].count === '0' ? '✅' : '❌'}`);

    const listedWithoutDate = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE status = 'LISTED' AND listing_date IS NULL;
    `);
    console.log(`LISTED IPOs without listing_date: ${listedWithoutDate.rows[0].count} ${listedWithoutDate.rows[0].count === '0' ? '✅' : '⚠️'}`);

    console.log('\nPrice Logic Validation:');
    console.log('-'.repeat(80));

    const invalidPriceBands = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE price_band_high < price_band_low;
    `);
    console.log(`Invalid price bands (high < low): ${invalidPriceBands.rows[0].count} ${invalidPriceBands.rows[0].count === '0' ? '✅' : '❌'}`);

    console.log('\nData Quality Checks:');
    console.log('-'.repeat(80));

    const invalidLotSize = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE lot_size IS NOT NULL AND lot_size <= 0;
    `);
    console.log(`Invalid lot sizes (≤0): ${invalidLotSize.rows[0].count} ${invalidLotSize.rows[0].count === '0' ? '✅' : '❌'}`);

    const invalidIssueSize = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE issue_size IS NOT NULL AND issue_size <= 0;
    `);
    console.log(`Invalid issue sizes (≤0): ${invalidIssueSize.rows[0].count} ${invalidIssueSize.rows[0].count === '0' ? '✅' : '❌'}`);

    // ==================== GMP DATA ANALYSIS ====================
    console.log('\n\n═'.repeat(80));
    console.log('\n📊 TASK 6: GMP & SUBSCRIPTION DATA ANALYSIS\n');

    console.log('OPEN IPOs GMP Status:');
    console.log('-'.repeat(80));

    const openIPOs = await pool.query(`
      SELECT company_name, status, gmp, gmp_percentage, gmp_updated_at
      FROM ipos
      WHERE status = 'OPEN'
      ORDER BY gmp_updated_at DESC NULLS LAST
      LIMIT 20;
    `);

    if (openIPOs.rows.length === 0) {
      console.log('⚠️  NO OPEN IPOs FOUND');
    } else {
      console.log(`Found ${openIPOs.rows.length} OPEN IPOs:\n`);
      openIPOs.rows.forEach((ipo, index) => {
        const gmpEmoji = ipo.gmp !== null ? '✅' : '❌';
        console.log(`${index + 1}. ${gmpEmoji} ${ipo.company_name}`);
        console.log(`   GMP: ${ipo.gmp !== null ? `₹${ipo.gmp} (${ipo.gmp_percentage}%)` : 'MISSING'}`);
        console.log(`   Updated: ${ipo.gmp_updated_at || 'NEVER'}`);
        console.log('');
      });
    }

    const missingGMP = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE status = 'OPEN' AND gmp IS NULL;
    `);
    console.log(`\nOPEN IPOs missing GMP: ${missingGMP.rows[0].count} of ${openIPOs.rows.length} ${missingGMP.rows[0].count === '0' ? '✅' : '⚠️'}`);

    console.log('\n\nSubscription Data for OPEN IPOs:');
    console.log('-'.repeat(80));

    const subscriptionData = await pool.query(`
      SELECT i.company_name, i.status,
             s.qib_subscription, s.nii_subscription,
             s.retail_subscription, s.total_subscription,
             s.timestamp
      FROM ipos i
      LEFT JOIN subscriptions s ON i.id = s.ipo_id
      WHERE i.status = 'OPEN'
      ORDER BY s.timestamp DESC NULLS LAST
      LIMIT 20;
    `);

    if (subscriptionData.rows.length === 0) {
      console.log('⚠️  NO SUBSCRIPTION DATA FOUND FOR OPEN IPOs');
    } else {
      let hasSubscriptionCount = 0;
      subscriptionData.rows.forEach((ipo, index) => {
        const hasData = ipo.total_subscription !== null;
        if (hasData) hasSubscriptionCount++;
        const dataEmoji = hasData ? '✅' : '❌';
        console.log(`${index + 1}. ${dataEmoji} ${ipo.company_name}`);
        if (hasData) {
          console.log(`   Total: ${ipo.total_subscription}x | QIB: ${ipo.qib_subscription}x | NII: ${ipo.nii_subscription}x | Retail: ${ipo.retail_subscription}x`);
          console.log(`   Updated: ${ipo.timestamp}`);
        } else {
          console.log(`   No subscription data available`);
        }
        console.log('');
      });
      console.log(`OPEN IPOs with subscription data: ${hasSubscriptionCount} of ${subscriptionData.rows.length}`);
    }

    // ==================== HISTORICAL DATA COMPLETENESS ====================
    console.log('\n\n═'.repeat(80));
    console.log('\n📊 TASK 7: HISTORICAL DATA COMPLETENESS\n');

    console.log('LISTED IPOs Performance Data Coverage:');
    console.log('-'.repeat(80));

    const listedPerformance = await pool.query(`
      SELECT i.company_name, i.listing_date, i.status,
             CASE WHEN lp.id IS NOT NULL THEN true ELSE false END as has_performance
      FROM ipos i
      LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
      WHERE i.status = 'LISTED'
      ORDER BY i.listing_date DESC
      LIMIT 20;
    `);

    if (listedPerformance.rows.length === 0) {
      console.log('⚠️  NO LISTED IPOs FOUND');
    } else {
      let withPerformance = 0;
      listedPerformance.rows.forEach((ipo, index) => {
        if (ipo.has_performance) withPerformance++;
        const perfEmoji = ipo.has_performance ? '✅' : '❌';
        console.log(`${index + 1}. ${perfEmoji} ${ipo.company_name}`);
        console.log(`   Listed: ${ipo.listing_date || 'Date missing'}`);
        console.log(`   Performance Data: ${ipo.has_performance ? 'Available' : 'MISSING'}`);
        console.log('');
      });
      console.log(`Coverage: ${withPerformance} of ${listedPerformance.rows.length} LISTED IPOs have performance data\n`);
    }

    const missingPerformance = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos i
      LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
      WHERE i.status = 'LISTED' AND lp.id IS NULL;
    `);

    const totalListed = await pool.query(`
      SELECT COUNT(*) as count FROM ipos WHERE status = 'LISTED';
    `);

    const coveragePercent = totalListed.rows[0].count > 0
      ? ((totalListed.rows[0].count - missingPerformance.rows[0].count) / totalListed.rows[0].count * 100).toFixed(2)
      : 0;

    console.log(`Total LISTED IPOs: ${totalListed.rows[0].count}`);
    console.log(`Missing performance data: ${missingPerformance.rows[0].count}`);
    console.log(`Coverage: ${coveragePercent}% ${coveragePercent >= 95 ? '✅' : coveragePercent >= 80 ? '⚠️' : '❌'}`);

    // ==================== SUMMARY ====================
    console.log('\n\n═'.repeat(80));
    console.log('\n📋 PHASE 1 DATA QUALITY CHECK SUMMARY\n');
    console.log('═'.repeat(80));

    const totalIPOs = await pool.query(`SELECT COUNT(*) as count FROM ipos;`);
    const byStatus = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM ipos
      GROUP BY status
      ORDER BY count DESC;
    `);
    const bySegment = await pool.query(`
      SELECT segment, COUNT(*) as count
      FROM ipos
      GROUP BY segment
      ORDER BY count DESC;
    `);

    const byOfferingType = await pool.query(`
      SELECT offering_type, COUNT(*) as count
      FROM ipos
      GROUP BY offering_type
      ORDER BY count DESC;
    `);

    console.log(`\nTotal IPOs: ${totalIPOs.rows[0].count}`);
    console.log('\nBy Status:');
    byStatus.rows.forEach(s => {
      console.log(`  ${s.status}: ${s.count}`);
    });
    console.log('\nBy Segment:');
    bySegment.rows.forEach(c => {
      console.log(`  ${c.segment || 'NULL'}: ${c.count}`);
    });
    console.log('\nBy Offering Type:');
    byOfferingType.rows.forEach(c => {
      console.log(`  ${c.offering_type || 'NULL'}: ${c.count}`);
    });

    console.log('\n═'.repeat(80));
    console.log('\n✅ Phase 1 Data Quality Checks Complete\n');
    console.log('Next Steps:');
    console.log('1. Review findings above');
    console.log('2. Address any ❌ or ⚠️ issues found');
    console.log('3. Run field coverage analysis');
    console.log('4. Update PHASE_1_PROGRESS.md');
    console.log('5. Proceed to Phase 1 Iteration 2');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error running Phase 1 checks:', error.message);
    console.error('\nStack trace:', error.stack);
  } finally {
    await pool.end();
  }
}

runPhase1Checks().catch(console.error);
