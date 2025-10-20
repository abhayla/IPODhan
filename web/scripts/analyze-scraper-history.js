// Analyze scraper execution history to find what changed
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function analyzeScraperHistory() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('📊 SCRAPER EXECUTION ANALYSIS - Last 3 Days\n');
    console.log('═'.repeat(80));

    // Get detailed execution history
    const recentLogs = await pool.query(`
      SELECT
        source,
        status,
        records_processed,
        records_failed,
        duration_ms,
        error_message,
        created_at
      FROM scraper_logs
      WHERE created_at > NOW() - INTERVAL '3 days'
      ORDER BY created_at DESC
      LIMIT 50;
    `);

    console.log(`\n📝 Last ${recentLogs.rows.length} Scraper Executions:\n`);

    // Group by date
    const byDate = {};
    recentLogs.rows.forEach(log => {
      const date = log.created_at.toISOString().substring(0, 10);
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(log);
    });

    Object.keys(byDate).sort().reverse().forEach(date => {
      console.log(`\n📅 ${date}:`);
      console.log('-'.repeat(80));

      const logs = byDate[date];
      logs.forEach(log => {
        const time = log.created_at.toTimeString().substring(0, 8);
        const statusEmoji = log.status === 'SUCCESS' ? '✅' : '❌';
        const recordsEmoji = log.records_processed > 0 ? '📊' : '⚠️';

        console.log(`${time} | ${statusEmoji} ${log.source}`);
        console.log(`         ${recordsEmoji} Processed: ${log.records_processed || 0} | Failed: ${log.records_failed || 0} | Duration: ${log.duration_ms}ms`);

        if (log.error_message) {
          console.log(`         ❌ Error: ${log.error_message}`);
        }
        console.log('');
      });
    });

    // Analyze pattern: when did data processing stop?
    console.log('\n═'.repeat(80));
    console.log('\n🔍 PATTERN ANALYSIS:\n');

    const successfulRuns = recentLogs.rows.filter(log => log.records_processed > 0);
    const zeroRecordRuns = recentLogs.rows.filter(log => log.records_processed === 0 && log.status === 'SUCCESS');

    console.log(`✅ Runs with data processed: ${successfulRuns.length}`);
    if (successfulRuns.length > 0) {
      console.log(`   Last successful: ${successfulRuns[0].source} at ${successfulRuns[0].created_at.toISOString()}`);
      console.log(`   Records: ${successfulRuns[0].records_processed}`);
    }

    console.log(`\n⚠️  Runs with 0 records (but SUCCESS status): ${zeroRecordRuns.length}`);
    if (zeroRecordRuns.length > 0) {
      console.log(`   First occurrence: ${zeroRecordRuns[zeroRecordRuns.length - 1].source} at ${zeroRecordRuns[zeroRecordRuns.length - 1].created_at.toISOString()}`);
    }

    // Check for specific scrapers
    console.log('\n\n📊 BY SCRAPER SOURCE:\n');

    const byScraper = {};
    recentLogs.rows.forEach(log => {
      if (!byScraper[log.source]) {
        byScraper[log.source] = { total: 0, withData: 0, zeroData: 0, lastRun: log.created_at, lastRecords: log.records_processed };
      }
      byScraper[log.source].total++;
      if (log.records_processed > 0) byScraper[log.source].withData++;
      else byScraper[log.source].zeroData++;
    });

    Object.keys(byScraper).sort().forEach(source => {
      const data = byScraper[source];
      const successRate = ((data.withData / data.total) * 100).toFixed(1);
      const emoji = data.zeroData === data.total ? '🔴' : data.withData > 0 ? '✅' : '⚠️';

      console.log(`${emoji} ${source}:`);
      console.log(`   Total runs: ${data.total} | With data: ${data.withData} (${successRate}%) | Zero data: ${data.zeroData}`);
      console.log(`   Last run: ${data.lastRun.toISOString().substring(0, 19)} | Last records: ${data.lastRecords || 0}`);
      console.log('');
    });

    // Check for errors
    const withErrors = recentLogs.rows.filter(log => log.error_message);
    if (withErrors.length > 0) {
      console.log('\n\n❌ ERRORS FOUND:\n');
      withErrors.forEach(log => {
        console.log(`[${log.created_at.toISOString().substring(0, 19)}] ${log.source}`);
        console.log(`Error: ${log.error_message}`);
        console.log('');
      });
    } else {
      console.log('\n\n✅ No errors logged in last 3 days');
    }

    console.log('\n═'.repeat(80));
    console.log('\n🎯 KEY FINDINGS:\n');

    // Determine what happened
    if (successfulRuns.length > 0 && zeroRecordRuns.length > 0) {
      const lastSuccess = successfulRuns[0];
      const firstZero = zeroRecordRuns[zeroRecordRuns.length - 1];

      console.log(`1. Scrapers WERE working recently:`);
      console.log(`   - Last successful data processing: ${lastSuccess.created_at.toISOString()}`);
      console.log(`   - Source: ${lastSuccess.source}`);
      console.log(`   - Records processed: ${lastSuccess.records_processed}`);

      console.log(`\n2. Zero-record runs started:`);
      console.log(`   - First zero-record run: ${firstZero.created_at.toISOString()}`);
      console.log(`   - Source: ${firstZero.source}`);

      const hoursSince = Math.round((lastSuccess.created_at - firstZero.created_at) / (1000 * 60 * 60));
      console.log(`\n3. Time gap: ${Math.abs(hoursSince)} hours between events`);

      console.log(`\n4. Possible causes:`);
      console.log(`   ⚠️  Data source website structure changed`);
      console.log(`   ⚠️  Scraper selectors/logic broken`);
      console.log(`   ⚠️  Rate limiting or access blocked`);
      console.log(`   ⚠️  No new data available at source`);
      console.log(`   ⚠️  Scraper configuration changed`);
    } else if (zeroRecordRuns.length === recentLogs.rows.length) {
      console.log(`❌ ALL recent runs (last 3 days) show 0 records processed`);
      console.log(`   This suggests a systematic issue, not a data source problem`);
    }

    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error analyzing scraper history:', error.message);
  } finally {
    await pool.end();
  }
}

analyzeScraperHistory().catch(console.error);
