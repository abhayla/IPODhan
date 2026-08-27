/**
 * Conflict Statistics API
 * GET /api/admin/conflicts/stats
 *
 * Query Parameters:
 * - ipoId: Optional IPO ID to get stats for specific IPO
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConflictResolutionService } from '@/lib/services/conflict-resolution';
import { apiErrorResponse } from '@/lib/errors/api-error-response';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ipoId = searchParams.get('ipoId');

    const service = new ConflictResolutionService();

    const [stats, problematicFields] = await Promise.all([
      service.getConflictStats(ipoId || undefined),
      service.getProblematicFields(10),
    ]);

    return NextResponse.json({
      success: true,
      stats,
      problematicFields,
    }, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/conflicts/stats');
  }
}
