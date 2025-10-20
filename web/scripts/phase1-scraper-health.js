/**
 * Phase 1 - Test 3: Scraper Health Monitoring
 * Runs queries from APPENDIX-B Scraper Health section
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function runScraperHealthCheck() {
  console.log('🔍 Phase 1 - Test 3: Scraper Health Monitoring\n');
  console.log('⚠️  Running against VPS database: 103.118.16.189:5432/ipodhan\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Query 1: Check scraper_logs for recent runs
    console.log('📊 Query 1: Recent Scraper Runs (Last 50)');
    console.log('='.repeat(80));
    const scraperLogs = await pool.query(`
      SELECT source, status, records_processed, records_failed, duration_ms,
             error_message, created_at
      FROM scraper_logs
      ORDER BY created_at DESC
      LIMIT 50;
    `);

    if (scraperLogs.rows.length === 0) {
      console.log('⚠️  No scraper logs found\n');
    } else {
      console.log(`Found ${scraperLogs.rows.length} recent scraper runs:\n`);

      // Group by source
      const bySource = {};
      scraperLogs.rows.forEach(row => {
        if (!bySource[row.source]) {
          bySource[row.source] = [];
        }
        bySource[row.source].push(row);
      });

      Object.entries(bySource).forEach(([source, runs]) => {
        const latestRun = runs[0];
        const totalRuns = runs.length;
        const successCount = runs.filter(r => r.status === 'SUCCESS').length;
        const failureCount = runs.filter(r => r.status !== 'SUCCESS').length;

        console.log(`  ${source}:`);
        console.log(`    Latest: ${latestRun.status} at ${latestRun.created_at.toISOString()}`);
        console.log(`    Records: ${latestRun.records_processed} processed, ${latestRun.records_failed} failed`);
        console.log(`    Duration: ${latestRun.duration_ms}ms`);
        if (latestRun.error_message) {
          console.log(`    ⚠️  Error: ${latestRun.error_message}`);
        }
        console.log(`    Success Rate: ${successCount}/${totalRuns} (${((successCount/totalRuns)*100).toFixed(1)}%)`);
        console.log('');
      });
    }

    // Query 2: Check pipeline_status health
    console.log('\n📊 Query 2: Pipeline Status Health');
    console.log('='.repeat(80));
    const pipelineStatus = await pool.query(`
      SELECT source, pipeline_type, status, last_success_at, consecutive_failures,
             records_processed, execution_time_ms, last_run_at
      FROM pipeline_status
      ORDER BY last_run_at DESC;
    `);

    if (pipelineStatus.rows.length === 0) {
      console.log('⚠️  No pipeline status records found\n');
    } else {
      console.log(`Found ${pipelineStatus.rows.length} pipelines:\n`);

      pipelineStatus.rows.forEach(row => {
        const statusIcon = row.status === 'SUCCESS' ? '✅' : '❌';
        const failuresIcon = row.consecutive_failures > 0 ? '⚠️ ' : '';

        console.log(`  ${statusIcon} ${row.source} (${row.pipeline_type})`);
        console.log(`    Status: ${row.status}`);
        console.log(`    Last Success: ${row.last_success_at ? row.last_success_at.toISOString() : 'NEVER'}`);
        console.log(`    ${failuresIcon}Consecutive Failures: ${row.consecutive_failures}`);
        console.log(`    Records Processed: ${row.records_processed}`);
        console.log(`    Execution Time: ${row.execution_time_ms}ms`);
        console.log('');
      });
    }

    // Query 3: Flag stale data (>48 hours)
    console.log('\n📊 Query 3: Stale Data Detection (>48 hours)');
    console.log('='.repeat(80));
    const staleData = await pool.query(`
      SELECT source, last_success_at,
             EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600 as hours_since_success
      FROM pipeline_status
      WHERE last_success_at < NOW() - INTERVAL '48 hours';
    `);

    if (staleData.rows.length === 0) {
      console.log('✅ No stale data found (all pipelines succeeded within 48 hours)\n');
    } else {
      console.log(`⚠️  Found ${staleData.rows.length} stale pipelines:\n`);
      staleData.rows.forEach(row => {
        console.log(`  ⚠️  ${row.source}:`);
        console.log(`     Last Success: ${row.last_success_at.toISOString()}`);
        console.log(`     Hours Since: ${parseFloat(row.hours_since_success).toFixed(1)} hours`);
        console.log('');
      });
    }

    // Success Criteria Check
    console.log('\n📊 Success Criteria Validation');
    console.log('='.repeat(80));

    const allSuccess = pipelineStatus.rows.every(r => r.status === 'SUCCESS');
    const noFailures = pipelineStatus.rows.every(r => r.consecutive_failures === 0);
    const recentSuccess = pipelineStatus.rows.every(r => {
      if (!r.last_success_at) return false;
      const hoursSince = (Date.now() - new Date(r.last_success_at).getTime()) / (1000 * 60 * 60);
      return hoursSince < 24;
    });
    const recordsProcessed = pipelineStatus.rows.every(r => r.records_processed > 0);

    console.log(`  ${allSuccess ? '✅' : '❌'} All scrapers show SUCCESS`);
    console.log(`  ${noFailures ? '✅' : '❌'} consecutiveFailures = 0 for all`);
    console.log(`  ${recentSuccess ? '✅' : '❌'} lastSuccessAt within 24 hours for all`);
    console.log(`  ${recordsProcessed ? '✅' : '❌'} recordsProcessed > 0 for all`);

    const allCriteriaMet = allSuccess && noFailures && recentSuccess && recordsProcessed;
    console.log(`\n  ${allCriteriaMet ? '✅ ALL SUCCESS CRITERIA MET' : '❌ SOME CRITERIA FAILED'}`);

    console.log('\n✅ Scraper health check complete\n');

  } catch (error) {
    console.error('❌ Error during scraper health check:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runScraperHealthCheck().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
