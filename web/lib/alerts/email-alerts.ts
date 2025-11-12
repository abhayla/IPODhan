/**
 * Email Alert System - Production Monitoring
 *
 * Elegant, actionable email alerts for critical system events.
 * Follows industry standards with graceful degradation.
 *
 * Design Philosophy:
 * - Every alert answers: What? Why? What to do?
 * - Threshold-based (not spammy)
 * - Gracefully degrades if SMTP unavailable
 * - Logs all alert attempts for audit trail
 *
 * Usage:
 *   await sendCriticalConflictAlert(15); // Only sends if >10
 */

import nodemailer from 'nodemailer';
import { logger } from '@/lib/logging/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
  to: string;
}

/**
 * Get email configuration from environment variables
 * Returns null if SMTP not configured (graceful degradation)
 */
function getEmailConfig(): EmailConfig | null {
  const requiredVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'ADMIN_EMAIL'];
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    logger.warn('[Email Alerts] SMTP not configured, alerts will be logged only', { missing });
    return null;
  }

  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASSWORD!,
    },
    from: process.env.SMTP_FROM || process.env.SMTP_USER!,
    to: process.env.ADMIN_EMAIL!,
  };
}

/**
 * Create email transporter (singleton pattern)
 */
let transporterInstance: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporterInstance) return transporterInstance;

  const config = getEmailConfig();
  if (!config) return null;

  try {
    transporterInstance = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    logger.info('[Email Alerts] Transporter initialized successfully');
    return transporterInstance;
  } catch (error) {
    logger.error('[Email Alerts] Failed to create transporter', { error });
    return null;
  }
}

// ============================================================================
// ALERT FUNCTIONS
// ============================================================================

/**
 * Send alert for CRITICAL data conflicts
 *
 * Threshold: Only sends if >10 critical conflicts
 * Frequency: Once when threshold crossed, then hourly until resolved
 *
 * Alert Template:
 * - Subject: Clear urgency indicator
 * - Body: Explains impact, provides direct link to resolution
 */
export async function sendCriticalConflictAlert(conflictCount: number): Promise<boolean> {
  // Threshold check - don't spam for small numbers
  if (conflictCount <= 10) {
    return false; // Below threshold, no alert needed
  }

  const config = getEmailConfig();
  if (!config) {
    logger.warn('[Email Alerts] CRITICAL conflicts alert triggered but SMTP not configured', {
      conflictCount,
      action: 'logged_only'
    });
    return false;
  }

  const transporter = getTransporter();
  if (!transporter) {
    logger.error('[Email Alerts] Cannot send alert - transporter unavailable');
    return false;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const mailOptions = {
    from: config.from,
    to: config.to,
    subject: `🚨 CRITICAL: ${conflictCount} Data Conflicts Require Immediate Attention`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
            .metric { font-size: 48px; font-weight: bold; color: #dc2626; margin: 10px 0; }
            .impact { background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin: 20px 0; }
            .action { background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
            .footer { color: #6b7280; font-size: 14px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⚠️ IPODhan Production Alert</h1>
              <p style="margin: 5px 0 0 0;">Critical Data Conflicts Detected</p>
            </div>
            <div class="content">
              <p><strong>What's Wrong:</strong></p>
              <div class="metric">${conflictCount}</div>
              <p>unresolved CRITICAL data conflicts detected in the IPODhan production database.</p>

              <div class="impact">
                <strong>Why This Matters:</strong>
                <p style="margin: 5px 0 0 0;">Data conflicts represent inconsistencies between multiple sources (NSE, BSE, DRHP). When unresolved, they can lead to:</p>
                <ul style="margin: 10px 0 0 0;">
                  <li>Incorrect IPO information displayed to users</li>
                  <li>Failed automated updates and data staleness</li>
                  <li>Reduced system confidence scores</li>
                </ul>
              </div>

              <p><strong>What To Do:</strong></p>
              <ol>
                <li>Review conflicts in the admin dashboard</li>
                <li>Resolve CRITICAL conflicts first (red indicators)</li>
                <li>Use auto-resolve for low-risk conflicts if appropriate</li>
              </ol>

              <a href="${appUrl}/admin/conflicts" class="action">Resolve Conflicts Now →</a>

              <div class="footer">
                <p><strong>Alert Details:</strong></p>
                <ul style="margin: 5px 0; padding-left: 20px;">
                  <li>Threshold: 10 critical conflicts</li>
                  <li>Current count: ${conflictCount}</li>
                  <li>Time: ${new Date().toISOString()}</li>
                  <li>Environment: ${process.env.NODE_ENV || 'development'}</li>
                </ul>
                <p>This is an automated alert from IPODhan. Alerts are sent hourly until conflicts drop below threshold.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
IPODhan Production Alert: ${conflictCount} Critical Data Conflicts

WHAT'S WRONG:
${conflictCount} unresolved CRITICAL data conflicts detected.

WHY THIS MATTERS:
Data conflicts can lead to incorrect information displayed to users, failed updates, and reduced system confidence.

WHAT TO DO:
1. Visit ${appUrl}/admin/conflicts
2. Resolve CRITICAL conflicts first (red indicators)
3. Use auto-resolve for low-risk conflicts if appropriate

Alert sent at: ${new Date().toISOString()}
Threshold: 10 critical conflicts
Environment: ${process.env.NODE_ENV || 'development'}
    `.trim(),
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('[Email Alerts] CRITICAL conflict alert sent successfully', {
      conflictCount,
      recipient: config.to,
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    logger.error('[Email Alerts] Failed to send CRITICAL conflict alert', {
      error,
      conflictCount,
      config: { host: config.host, port: config.port }
    });
    return false;
  }
}

/**
 * Send alert for duplicate IPO detection
 *
 * Threshold: Any duplicate (>0)
 * Frequency: Immediately when detected
 *
 * This is CRITICAL as it indicates a failure in deduplication logic
 */
export async function sendDuplicateIPOAlert(duplicates: Array<{ companyName: string; count: number }>): Promise<boolean> {
  if (duplicates.length === 0) {
    return false; // No duplicates, no alert
  }

  const config = getEmailConfig();
  if (!config) {
    logger.warn('[Email Alerts] Duplicate IPO alert triggered but SMTP not configured', {
      duplicateCount: duplicates.length,
      action: 'logged_only'
    });
    return false;
  }

  const transporter = getTransporter();
  if (!transporter) return false;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const duplicatesList = duplicates
    .map(d => `<li>${d.companyName}: ${d.count} entries</li>`)
    .join('\n');

  const mailOptions = {
    from: config.from,
    to: config.to,
    subject: `🔴 CRITICAL: Duplicate IPO Detection Failure`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #991b1b; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
            .critical { background: #fef2f2; border-left: 4px solid #991b1b; padding: 12px; margin: 20px 0; }
            .action { background: #991b1b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">🔴 CRITICAL SYSTEM FAILURE</h1>
              <p style="margin: 5px 0 0 0;">Deduplication Logic Failure Detected</p>
            </div>
            <div class="content">
              <p><strong>What's Wrong:</strong></p>
              <p>The IPO deduplication system has failed, allowing duplicate entries:</p>
              <ul>${duplicatesList}</ul>

              <div class="critical">
                <strong>Why This Is Critical:</strong>
                <p style="margin: 5px 0 0 0;">Duplicate IPOs indicate a fundamental failure in the data integrity layer. This can cause:</p>
                <ul style="margin: 10px 0 0 0;">
                  <li><strong>Data Corruption:</strong> Conflicting information across entries</li>
                  <li><strong>User Confusion:</strong> Same IPO appearing multiple times</li>
                  <li><strong>System Instability:</strong> Distributed locking may be failing</li>
                </ul>
              </div>

              <p><strong>Immediate Actions Required:</strong></p>
              <ol>
                <li><strong>Stop scrapers immediately</strong> to prevent more duplicates</li>
                <li>Investigate distributed locking (Redis connection)</li>
                <li>Review scraper logs for race conditions</li>
                <li>Manually merge duplicate entries after identifying root cause</li>
              </ol>

              <a href="${appUrl}/admin" class="action">Open Admin Dashboard →</a>

              <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
                Alert sent at: ${new Date().toISOString()}<br>
                Duplicates detected: ${duplicates.length}<br>
                <strong>Priority: P0 - IMMEDIATE ACTION REQUIRED</strong>
              </p>
            </div>
          </div>
        </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.error('[Email Alerts] Duplicate IPO alert sent', {
      duplicates,
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    logger.error('[Email Alerts] Failed to send duplicate IPO alert', { error, duplicates });
    return false;
  }
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

/**
 * Test email configuration
 * Sends a test email to verify SMTP setup
 */
export async function testEmailConfiguration(): Promise<{ success: boolean; message: string }> {
  const config = getEmailConfig();
  if (!config) {
    return {
      success: false,
      message: 'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, ADMIN_EMAIL in environment variables.'
    };
  }

  const transporter = getTransporter();
  if (!transporter) {
    return {
      success: false,
      message: 'Failed to create email transporter. Check SMTP credentials.'
    };
  }

  try {
    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject: '✅ IPODhan Email Alert Test',
      html: `
        <h2>Email Alert System Test</h2>
        <p>This is a test email to verify your SMTP configuration.</p>
        <p><strong>Configuration Details:</strong></p>
        <ul>
          <li>SMTP Host: ${config.host}</li>
          <li>SMTP Port: ${config.port}</li>
          <li>From: ${config.from}</li>
          <li>To: ${config.to}</li>
        </ul>
        <p>If you received this email, your alert system is working correctly! ✅</p>
        <p style="color: #6b7280; font-size: 14px;">Sent at: ${new Date().toISOString()}</p>
      `,
    });

    logger.info('[Email Alerts] Test email sent successfully', { to: config.to });
    return {
      success: true,
      message: `Test email sent to ${config.to}. Check inbox to verify delivery.`
    };
  } catch (error) {
    logger.error('[Email Alerts] Test email failed', { error });
    return {
      success: false,
      message: `Failed to send test email: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
