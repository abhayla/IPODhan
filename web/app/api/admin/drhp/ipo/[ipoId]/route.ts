/**
 * API Endpoint: Get Extraction Logs for Specific IPO
 *
 * GET /api/admin/drhp/ipo/[ipoId]
 * Returns all DRHP extraction logs for a specific IPO, sorted by creation date (newest first)
 *
 * Part of Phase 6: Admin Enhancement - Week 3 Final Integration
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractionLogs } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { apiErrorResponse } from '@/lib/errors/api-error-response';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ipoId: string }> }
) {
  try {
    const { ipoId } = await params;

    if (!ipoId) {
      return NextResponse.json(
        { error: 'IPO ID is required' },
        { status: 400 }
      );
    }

    // Fetch all extraction logs for this IPO
    const logs = await db
      .select()
      .from(extractionLogs)
      .where(eq(extractionLogs.ipoId, ipoId))
      .orderBy(desc(extractionLogs.createdAt));

    // Get the latest successful extraction
    const latestSuccess = logs.find(
      (log) => log.status === 'SUCCESS' || log.status === 'PARTIAL'
    );

    return NextResponse.json({
      success: true,
      data: {
        logs,
        latest: latestSuccess || logs[0] || null,
        total: logs.length,
        successCount: logs.filter((log) => log.status === 'SUCCESS').length,
        partialCount: logs.filter((log) => log.status === 'PARTIAL').length,
        failedCount: logs.filter((log) => log.status === 'FAILED').length,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/drhp/ipo/[ipoId]');
  }
}
