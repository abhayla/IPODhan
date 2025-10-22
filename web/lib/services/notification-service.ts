/**
 * Notification Service
 * Handles email and Telegram notifications for admin events
 *
 * Features:
 * - Email notifications via nodemailer (SMTP)
 * - Telegram notifications via Bot API
 * - Configurable notification triggers
 * - Rate limiting (1 test per minute)
 * - Async sending (non-blocking)
 * - Queue for failed notifications (future enhancement)
 *
 * Security:
 * - Encrypted password storage (crypto module)
 * - Masked sensitive data in responses
 * - Environment variable fallbacks
 */

import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { adminSettings } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

// Encryption key (stored in env or generated)
const ENCRYPTION_KEY = process.env.NOTIFICATION_ENCRYPTION_KEY || 'ipodhan-2025-notification-key-32b'; // 32 bytes
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Rate limiting for test notifications
const testRateLimiter = new Map<string, number>();
const TEST_RATE_LIMIT_MS = 60 * 1000; // 1 minute

/**
 * Notification configuration structure
 */
export interface NotificationConfig {
  email: {
    enabled: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string; // Encrypted in DB
    fromEmail: string;
    toEmail?: string; // Optional override
  };
  telegram: {
    enabled: boolean;
    botToken: string; // Encrypted in DB
    chatId: string;
  };
  triggers: {
    ipoLocked: boolean;
    ipoUnlocked: boolean;
    fieldProtectionEnabled: boolean;
    fieldProtectionDisabled: boolean;
    scraperUpdateBlocked: boolean;
    bulkOperationCompleted: boolean;
  };
}

/**
 * Notification event types
 */
export type NotificationEvent =
  | 'ipo_locked'
  | 'ipo_unlocked'
  | 'field_protection_enabled'
  | 'field_protection_disabled'
  | 'scraper_update_blocked'
  | 'bulk_operation_completed';

/**
 * Notification context data
 */
export interface NotificationContext {
  ipoId?: string;
  companyName?: string;
  fieldName?: string;
  tableName?: string;
  scraperName?: string;
  adminName?: string;
  note?: string;
  count?: number; // For bulk operations
  details?: string;
}

/**
 * Encrypt sensitive data
 */
function encrypt(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt sensitive data
 */
function decrypt(text: string): string {
  if (!text) return '';
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift()!, 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

/**
 * Mask sensitive data for display
 */
export function maskSensitiveData(value: string): string {
  if (!value || value.length < 4) return '*******';
  return value.slice(0, 2) + '*'.repeat(Math.max(7, value.length - 4)) + value.slice(-2);
}

/**
 * Get notification configuration from database
 */
export async function getNotificationConfig(): Promise<NotificationConfig> {
  const db = await getDb();

  const result = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.settingKey, 'notifications_config'))
    .limit(1);

  if (result.length === 0) {
    // Return default config
    return {
      email: {
        enabled: false,
        smtpHost: process.env.SMTP_HOST || '',
        smtpPort: parseInt(process.env.SMTP_PORT || '587'),
        smtpUser: process.env.SMTP_USER || '',
        smtpPassword: process.env.SMTP_PASSWORD || '',
        fromEmail: process.env.SMTP_FROM_EMAIL || '',
      },
      telegram: {
        enabled: false,
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
      },
      triggers: {
        ipoLocked: true,
        ipoUnlocked: true,
        fieldProtectionEnabled: true,
        fieldProtectionDisabled: true,
        scraperUpdateBlocked: true,
        bulkOperationCompleted: true,
      },
    };
  }

  const config: NotificationConfig = JSON.parse(result[0].settingValue || '{}');

  // Decrypt sensitive fields
  if (config.email.smtpPassword) {
    config.email.smtpPassword = decrypt(config.email.smtpPassword);
  }
  if (config.telegram.botToken) {
    config.telegram.botToken = decrypt(config.telegram.botToken);
  }

  return config;
}

/**
 * Save notification configuration to database
 */
export async function saveNotificationConfig(config: NotificationConfig): Promise<void> {
  const db = await getDb();

  // Encrypt sensitive fields
  const encryptedConfig = { ...config };
  if (encryptedConfig.email.smtpPassword) {
    encryptedConfig.email.smtpPassword = encrypt(encryptedConfig.email.smtpPassword);
  }
  if (encryptedConfig.telegram.botToken) {
    encryptedConfig.telegram.botToken = encrypt(encryptedConfig.telegram.botToken);
  }

  const settingValue = JSON.stringify(encryptedConfig);

  await db
    .insert(adminSettings)
    .values({
      settingKey: 'notifications_config',
      settingValue,
    })
    .onConflictDoUpdate({
      target: adminSettings.settingKey,
      set: {
        settingValue,
        updatedAt: new Date(),
      },
    });
}

/**
 * Check if notification should be sent for event
 */
export async function shouldNotify(event: NotificationEvent): Promise<boolean> {
  const config = await getNotificationConfig();

  const triggerMap: Record<NotificationEvent, keyof NotificationConfig['triggers']> = {
    ipo_locked: 'ipoLocked',
    ipo_unlocked: 'ipoUnlocked',
    field_protection_enabled: 'fieldProtectionEnabled',
    field_protection_disabled: 'fieldProtectionDisabled',
    scraper_update_blocked: 'scraperUpdateBlocked',
    bulk_operation_completed: 'bulkOperationCompleted',
  };

  return config.triggers[triggerMap[event]] || false;
}

/**
 * Send email notification
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await getNotificationConfig();

    if (!config.email.enabled) {
      return { success: false, error: 'Email notifications are disabled' };
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: config.email.smtpUser,
        pass: config.email.smtpPassword,
      },
    });

    // Send email
    await transporter.sendMail({
      from: config.email.fromEmail,
      to,
      subject,
      text: body,
      html: html || body,
    });

    return { success: true };
  } catch (error) {
    console.error('[NotificationService] Email send failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send Telegram notification
 */
export async function sendTelegram(
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await getNotificationConfig();

    if (!config.telegram.enabled) {
      return { success: false, error: 'Telegram notifications are disabled' };
    }

    // Send via Telegram Bot API
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API error' };
    }

    return { success: true };
  } catch (error) {
    console.error('[NotificationService] Telegram send failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send notification for admin event
 */
export async function sendNotification(
  event: NotificationEvent,
  context: NotificationContext
): Promise<void> {
  // Check if notifications are enabled for this event
  const enabled = await shouldNotify(event);
  if (!enabled) {
    return;
  }

  // Generate message
  const { subject, body } = generateNotificationMessage(event, context);

  // Send async (non-blocking)
  Promise.all([
    sendEmail(context.adminName || 'admin@ipodhan.com', subject, body),
    sendTelegram(body),
  ]).catch((error) => {
    console.error('[NotificationService] Notification failed:', error);
    // TODO: Queue for retry
  });
}

/**
 * Generate notification message based on event type
 */
function generateNotificationMessage(
  event: NotificationEvent,
  context: NotificationContext
): { subject: string; body: string } {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  switch (event) {
    case 'ipo_locked':
      return {
        subject: `IPO Locked: ${context.companyName}`,
        body: `<b>IPO Locked</b>\n\nCompany: ${context.companyName}\nIPO ID: ${context.ipoId}\nLocked by: ${context.adminName}\nReason: ${context.note || 'Not specified'}\nTime: ${timestamp}\n\nAll scraper updates are now blocked for this IPO.`,
      };

    case 'ipo_unlocked':
      return {
        subject: `IPO Unlocked: ${context.companyName}`,
        body: `<b>IPO Unlocked</b>\n\nCompany: ${context.companyName}\nIPO ID: ${context.ipoId}\nUnlocked by: ${context.adminName}\nTime: ${timestamp}\n\nScraper updates are now allowed for this IPO.`,
      };

    case 'field_protection_enabled':
      return {
        subject: `Field Protection Enabled: ${context.fieldName}`,
        body: `<b>Field Protection Enabled</b>\n\nIPO: ${context.companyName}\nTable: ${context.tableName}\nField: ${context.fieldName}\nEnabled by: ${context.adminName}\nNote: ${context.note || 'Not specified'}\nTime: ${timestamp}\n\nThis field is now protected from scraper updates.`,
      };

    case 'field_protection_disabled':
      return {
        subject: `Field Protection Disabled: ${context.fieldName}`,
        body: `<b>Field Protection Disabled</b>\n\nIPO: ${context.companyName}\nTable: ${context.tableName}\nField: ${context.fieldName}\nDisabled by: ${context.adminName}\nTime: ${timestamp}\n\nThis field can now be updated by scrapers.`,
      };

    case 'scraper_update_blocked':
      return {
        subject: `Scraper Update Blocked: ${context.scraperName}`,
        body: `<b>Scraper Update Blocked</b>\n\nIPO: ${context.companyName}\nScraper: ${context.scraperName}\nTable: ${context.tableName}\nField: ${context.fieldName || 'All fields'}\nTime: ${timestamp}\n\nDetails: ${context.details || 'Field is protected or IPO is locked'}`,
      };

    case 'bulk_operation_completed':
      return {
        subject: `Bulk Operation Completed`,
        body: `<b>Bulk Operation Completed</b>\n\nOperation: ${context.details}\nRecords affected: ${context.count}\nExecuted by: ${context.adminName}\nTime: ${timestamp}`,
      };

    default:
      return {
        subject: 'Admin Notification',
        body: `Event: ${event}\nTime: ${timestamp}`,
      };
  }
}

/**
 * Test email configuration
 */
export async function testEmailNotification(
  toEmail: string
): Promise<{ success: boolean; error?: string }> {
  // Rate limit check
  const key = 'email-test';
  const lastTest = testRateLimiter.get(key);
  if (lastTest && Date.now() - lastTest < TEST_RATE_LIMIT_MS) {
    return {
      success: false,
      error: 'Rate limit exceeded. Please wait 1 minute before testing again.',
    };
  }

  const result = await sendEmail(
    toEmail,
    'IPODhan Admin - Test Email',
    'This is a test email from IPODhan admin panel notification system.\n\nIf you received this, your email configuration is working correctly!',
    '<h2>IPODhan Admin - Test Email</h2><p>This is a test email from IPODhan admin panel notification system.</p><p>If you received this, your email configuration is working correctly!</p>'
  );

  if (result.success) {
    testRateLimiter.set(key, Date.now());
  }

  return result;
}

/**
 * Test Telegram configuration
 */
export async function testTelegramNotification(): Promise<{
  success: boolean;
  error?: string;
}> {
  // Rate limit check
  const key = 'telegram-test';
  const lastTest = testRateLimiter.get(key);
  if (lastTest && Date.now() - lastTest < TEST_RATE_LIMIT_MS) {
    return {
      success: false,
      error: 'Rate limit exceeded. Please wait 1 minute before testing again.',
    };
  }

  const result = await sendTelegram(
    '<b>IPODhan Admin - Test Message</b>\n\nThis is a test message from IPODhan admin panel notification system.\n\nIf you received this, your Telegram configuration is working correctly!'
  );

  if (result.success) {
    testRateLimiter.set(key, Date.now());
  }

  return result;
}
