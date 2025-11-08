/**
 * Shared types for scraper services
 * Story 7.5: Error Handling & Monitoring
 */

/**
 * Scraper source types
 * Re-exported from field-priority-matrix for consistency
 */
export type { ScraperSource } from '../config/field-priority-matrix.js';

/**
 * Scraper type (alias for ScraperSource for compatibility)
 */
export type ScraperType = import('../config/field-priority-matrix.js').ScraperSource;

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
