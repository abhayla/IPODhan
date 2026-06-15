/**
 * Calendar Materialized View Refresh Job
 *
 * Refreshes the calendar_view materialized view after scraper updates IPO data.
 * This keeps the calendar API endpoint fast (<400ms) by pre-computing JOINs.
 *
 * Schedule: Run hourly (cron: '0 * * * *')
 * Duration: <5 seconds
 *
 * Related:
 * - Migration: 0001_add_calendar_materialized_view.sql
 * - API: /api/calendar/materialized/[category]
 */

import { Pool } from 'pg';
import { invalidateCache } from '../../web/lib/cache/api-cache';
import { getCalendarInvalidationKeys } from '../../web/lib/cache/cache-keys';

/**
 * Refresh the calendar materialized view
 *
 * This function:
 * 1. Calls the PostgreSQL refresh function (CONCURRENTLY to allow queries during refresh)
 * 2. Invalidates all calendar cache keys in Redis
 * 3. Logs execution time and success/failure
 */
export async function refreshCalendarView(): Promise<void> {
  const startTime = Date.now();
  console.log('[Cron] Starting calendar materialized view refresh...');

  // Create database connection
  // Use the same DATABASE_URL as the main application
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c timezone=UTC', // Force session UTC so the NOW() scraper_logs write is UTC-naive (#28)
    max: 2, // Small pool for background jobs
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  try {
    // Execute the refresh function from the migration
    // CONCURRENTLY allows SELECT queries to continue during refresh
    await pool.query('SELECT refresh_calendar_view()');

    // Invalidate all calendar cache keys
    console.log('[Cron] Invalidating calendar cache...');
    await invalidateCache(undefined, getCalendarInvalidationKeys());

    const duration = Date.now() - startTime;
    console.log(`[Cron] ✓ Calendar view refreshed successfully in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[Cron] ✗ Calendar refresh failed after ${duration}ms:`,
      error instanceof Error ? error.message : error
    );

    // Don't throw - let the scheduler continue
    // Log to scraper_logs table for monitoring
    try {
      await pool.query(
        `INSERT INTO scraper_logs (source, status, message, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          'calendar_refresh',
          'FAILED',
          error instanceof Error ? error.message : String(error),
        ]
      );
    } catch (logError) {
      console.error('[Cron] Failed to log error:', logError);
    }
  } finally {
    // Clean up pool
    await pool.end();
  }
}

/**
 * Cron schedule for calendar refresh
 * Format: minute hour day month weekday
 *
 * '0 * * * *' = Every hour at minute 0
 */
export const calendarRefreshSchedule = '0 * * * *';

/**
 * Run immediately if called directly (for testing)
 */
if (require.main === module) {
  console.log('[Cron] Running calendar refresh manually...');
  refreshCalendarView()
    .then(() => {
      console.log('[Cron] Manual refresh complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Cron] Manual refresh failed:', error);
      process.exit(1);
    });
}
