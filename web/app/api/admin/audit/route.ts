/**
 * API Route: Admin Audit Logs
 * GET /api/admin/audit
 *
 * Retrieves audit logs with filtering and pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import {
  getAuditLogs,
  getAdminUsers,
  getActionTypes,
} from '@/lib/services/audit-log-service';

/**
 * GET /api/admin/audit
 * Query parameters:
 * - startDate: ISO date string
 * - endDate: ISO date string
 * - adminUser: Admin username
 * - actionType: Action type
 * - ipoId: IPO ID
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 200)
 */
export const GET = withAdminAuth(async (request: NextRequest, adminContext) => {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    const adminUser = searchParams.get('adminUser') || undefined;
    const actionType = searchParams.get('actionType') || undefined;
    const ipoId = searchParams.get('ipoId') || undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50', 10),
      200
    ); // Max 200 per page

    // Parse dates
    const startDate = startDateStr ? new Date(startDateStr) : undefined;
    const endDate = endDateStr ? new Date(endDateStr) : undefined;

    // Validate dates
    if (startDate && isNaN(startDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid startDate format' },
        { status: 400 }
      );
    }

    if (endDate && isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid endDate format' },
        { status: 400 }
      );
    }

    // Get audit logs
    const result = await getAuditLogs({
      startDate,
      endDate,
      adminUser,
      actionType,
      ipoId,
      page,
      limit,
    });

    // Get filter options (for dropdowns)
    const [adminUsers, actionTypes] = await Promise.all([
      getAdminUsers(),
      getActionTypes(),
    ]);

    return NextResponse.json({
      success: true,
      data: result.logs,
      pagination: result.pagination,
      filters: {
        adminUsers,
        actionTypes,
      },
    });
  } catch (error) {
    console.error('[Admin API] Failed to retrieve audit logs:', error);
    return NextResponse.json(
      {
        error: 'Failed to retrieve audit logs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
});
