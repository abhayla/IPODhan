/**
 * Alerting Service
 *
 * Sends alerts when scraper failures exceed thresholds.
 * Supports console logging (always) and email notifications (optional).
 * Story 7.5: Error Handling & Monitoring
 */

import { logger } from '../utils/logger';
import type { ScraperAlert, ScraperSource } from './types';
import type { ScraperLog } from '@ipodhan/shared';

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
      // Dynamically import nodemailer to avoid bundling if not used
      const nodemailer = await import('nodemailer');

      // Create SMTP transporter
      const transporter = nodemailer.createTransport({
        host: this.emailConfig.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com',
        port: this.emailConfig.smtpPort || parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: this.emailConfig.smtpUser || process.env.SMTP_USER,
          pass: this.emailConfig.smtpPassword || process.env.SMTP_PASSWORD
        }
      });

      // Send email
      await transporter.sendMail({
        from: this.emailConfig.smtpUser || process.env.SMTP_USER,
        to: this.emailConfig.adminEmail || process.env.ADMIN_EMAIL,
        subject: `[IPODhan Alert] Scraper ${alert.source} ${alert.severity}: ${alert.reason}`,
        html: this.generateEmailHtml(alert)
      });

      logger.info({
        source: alert.source,
        severity: alert.severity,
        recipient: this.emailConfig.adminEmail || process.env.ADMIN_EMAIL
      }, `Email alert sent successfully to ${this.emailConfig.adminEmail || process.env.ADMIN_EMAIL}`);

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
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
