import type Redis from 'ioredis';
import logger from '../../utils/logger.js';

/**
 * Scraper run statistics for daily summary
 */
interface ScraperStats {
  success: number;
  failure: number;
  rate: number;  // Success rate percentage
}

/**
 * Daily summary report structure
 */
export interface DailySummaryReport {
  date: string;                      // Report date (YYYY-MM-DD)
  timeRange: { start: Date; end: Date };
  iposScraped: number;
  iposBySource: { nse: number; bse: number; api: number };
  scraperRuns: {
    nse: ScraperStats;
    bse: ScraperStats;
    apiFallback: ScraperStats;
  };
  subscriptionUpdates: number;
  avgScrapeDuration: number;         // milliseconds
  errors: { message: string; count: number }[];
}

/**
 * Daily summary result (includes report and metadata)
 */
export interface DailySummaryResult {
  success: boolean;
  jobName: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  report: DailySummaryReport;
}

/**
 * Run daily summary job
 * Generates comprehensive report of scraper activity in last 24 hours
 *
 * @param redis - Redis client for stats tracking
 * @returns Daily summary result with report
 */
export async function runDailySummary(redis: Redis): Promise<DailySummaryResult> {
  const startTime = new Date();

  try {
    logger.info('Starting daily summary generation');

    // Define summary time range: Last 24 hours (8 AM yesterday to 8 AM today)
    const endTime = new Date();
    const startTimeRange = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

    // Generate summary report
    // TODO: Query database for actual scraper activity once logging is implemented (Story 7.5)
    // For now, use placeholder data
    const report: DailySummaryReport = {
      date: endTime.toISOString().split('T')[0],
      timeRange: { start: startTimeRange, end: endTime },
      iposScraped: 0,  // TODO: Query database for IPOs updated in last 24 hours
      iposBySource: {
        nse: 0,  // TODO: Count IPOs with NSE in listing_exchanges
        bse: 0,  // TODO: Count IPOs with BSE in listing_exchanges
        api: 0   // TODO: Count IPOs from API fallback
      },
      scraperRuns: {
        nse: await getScraperStats(redis, 'NSE'),
        bse: await getScraperStats(redis, 'BSE'),
        apiFallback: await getScraperStats(redis, 'API_FALLBACK')
      },
      subscriptionUpdates: 0,  // TODO: Query subscriptions table for updates in last 24 hours
      avgScrapeDuration: 0,    // TODO: Calculate from scraper logs
      errors: []               // TODO: Aggregate errors from scraper logs
    };

    // Log summary report
    logSummaryReport(report);

    const endTimeResult = new Date();
    const duration = endTimeResult.getTime() - startTime.getTime();

    logger.info({
      duration,
      date: report.date,
      iposScraped: report.iposScraped,
      nseSuccessRate: report.scraperRuns.nse.rate,
      bseSuccessRate: report.scraperRuns.bse.rate
    }, 'Daily summary completed');

    return {
      success: true,
      jobName: 'daily-summary',
      startTime,
      endTime: endTimeResult,
      duration,
      report
    };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      duration: new Date().getTime() - startTime.getTime()
    }, 'Daily summary failed');

    // Return empty report on error (don't crash scheduler)
    return {
      success: false,
      jobName: 'daily-summary',
      startTime,
      endTime: new Date(),
      duration: new Date().getTime() - startTime.getTime(),
      report: createEmptyReport()
    };
  }
}

/**
 * Get scraper statistics from Redis
 * @param redis - Redis client
 * @param source - Scraper source (NSE, BSE, API_FALLBACK)
 * @returns Scraper run statistics
 */
async function getScraperStats(
  redis: Redis,
  source: 'NSE' | 'BSE' | 'API_FALLBACK'
): Promise<ScraperStats> {
  try {
    // TODO: Once scraper logging is implemented (Story 7.5), query from database
    // For now, use Redis failure tracking as a proxy
    const failureKey = `scraper:${source}:failures`;
    const failures = await redis.get(failureKey);
    const failure = failures ? parseInt(failures, 10) : 0;

    // Placeholder: assume 24 runs per day in production (every hour)
    const totalRuns = 24;
    const success = Math.max(0, totalRuns - failure);
    const rate = totalRuns > 0 ? (success / totalRuns) * 100 : 100;

    return {
      success,
      failure,
      rate: Math.round(rate * 10) / 10  // Round to 1 decimal
    };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      source
    }, 'Failed to get scraper stats');

    return {
      success: 0,
      failure: 0,
      rate: 0
    };
  }
}

/**
 * Log comprehensive summary report
 * @param report - Daily summary report
 */
function logSummaryReport(report: DailySummaryReport): void {
  logger.info({
    job: 'daily-summary',
    msg: 'Daily summary report generated',
    report: {
      date: report.date,
      iposScraped: report.iposScraped,
      iposBySource: report.iposBySource,
      nseSuccessRate: report.scraperRuns.nse.rate,
      bseSuccessRate: report.scraperRuns.bse.rate,
      apiSuccessRate: report.scraperRuns.apiFallback.rate,
      subscriptionUpdates: report.subscriptionUpdates,
      avgScrapeDuration: report.avgScrapeDuration,
      errorCount: report.errors.length,
      topErrors: report.errors.slice(0, 5).map(e => e.message)
    }
  });

  // Log detailed breakdown
  logger.info({
    job: 'daily-summary',
    msg: 'Scraper run breakdown',
    nse: report.scraperRuns.nse,
    bse: report.scraperRuns.bse,
    api: report.scraperRuns.apiFallback
  });

  // Log errors if any
  if (report.errors.length > 0) {
    logger.warn({
      job: 'daily-summary',
      msg: 'Errors encountered in last 24 hours',
      errors: report.errors
    });
  }
}

/**
 * Create empty report for error cases
 * @returns Empty daily summary report
 */
function createEmptyReport(): DailySummaryReport {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0],
    timeRange: { start: now, end: now },
    iposScraped: 0,
    iposBySource: { nse: 0, bse: 0, api: 0 },
    scraperRuns: {
      nse: { success: 0, failure: 0, rate: 0 },
      bse: { success: 0, failure: 0, rate: 0 },
      apiFallback: { success: 0, failure: 0, rate: 0 }
    },
    subscriptionUpdates: 0,
    avgScrapeDuration: 0,
    errors: []
  };
}
