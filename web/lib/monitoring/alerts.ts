/**
 * Alert System
 *
 * Provides alert notifications for critical system events
 * with support for multiple channels (Discord, Email, Slack)
 */

import { logger } from '../logging/logger';

export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export interface Alert {
  level: AlertLevel;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Send alert to all configured channels
 */
export async function sendAlert(alert: Alert): Promise<void> {
  // Log alert
  logger[alert.level as keyof typeof logger](alert.title, {
    message: alert.message,
    ...alert.metadata,
  });

  // Send to notification channels based on severity
  if (alert.level === AlertLevel.CRITICAL) {
    await Promise.all([
      sendDiscordAlert(alert),
      sendEmailAlert(alert),
    ]);
  } else if (alert.level === AlertLevel.WARNING) {
    await sendDiscordAlert(alert);
  }
}

/**
 * Send alert to Discord webhook
 */
async function sendDiscordAlert(alert: Alert): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.debug('Discord webhook not configured, skipping notification');
    return;
  }

  try {
    const emoji = getEmojiForLevel(alert.level);
    const color = getColorForLevel(alert.level);

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: `${emoji} ${alert.title}`,
            description: alert.message,
            color,
            fields: alert.metadata
              ? Object.entries(alert.metadata).map(([key, value]) => ({
                  name: key,
                  value: String(value),
                  inline: true,
                }))
              : [],
            timestamp: new Date().toISOString(),
            footer: {
              text: 'IPODhan Monitoring',
            },
          },
        ],
      }),
    });

    logger.debug('Discord alert sent', { title: alert.title });
  } catch (error) {
    logger.error('Failed to send Discord alert', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send alert via email (placeholder - implement with nodemailer)
 */
async function sendEmailAlert(alert: Alert): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    logger.debug('Admin email not configured, skipping email notification');
    return;
  }

  // TODO: Implement email sending with nodemailer
  logger.debug('Email alert would be sent', {
    to: adminEmail,
    subject: alert.title,
  });
}

/**
 * Get emoji for alert level
 */
function getEmojiForLevel(level: AlertLevel): string {
  switch (level) {
    case AlertLevel.INFO:
      return 'ℹ️';
    case AlertLevel.WARNING:
      return '⚠️';
    case AlertLevel.CRITICAL:
      return '🚨';
  }
}

/**
 * Get color code for Discord embed
 */
function getColorForLevel(level: AlertLevel): number {
  switch (level) {
    case AlertLevel.INFO:
      return 0x3498db; // Blue
    case AlertLevel.WARNING:
      return 0xf39c12; // Orange
    case AlertLevel.CRITICAL:
      return 0xe74c3c; // Red
  }
}

/**
 * Check alert rules and send notifications
 */
export async function checkAlertRules(metrics: any): Promise<void> {
  // Database response time
  if (metrics.database?.avgResponseTime > 500) {
    await sendAlert({
      level: AlertLevel.CRITICAL,
      title: 'Database response time exceeds target',
      message: `Average response time: ${metrics.database.avgResponseTime}ms (target: <500ms)`,
      metadata: {
        avgResponseTime: metrics.database.avgResponseTime,
        threshold: 500,
      },
    });
  }

  // Cache hit rate
  if (metrics.redis?.hitRate !== undefined && metrics.redis.hitRate < 80) {
    await sendAlert({
      level: AlertLevel.WARNING,
      title: 'Redis cache hit rate below target',
      message: `Hit rate: ${metrics.redis.hitRate.toFixed(2)}% (target: >80%)`,
      metadata: {
        hitRate: metrics.redis.hitRate,
        threshold: 80,
      },
    });
  }

  // Scraper failures
  if (metrics.scraper?.failedLast24h > 5) {
    await sendAlert({
      level: AlertLevel.WARNING,
      title: 'High scraper failure rate',
      message: `${metrics.scraper.failedLast24h} failures in last 24h`,
      metadata: {
        failures: metrics.scraper.failedLast24h,
        threshold: 5,
      },
    });
  }

  // Connection pool usage
  if (metrics.database?.connections > 18) {
    await sendAlert({
      level: AlertLevel.WARNING,
      title: 'Database connection pool near capacity',
      message: `${metrics.database.connections}/20 connections in use (90% capacity)`,
      metadata: {
        connections: metrics.database.connections,
        maxConnections: 20,
      },
    });
  }

  // Memory usage
  if (metrics.system?.memoryUsageMB > 800) {
    await sendAlert({
      level: AlertLevel.CRITICAL,
      title: 'High memory usage detected',
      message: `Memory usage: ${metrics.system.memoryUsageMB}MB (threshold: 800MB)`,
      metadata: {
        memoryUsageMB: metrics.system.memoryUsageMB,
        threshold: 800,
      },
    });
  }

  // Disk space
  if (metrics.system?.diskUsagePercent > 85) {
    await sendAlert({
      level: AlertLevel.WARNING,
      title: 'Low disk space',
      message: `Disk usage: ${metrics.system.diskUsagePercent}% (threshold: 85%)`,
      metadata: {
        diskUsage: metrics.system.diskUsagePercent,
        threshold: 85,
      },
    });
  }
}
