/**
 * Alerting Service
 *
 * Sends alerts when scraper failures exceed thresholds.
 * Always logs to console (structured). Routes through the Notifier gateway
 * (owner-notify.ts) so scraper degradation reaches the owner's phone -- see
 * .claude/rules/notifier-integration.md.
 * Story 7.5: Error Handling & Monitoring. T-194: replaced the nodemailer SMTP
 * path with Notifier (org rule: Notifier is the single owner-alert channel).
 */

import { logger } from '../utils/logger';
import type { ScraperAlert, AlertSeverity } from './types';
import type { ScraperLog } from '@ipodhan/shared';
import { notifyOwner, type OwnerSeverity } from './owner-notify';

/** Maps the scraper's internal alert severity to Notifier's routing tiers. */
const OWNER_SEVERITY_BY_ALERT_SEVERITY: Record<AlertSeverity, OwnerSeverity> = {
  ERROR: 'P1',
  WARN: 'P2',
  INFO: 'info',
};

/**
 * Service for sending scraper failure alerts
 */
export class AlertingService {
  /**
   * Send alert via structured log (always) and the Notifier gateway.
   */
  async sendAlert(alert: ScraperAlert): Promise<void> {
    this.logAlert(alert);
    this.notifyOwnerOfAlert(alert);
  }

  /**
   * Log alert to console with structured logging
   */
  private logAlert(alert: ScraperAlert): void {
    const logMethod = alert.severity === 'ERROR' ? logger.error : logger.warn;

    logMethod.call(logger, {
      alert: 'scraper_failure',
      source: alert.source,
      severity: alert.severity,
      reason: alert.reason,
      consecutiveFailures: alert.consecutiveFailures,
      successRate: alert.successRate,
      recentErrorCount: alert.recentErrors.length,
      timestamp: alert.timestamp,
    }, `[ALERT] Scraper ${alert.source} - ${alert.reason}`);

    // Log recent errors
    if (alert.recentErrors.length > 0) {
      logger.warn({
        source: alert.source,
        errors: alert.recentErrors,
      }, `Recent errors for ${alert.source}:`);
    }
  }

  /**
   * Fire-and-forget owner notification via the Notifier gateway. Fail-open
   * by construction (owner-notify.ts) -- a dead/unconfigured Notifier can
   * never fail or delay a scraper run.
   */
  private notifyOwnerOfAlert(alert: ScraperAlert): void {
    const recentErrorsPreview = alert.recentErrors.slice(0, 3).join('; ');
    notifyOwner(
      OWNER_SEVERITY_BY_ALERT_SEVERITY[alert.severity],
      `Scraper ${alert.source}: ${alert.reason}`,
      {
        body: `Consecutive failures: ${alert.consecutiveFailures}. Success rate (24h): ${alert.successRate.toFixed(1)}%.` +
          (recentErrorsPreview ? ` Recent errors: ${recentErrorsPreview}` : ''),
        type: 'scraper-failure',
        dedupeKey: `scraper-failure:${alert.source}`,
      }
    );
  }

  /**
   * Get recent error messages from scraper logs
   */
  getRecentErrors(logs: ScraperLog[], limit: number = 5): string[] {
    return logs
      .filter(log => log.status === 'FAILURE' && log.errorMessage)
      .slice(0, limit)
      .map(log => log.errorMessage!)
      .filter(Boolean);
  }
}
