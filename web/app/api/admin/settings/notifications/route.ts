/**
 * API Route: Notification Settings Management
 * GET /api/admin/settings/notifications - Get notification configuration (masked)
 * POST /api/admin/settings/notifications - Save notification configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import {
  getNotificationConfig,
  saveNotificationConfig,
  maskSensitiveData,
  type NotificationConfig,
} from '@/lib/services/notification-service';

/**
 * GET /api/admin/settings/notifications
 * Retrieve current notification configuration with masked sensitive data
 */
export const GET = withAdminAuth(async () => {
  try {
    const config = await getNotificationConfig();

    // Mask sensitive data before returning
    const maskedConfig = {
      ...config,
      email: {
        ...config.email,
        smtpPassword: config.email.smtpPassword
          ? maskSensitiveData(config.email.smtpPassword)
          : '',
      },
      telegram: {
        ...config.telegram,
        botToken: config.telegram.botToken ? maskSensitiveData(config.telegram.botToken) : '',
      },
    };

    return NextResponse.json({
      success: true,
      data: maskedConfig,
    });
  } catch (error) {
    console.error('[Admin API] Failed to get notification settings:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve notification settings' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/admin/settings/notifications
 * Save notification configuration
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();

    // Validate config structure
    if (!body.email || !body.telegram || !body.triggers) {
      return NextResponse.json(
        { error: 'Invalid notification configuration structure' },
        { status: 400 }
      );
    }

    // Validate email config
    if (body.email.enabled) {
      if (!body.email.smtpHost || !body.email.smtpPort) {
        return NextResponse.json(
          { error: 'SMTP host and port are required when email is enabled' },
          { status: 400 }
        );
      }

      if (!body.email.fromEmail || !body.email.smtpUser) {
        return NextResponse.json(
          { error: 'From email and SMTP user are required when email is enabled' },
          { status: 400 }
        );
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(body.email.fromEmail)) {
        return NextResponse.json({ error: 'Invalid from email address' }, { status: 400 });
      }
    }

    // Validate Telegram config
    if (body.telegram.enabled) {
      if (!body.telegram.botToken || !body.telegram.chatId) {
        return NextResponse.json(
          { error: 'Bot token and chat ID are required when Telegram is enabled' },
          { status: 400 }
        );
      }

      // Basic token format validation
      if (!body.telegram.botToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
        return NextResponse.json({ error: 'Invalid Telegram bot token format' }, { status: 400 });
      }
    }

    // Validate port is a number
    if (typeof body.email.smtpPort !== 'number') {
      return NextResponse.json({ error: 'SMTP port must be a number' }, { status: 400 });
    }

    const config: NotificationConfig = body;

    // Handle password field: if masked, retrieve existing password
    if (config.email.smtpPassword && config.email.smtpPassword.includes('*')) {
      const existingConfig = await getNotificationConfig();
      config.email.smtpPassword = existingConfig.email.smtpPassword;
    }

    // Handle bot token: if masked, retrieve existing token
    if (config.telegram.botToken && config.telegram.botToken.includes('*')) {
      const existingConfig = await getNotificationConfig();
      config.telegram.botToken = existingConfig.telegram.botToken;
    }

    // Save configuration (will encrypt sensitive fields)
    await saveNotificationConfig(config);

    return NextResponse.json({
      success: true,
      message: 'Notification settings saved successfully',
    });
  } catch (error) {
    console.error('[Admin API] Failed to save notification settings:', error);
    return NextResponse.json(
      { error: 'Failed to save notification settings' },
      { status: 500 }
    );
  }
});
