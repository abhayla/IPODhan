/**
 * API Route: Test Notification Configuration
 * POST /api/admin/notifications/test - Send test notifications
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import {
  testEmailNotification,
  testTelegramNotification,
} from '@/lib/services/notification-service';

/**
 * POST /api/admin/notifications/test
 * Send test email and/or Telegram notification
 *
 * Body: { type: 'email' | 'telegram' | 'both', email?: string }
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { type, email } = body;

    if (!type || !['email', 'telegram', 'both'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid test type. Must be "email", "telegram", or "both"' },
        { status: 400 }
      );
    }

    const results: {
      email?: { success: boolean; error?: string };
      telegram?: { success: boolean; error?: string };
    } = {};

    // Test email
    if (type === 'email' || type === 'both') {
      if (!email) {
        return NextResponse.json(
          { error: 'Email address is required for email test' },
          { status: 400 }
        );
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return NextResponse.json({ error: 'Invalid email address format' }, { status: 400 });
      }

      results.email = await testEmailNotification(email);
    }

    // Test Telegram
    if (type === 'telegram' || type === 'both') {
      results.telegram = await testTelegramNotification();
    }

    // Check if any test failed
    const emailFailed = results.email && !results.email.success;
    const telegramFailed = results.telegram && !results.telegram.success;

    if (emailFailed || telegramFailed) {
      return NextResponse.json(
        {
          success: false,
          message: 'One or more tests failed',
          results,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Test notification(s) sent successfully',
      results,
    });
  } catch (error) {
    console.error('[Admin API] Failed to send test notification:', error);
    return NextResponse.json(
      { error: 'Failed to send test notification' },
      { status: 500 }
    );
  }
});
