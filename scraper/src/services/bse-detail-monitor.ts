/**
 * BSE Detail Page Scraping Monitor & Alerting
 *
 * Purpose: Track BSE detail page scraping health and alert on failures
 * Usage: Called after each BSE scraper run
 */

import logger from '../utils/logger.js';

export interface BSEDetailScrapingMetrics {
  totalIPOs: number;
  detailUrlsFound: number;
  detailsScraped: number;
  enrichedIPOs: number;
  failedIPOs: number;
  errors: string[];
  timestamp: string;
}

export interface BSEDetailHealthStatus {
  isHealthy: boolean;
  metrics: BSEDetailScrapingMetrics;
  issues: string[];
  recommendations: string[];
}

/**
 * Analyze BSE detail scraping health
 */
export function analyzeBSEDetailHealth(metrics: BSEDetailScrapingMetrics): BSEDetailHealthStatus {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Calculate success rates
  const detailUrlRate = metrics.totalIPOs > 0
    ? (metrics.detailUrlsFound / metrics.totalIPOs) * 100
    : 0;

  const scrapingSuccessRate = metrics.detailUrlsFound > 0
    ? (metrics.detailsScraped / metrics.detailUrlsFound) * 100
    : 0;

  const enrichmentRate = metrics.totalIPOs > 0
    ? (metrics.enrichedIPOs / metrics.totalIPOs) * 100
    : 0;

  // Health checks
  let isHealthy = true;

  // 1. Check if detail URL extraction is working
  if (detailUrlRate < 30) {
    isHealthy = false;
    issues.push(`Low detail URL extraction rate: ${detailUrlRate.toFixed(1)}% (expected >30%)`);
    recommendations.push('Check BSE website HTML structure - selector may have changed');
  }

  // 2. Check if detail page scraping is successful
  if (scrapingSuccessRate < 80) {
    isHealthy = false;
    issues.push(`Low scraping success rate: ${scrapingSuccessRate.toFixed(1)}% (expected >80%)`);
    recommendations.push('Review detail page scraping errors - BSE may have changed page structure');
  }

  // 3. Check if data enrichment is happening
  if (enrichmentRate < 25) {
    isHealthy = false;
    issues.push(`Low enrichment rate: ${enrichmentRate.toFixed(1)}% (expected >25%)`);
    recommendations.push('Verify matching logic - detail data may not be merging correctly');
  }

  // 4. Check for errors
  if (metrics.errors.length > 0) {
    const uniqueErrors = [...new Set(metrics.errors)];
    if (uniqueErrors.length > 5) {
      isHealthy = false;
      issues.push(`High error count: ${uniqueErrors.length} unique errors`);
      recommendations.push('Investigate common error patterns in logs');
    }
  }

  // 5. Check if no data at all
  if (metrics.totalIPOs === 0) {
    isHealthy = false;
    issues.push('No IPOs found on BSE - possible site outage or structure change');
    recommendations.push('Alert: BSE scraper may be completely broken');
  }

  return {
    isHealthy,
    metrics,
    issues,
    recommendations
  };
}

/**
 * Log BSE detail scraping health report
 */
export function logBSEDetailHealthReport(health: BSEDetailHealthStatus): void {
  const { isHealthy, metrics, issues, recommendations } = health;

  console.log('\n' + '='.repeat(70));
  console.log('BSE DETAIL PAGE SCRAPING HEALTH REPORT');
  console.log('='.repeat(70) + '\n');

  console.log('📊 METRICS:');
  console.log(`  Total IPOs: ${metrics.totalIPOs}`);
  console.log(`  Detail URLs Found: ${metrics.detailUrlsFound} (${((metrics.detailUrlsFound/metrics.totalIPOs)*100).toFixed(1)}%)`);
  console.log(`  Details Scraped: ${metrics.detailsScraped}`);
  console.log(`  IPOs Enriched: ${metrics.enrichedIPOs} (${((metrics.enrichedIPOs/metrics.totalIPOs)*100).toFixed(1)}%)`);
  console.log(`  Failed IPOs: ${metrics.failedIPOs}`);
  console.log(`  Errors: ${metrics.errors.length}\n`);

  if (isHealthy) {
    console.log('✅ STATUS: HEALTHY');
    logger.info({ metrics }, 'BSE detail scraping is healthy');
  } else {
    console.log('⚠️  STATUS: UNHEALTHY\n');

    console.log('🔴 ISSUES:');
    issues.forEach(issue => console.log(`  • ${issue}`));
    console.log('');

    console.log('💡 RECOMMENDATIONS:');
    recommendations.forEach(rec => console.log(`  • ${rec}`));
    console.log('');

    logger.warn({ metrics, issues, recommendations }, 'BSE detail scraping health issues detected');
  }

  console.log('='.repeat(70) + '\n');
}

/**
 * Check if alerting should be triggered
 * (e.g., send email/Slack notification to developers)
 */
export function shouldTriggerAlert(health: BSEDetailHealthStatus): boolean {
  const { isHealthy, metrics } = health;

  // Trigger alert if:
  // 1. Unhealthy status
  if (!isHealthy) return true;

  // 2. Complete failure (no IPOs found)
  if (metrics.totalIPOs === 0) return true;

  // 3. Critical drop in enrichment (< 20%)
  const enrichmentRate = (metrics.enrichedIPOs / metrics.totalIPOs) * 100;
  if (enrichmentRate < 20) return true;

  return false;
}

/**
 * Get alert severity level
 */
export function getAlertSeverity(health: BSEDetailHealthStatus): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const { metrics } = health;

  // CRITICAL: No data at all
  if (metrics.totalIPOs === 0) return 'CRITICAL';

  // HIGH: Very low enrichment
  const enrichmentRate = (metrics.enrichedIPOs / metrics.totalIPOs) * 100;
  if (enrichmentRate < 10) return 'HIGH';

  // MEDIUM: Low enrichment or many errors
  if (enrichmentRate < 30 || metrics.errors.length > 10) return 'MEDIUM';

  // LOW: Minor issues
  return 'LOW';
}

/**
 * Create alert message for external systems
 */
export function createAlertMessage(health: BSEDetailHealthStatus): string {
  const severity = getAlertSeverity(health);
  const { metrics, issues } = health;

  let message = `[${severity}] BSE Detail Page Scraping Alert\n\n`;
  message += `Timestamp: ${metrics.timestamp}\n`;
  message += `Enrichment Rate: ${((metrics.enrichedIPOs/metrics.totalIPOs)*100).toFixed(1)}%\n\n`;
  message += `Issues:\n`;
  issues.forEach(issue => message += `• ${issue}\n`);
  message += `\nCheck logs for details.`;

  return message;
}
