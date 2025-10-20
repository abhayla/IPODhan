#!/usr/bin/env node

/**
 * Phase 1, Step 2: Scraper Health Monitoring
 * Checks scraper_logs and pipeline_status for execution history
 */

const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

async function checkScraperHealth() {
  console.log('🔍 Phase 1, Step 2: Scraper Health Monitoring\n');
  console.log(`📍 VPS Database: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await pool.connect();

    // 1. Check scraper_logs for recent executions
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1️⃣  SCRAPER LOGS - LAST 50 EXECUTIONS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const logsQuery = `
      SELECT
        source,
        status,
        records_processed,
        records_failed,
        duration_ms,
        error_message,
        created_at
      FROM scraper_logs
      ORDER BY created_at DESC
      LIMIT 50;
    `;

    const logsResult = await client.query(logsQuery);

    if (logsResult.rows.length === 0) {
      console.log('⚠️  NO SCRAPER LOGS FOUND');
      console.log('   → Scrapers may not have been executed yet\n');
    } else {
      console.log(`✅ Found ${logsResult.rows.length} log entries:\n`);

      logsResult.rows.forEach((log, index) => {
        const statusIcon = log.status === 'SUCCESS' ? '✅' : log.status === 'FAILED' ? '❌' : '⚠️';
        const timestamp = new Date(log.created_at).toLocaleString();

        console.log(`${(index + 1).toString().padStart(2)}. ${statusIcon} ${log.source}`);
        console.log(`    Status: ${log.status}`);
        console.log(`    Processed: ${log.records_processed || 0} | Failed: ${log.records_failed || 0}`);
        console.log(`    Duration: ${log.duration_ms || 0}ms`);
        console.log(`    Time: ${timestamp}`);
        if (log.error_message) {
          console.log(`    Error: ${log.error_message.substring(0, 100)}...`);
        }
        console.log('');
      });
    }

    // 2. Check pipeline_status for health
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('2️⃣  PIPELINE STATUS - HEALTH CHECK');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const pipelineQuery = `
      SELECT
        source,
        pipeline_type,
        status,
        last_run_at,
        last_success_at,
        consecutive_failures,
        records_processed,
        execution_time_ms,
        error_message
      FROM pipeline_status
      ORDER BY last_run_at DESC;
    `;

    const pipelineResult = await client.query(pipelineQuery);

    if (pipelineResult.rows.length === 0) {
      console.log('⚠️  NO PIPELINE STATUS RECORDS FOUND\n');
    } else {
      console.log(`✅ Found ${pipelineResult.rows.length} pipeline status records:\n`);

      pipelineResult.rows.forEach((pipeline, index) => {
        const statusIcon = pipeline.consecutive_failures === 0 ? '✅' : '❌';
        const lastRun = pipeline.last_run_at ? new Date(pipeline.last_run_at).toLocaleString() : 'Never';
        const lastSuccess = pipeline.last_success_at ? new Date(pipeline.last_success_at).toLocaleString() : 'Never';

        console.log(`${(index + 1).toString().padStart(2)}. ${statusIcon} ${pipeline.source} (${pipeline.pipeline_type})`);
        console.log(`    Status: ${pipeline.status}`);
        console.log(`    Last Run: ${lastRun}`);
        console.log(`    Last Success: ${lastSuccess}`);
        console.log(`    Failures: ${pipeline.consecutive_failures || 0}`);
        console.log(`    Records: ${pipeline.records_processed || 0}`);
        console.log(`    Execution Time: ${pipeline.execution_time_ms || 0}ms`);
        if (pipeline.error_message) {
          console.log(`    Last Error: ${pipeline.error_message.substring(0, 100)}...`);
        }
        console.log('');
      });
    }

    // 3. Check for stale data (>48 hours)
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('3️⃣  STALE DATA CHECK (>48 hours)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const staleQuery = `
      SELECT
        source,
        last_success_at,
        EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600 as hours_since_success
      FROM pipeline_status
      WHERE last_success_at < NOW() - INTERVAL '48 hours'
        OR last_success_at IS NULL
      ORDER BY last_success_at DESC NULLS LAST;
    `;

    const staleResult = await client.query(staleQuery);

    if (staleResult.rows.length === 0) {
      console.log('✅ All data is fresh (<48 hours old)\n');
    } else {
      console.log(`⚠️  ${staleResult.rows.length} sources have stale data:\n`);

      staleResult.rows.forEach((row, index) => {
        const hoursAgo = row.last_success_at
          ? Math.floor(row.hours_since_success)
          : 'Never';

        console.log(`${(index + 1).toString().padStart(2)}. ${row.source}`);
        console.log(`    Last Success: ${row.last_success_at ? new Date(row.last_success_at).toLocaleString() : 'Never'}`);
        console.log(`    Age: ${hoursAgo} ${typeof hoursAgo === 'number' ? 'hours' : ''}`);
        console.log('');
      });
    }

    // 4. Summary of Scraper Health
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SCRAPER HEALTH SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Count success/failure from logs
    const successCount = logsResult.rows.filter(r => r.status === 'SUCCESS').length;
    const failCount = logsResult.rows.filter(r => r.status === 'FAILED').length;

    // Count pipeline failures
    const pipelineFailures = pipelineResult.rows.filter(r => r.consecutive_failures > 0).length;

    console.log(`📝 Total Log Entries: ${logsResult.rows.length}`);
    console.log(`✅ Successful Runs: ${successCount} (${logsResult.rows.length > 0 ? Math.round(successCount / logsResult.rows.length * 100) : 0}%)`);
    console.log(`❌ Failed Runs: ${failCount} (${logsResult.rows.length > 0 ? Math.round(failCount / logsResult.rows.length * 100) : 0}%)`);
    console.log(`⚙️  Active Pipelines: ${pipelineResult.rows.length}`);
    console.log(`❌ Pipelines with Failures: ${pipelineFailures}`);
    console.log(`⚠️  Stale Data Sources: ${staleResult.rows.length}`);
    console.log('');

    // Health assessment
    if (successCount === 0 && logsResult.rows.length === 0) {
      console.log('🔴 CRITICAL: No scraper executions found - scrapers may not have been run yet');
    } else if (failCount > successCount * 0.5) {
      console.log('🟠 WARNING: High failure rate - investigate scraper issues');
    } else if (staleResult.rows.length > pipelineResult.rows.length * 0.3) {
      console.log('🟡 CAUTION: Multiple stale data sources - consider running scrapers');
    } else {
      console.log('✅ HEALTHY: Scrapers are executing successfully');
    }
    console.log('');

    console.log('✅ Step 2: Scraper Health Monitoring COMPLETE\n');

    client.release();

  } catch (error) {
    console.error('\n❌ ERROR during scraper health check:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkScraperHealth();
