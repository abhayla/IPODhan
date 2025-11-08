/**
 * Slack Alert System - Production Monitoring
 *
 * Elegant, actionable Slack alerts for operational events.
 * Uses Slack Incoming Webhooks for simplicity and reliability.
 *
 * Design Philosophy:
 * - Slack for operational alerts (not critical - use email for P0)
 * - Rich formatting with blocks API for clarity
 * - Threshold-based to prevent notification fatigue
 * - Gracefully degrades if webhook unavailable
 *
 * Usage:
 *   await sendDRHPFailureAlert(8); // Only sends if >5
 *   await sendSlowConsolidationAlert(1200); // Only sends if >1000ms
 */

import { IncomingWebhook, IncomingWebhookSendArguments } from '@slack/webhook';
import { logger } from '@/lib/logging/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Get Slack webhook URL from environment
 * Returns null if not configured (graceful degradation)
 */
function getWebhookUrl(): string | null {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    logger.warn('[Slack Alerts] Webhook URL not configured, alerts will be logged only');
    return null;
  }
  return url;
}

/**
 * Create Slack webhook instance (singleton pattern)
 */
let webhookInstance: IncomingWebhook | null = null;

function getWebhook(): IncomingWebhook | null {
  if (webhookInstance) return webhookInstance;

  const url = getWebhookUrl();
  if (!url) return null;

  try {
    webhookInstance = new IncomingWebhook(url);
    logger.info('[Slack Alerts] Webhook initialized successfully');
    return webhookInstance;
  } catch (error) {
    logger.error('[Slack Alerts] Failed to create webhook', { error });
    return null;
  }
}

// ============================================================================
// ALERT FUNCTIONS
// ============================================================================

/**
 * Send alert for DRHP extraction failures
 *
 * Threshold: >5 failures in 24 hours
 * Frequency: Every 30 minutes while threshold exceeded
 *
 * This alerts to operational issues like:
 * - PDF download failures
 * - Python extraction timeouts
 * - File system issues
 */
export async function sendDRHPFailureAlert(failureCount: number, details?: {
  last24Hours: number;
  timeoutErrors: number;
  downloadErrors: number;
  extractionErrors: number;
}): Promise<boolean> {
  // Threshold check
  if (failureCount <= 5) {
    return false; // Below threshold
  }

  const webhook = getWebhook();
  if (!webhook) {
    logger.warn('[Slack Alerts] DRHP failure alert triggered but webhook not configured', {
      failureCount,
      action: 'logged_only'
    });
    return false;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const message: IncomingWebhookSendArguments = {
    text: `🔴 DRHP Extraction Failures: ${failureCount} in last 24h`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔴 DRHP Extraction Alert',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${failureCount}* DRHP extraction failures detected in the last 24 hours.\n\n*Why this matters:* DRHP extraction provides critical financial data. Failures mean incomplete IPO information for users.`
        }
      },
      ...(details ? [{
        type: 'section' as const,
        fields: [
          {
            type: 'mrkdwn' as const,
            text: `*Total Failures:*\n${details.last24Hours}`
          },
          {
            type: 'mrkdwn' as const,
            text: `*Download Errors:*\n${details.downloadErrors}`
          },
          {
            type: 'mrkdwn' as const,
            text: `*Timeout Errors:*\n${details.timeoutErrors}`
          },
          {
            type: 'mrkdwn' as const,
            text: `*Extraction Errors:*\n${details.extractionErrors}`
          }
        ]
      }] : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*What to do:*\n1. Check manual review queue\n2. Verify Python extraction service running\n3. Check disk space and file permissions\n4. Review scraper logs for patterns'
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Metrics Dashboard',
              emoji: true
            },
            url: `${appUrl}/admin/metrics`,
            style: 'danger'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Review Queue',
              emoji: true
            },
            url: `${appUrl}/admin/documents?status=failed`
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⏰ ${new Date().toISOString()} | Threshold: 5 failures | Environment: ${process.env.NODE_ENV || 'development'}`
          }
        ]
      }
    ]
  };

  try {
    await webhook.send(message);
    logger.info('[Slack Alerts] DRHP failure alert sent successfully', {
      failureCount,
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    logger.error('[Slack Alerts] Failed to send DRHP failure alert', { error, failureCount });
    return false;
  }
}

/**
 * Send alert for slow data consolidation
 *
 * Threshold: p95 latency >1000ms
 * Frequency: Every 30 minutes while threshold exceeded
 *
 * Indicates performance degradation that could affect user experience
 */
export async function sendSlowConsolidationAlert(p95Latency: number, details?: {
  avgLatency: number;
  p99Latency: number;
  slowestOperation: string;
  operationsLast1h: number;
}): Promise<boolean> {
  // Threshold check
  if (p95Latency <= 1000) {
    return false; // Performance is acceptable
  }

  const webhook = getWebhook();
  if (!webhook) {
    logger.warn('[Slack Alerts] Slow consolidation alert triggered but webhook not configured', {
      p95Latency,
      action: 'logged_only'
    });
    return false;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const severity = p95Latency > 2000 ? 'danger' : 'warning';
  const emoji = p95Latency > 2000 ? '🔴' : '⚠️';

  const message: IncomingWebhookSendArguments = {
    text: `${emoji} Slow Data Consolidation: p95 ${p95Latency}ms`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} Performance Degradation Alert`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Data consolidation p95 latency: ${p95Latency}ms*\n(Target: <500ms, Acceptable: <1000ms)\n\n*Impact:* Slow consolidation delays IPO data updates and affects scraper throughput.`
        }
      },
      ...(details ? [{
        type: 'section' as const,
        fields: [
          {
            type: 'mrkdwn' as const,
            text: `*Average:*\n${details.avgLatency}ms`
          },
          {
            type: 'mrkdwn' as const,
            text: `*p95:*\n${p95Latency}ms`
          },
          {
            type: 'mrkdwn' as const,
            text: `*p99:*\n${details.p99Latency}ms`
          },
          {
            type: 'mrkdwn' as const,
            text: `*Operations (1h):*\n${details.operationsLast1h}`
          }
        ]
      }] : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Possible causes:*\n• Database connection pool exhausted\n• Redis cache unavailable or slow\n• High concurrent scraper load\n• Network latency to database\n\n*What to do:*\n1. Check database connection pool metrics\n2. Verify Redis connectivity\n3. Review slow query logs\n4. Consider scaling database resources'
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Performance Metrics',
              emoji: true
            },
            url: `${appUrl}/admin/metrics`,
            style: severity
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⏰ ${new Date().toISOString()} | Threshold: 1000ms | Environment: ${process.env.NODE_ENV || 'development'}`
          }
        ]
      }
    ]
  };

  try {
    await webhook.send(message);
    logger.info('[Slack Alerts] Slow consolidation alert sent successfully', {
      p95Latency,
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    logger.error('[Slack Alerts] Failed to send slow consolidation alert', { error, p95Latency });
    return false;
  }
}

/**
 * Send alert for high conflict rate
 *
 * Threshold: >5% of IPOs have conflicts
 * Frequency: Daily digest
 *
 * Indicates data quality issues across sources
 */
export async function sendHighConflictRateAlert(conflictRate: number, details?: {
  totalIPOs: number;
  iposWithConflicts: number;
  mostConflictedFields: Array<{ field: string; count: number }>;
}): Promise<boolean> {
  // Threshold check
  if (conflictRate <= 5.0) {
    return false; // Acceptable conflict rate
  }

  const webhook = getWebhook();
  if (!webhook) {
    logger.warn('[Slack Alerts] High conflict rate alert triggered but webhook not configured', {
      conflictRate,
      action: 'logged_only'
    });
    return false;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const topConflicts = details?.mostConflictedFields
    ? details.mostConflictedFields.slice(0, 5).map(f => `• ${f.field}: ${f.count} conflicts`).join('\n')
    : 'N/A';

  const message: IncomingWebhookSendArguments = {
    text: `⚠️ High Data Conflict Rate: ${conflictRate.toFixed(1)}%`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '⚠️ Data Quality Alert',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Conflict rate: ${conflictRate.toFixed(1)}%* (Target: <2%, Threshold: <5%)\n\n${details ? `${details.iposWithConflicts} of ${details.totalIPOs}` : 'Multiple'} IPOs have data conflicts between sources.`
        }
      },
      ...(details && details.mostConflictedFields.length > 0 ? [{
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: `*Most conflicted fields:*\n${topConflicts}`
        }
      }] : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*What this indicates:*\n• Potential issues with source data quality\n• Normalization rules may need tuning\n• Priority matrix may need adjustment\n\n*What to do:*\n1. Review conflict dashboard for patterns\n2. Check if one source consistently disagrees\n3. Consider adjusting field-specific priorities\n4. Resolve high-severity conflicts first'
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Conflicts',
              emoji: true
            },
            url: `${appUrl}/admin/conflicts`,
            style: 'warning'
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⏰ ${new Date().toISOString()} | Threshold: 5% | Environment: ${process.env.NODE_ENV || 'development'}`
          }
        ]
      }
    ]
  };

  try {
    await webhook.send(message);
    logger.info('[Slack Alerts] High conflict rate alert sent successfully', {
      conflictRate,
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    logger.error('[Slack Alerts] Failed to send high conflict rate alert', { error, conflictRate });
    return false;
  }
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

/**
 * Test Slack configuration
 * Sends a test message to verify webhook setup
 */
export async function testSlackConfiguration(): Promise<{ success: boolean; message: string }> {
  const url = getWebhookUrl();
  if (!url) {
    return {
      success: false,
      message: 'Slack webhook URL not configured. Set SLACK_WEBHOOK_URL in environment variables.'
    };
  }

  const webhook = getWebhook();
  if (!webhook) {
    return {
      success: false,
      message: 'Failed to create Slack webhook. Check SLACK_WEBHOOK_URL format.'
    };
  }

  try {
    await webhook.send({
      text: '✅ IPODhan Slack Alert Test',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '✅ Slack Alert System Test',
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'This is a test message to verify your Slack webhook configuration.\n\nIf you can see this message, your alert system is working correctly!'
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Environment:*\n${process.env.NODE_ENV || 'development'}`
            },
            {
              type: 'mrkdwn',
              text: `*Timestamp:*\n${new Date().toISOString()}`
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🎉 Slack alert system is operational!'
            }
          ]
        }
      ]
    });

    logger.info('[Slack Alerts] Test message sent successfully');
    return {
      success: true,
      message: 'Test message sent to Slack channel. Check your workspace to verify delivery.'
    };
  } catch (error) {
    logger.error('[Slack Alerts] Test message failed', { error });
    return {
      success: false,
      message: `Failed to send test message: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
