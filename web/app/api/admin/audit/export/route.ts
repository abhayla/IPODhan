/**
 * API Route: Export Audit Logs
 * GET /api/admin/audit/export
 *
 * Exports audit logs as CSV file
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { exportAuditLogsCSV } from '@/lib/services/audit-log-service';
import { apiErrorResponse } from '@/lib/errors/api-error-response';

/**
 * GET /api/admin/audit/export
 * Query parameters: Same as GET /api/admin/audit (except page/limit)
 * Returns: CSV file download
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    const adminUser = searchParams.get('adminUser') || undefined;
    const actionType = searchParams.get('actionType') || undefined;
    const ipoId = searchParams.get('ipoId') || undefined;

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

    // Export audit logs as CSV
    const csv = await exportAuditLogsCSV({
      startDate,
      endDate,
      adminUser,
      actionType,
      ipoId,
    });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `audit-logs-${timestamp}.csv`;

    // Return CSV file
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/audit/export');
  }
});
