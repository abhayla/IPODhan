/**
 * API Route: Blocked Update Notifications
 * GET /api/admin/protection/notifications - Get recent blocked scraper updates
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getBlockedUpdateNotifications } from '@/lib/admin/field-protection-checker';

/**
 * GET /api/admin/protection/notifications
 * Get recent blocked scraper update notifications
 */
export const GET = withAdminAuth(async (request: NextRequest, adminContext) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Get notifications from Redis
    const notifications = await getBlockedUpdateNotifications(limit);

    // Group by IPO for easier consumption
    const groupedByIPO = notifications.reduce((acc, notification) => {
      if (!acc[notification.ipoId]) {
        acc[notification.ipoId] = [];
      }
      acc[notification.ipoId].push(notification);
      return acc;
    }, {} as Record<string, any[]>);

    // Count by reason
    const countByReason = notifications.reduce((acc, notification) => {
      acc[notification.reason] = (acc[notification.reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Count by scraper
    const countByScraper = notifications.reduce((acc, notification) => {
      acc[notification.scraperName] = (acc[notification.scraperName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      success: true,
      data: {
        notifications,
        groupedByIPO,
        stats: {
          total: notifications.length,
          byReason: countByReason,
          byScraper: countByScraper,
        },
      },
    });
  } catch (error) {
    console.error('[Admin API] Failed to get blocked notifications:', error);
    return NextResponse.json(
      { error: 'Failed to get blocked notifications' },
      { status: 500 }
    );
  }
});
