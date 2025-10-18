/**
 * Shared types for scraper services
 * Story 7.5: Error Handling & Monitoring
 */

/**
 * Scraper source types
 */
export type ScraperSource = 'NSE' | 'BSE' | 'MONEYCONTROL' | 'CHITTORGARH' | 'API_FALLBACK' | 'INVESTORGAIN_GMP';

/**
 * Scraper type (alias for ScraperSource for compatibility)
 */
export type ScraperType = ScraperSource;

/**
 * Scraper status types
 */
export type ScraperStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL';

/**
 * Alert severity levels
 */
export type AlertSeverity = 'ERROR' | 'WARN' | 'INFO';

/**
 * Scraper alert structure
 */
export interface ScraperAlert {
  source: ScraperSource;
  severity: AlertSeverity;
  reason: string;
  consecutiveFailures: number;
  successRate: number;
  recentErrors: string[];
  timestamp: Date;
}
