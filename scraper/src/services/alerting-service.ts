/**
 * Alerting Service
 *
 * Sends alerts when scraper failures exceed thresholds.
 * Supports console logging (always) and email notifications (optional).
 * Story 7.5: Error Handling & Monitoring
 */

import { logger } from '../utils/logger';
import type { ScraperAlert, ScraperSource } from './types';
import type { ScraperLog } from '../../../web/lib/db/types';

/**
 * Configuration for email alerting
 */
export interface EmailAlertConfig {
  enabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  adminEmail?: string;
}

/**
 * Service for sending scraper failure alerts
 */
export class AlertingService {
  private emailConfig: EmailAlertConfig;

  constructor(emailConfig: EmailAlertConfig = { enabled: false }) {
    this.emailConfig = emailConfig;
  }

  /**
   * Send alert via console (always) and email (if configured)
   */
  async sendAlert(alert: ScraperAlert): Promise<void> {
    // Always log to console
    this.logAlert(alert);

    // Send email if enabled
    if (this.emailConfig.enabled) {
      await this.sendEmailAlert(alert);
    }
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
   * Send email alert (optional)
   */
  private async sendEmailAlert(alert: ScraperAlert): Promise<void> {
    try {
      // Email sending would be implemented here using Nodemailer
      // For now, we'll log that email would be sent
      logger.info({
        alert: 'email_would_be_sent',
        source: alert.source,
        severity: alert.severity,
        recipient: this.emailConfig.adminEmail,
      }, `Email alert would be sent to ${this.emailConfig.adminEmail}`);

      // TODO: Implement actual email sending with Nodemailer
      // const transporter = nodemailer.createTransporter({...});
      // await transporter.sendMail({
      //   from: this.emailConfig.smtpUser,
      //   to: this.emailConfig.adminEmail,
      //   subject: `[IPODhan Alert] Scraper ${alert.source} ${alert.severity}`,
      //   html: this.generateEmailHtml(alert),
      // });
    } catch (error) {
      logger.error({
        error,
        source: alert.source,
      }, `Failed to send email alert for ${alert.source}`);
      // Don't throw - email failure shouldn't crash the alerting system
    }
  }

  /**
   * Generate HTML email content
   */
  private generateEmailHtml(alert: ScraperAlert): string {
    return `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .header { background-color: ${alert.severity === 'ERROR' ? '#dc2626' : '#f59e0b'}; color: white; padding: 20px; }
            .content { padding: 20px; }
            .metric { margin: 10px 0; }
            .errors { background-color: #f3f4f6; padding: 15px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Scraper Alert: ${alert.source}</h1>
            <p>Severity: ${alert.severity}</p>
          </div>
          <div class="content">
            <div class="metric"><strong>Reason:</strong> ${alert.reason}</div>
            <div class="metric"><strong>Consecutive Failures:</strong> ${alert.consecutiveFailures}</div>
            <div class="metric"><strong>Success Rate (24h):</strong> ${alert.successRate.toFixed(1)}%</div>
            <div class="metric"><strong>Timestamp:</strong> ${alert.timestamp.toISOString()}</div>

            ${alert.recentErrors.length > 0 ? `
            <div class="errors">
              <h3>Recent Errors:</h3>
              <ul>
                ${alert.recentErrors.map(err => `<li>${err || 'Unknown error'}</li>`).join('')}
              </ul>
            </div>
            ` : ''}
          </div>
        </body>
      </html>
    `;
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
