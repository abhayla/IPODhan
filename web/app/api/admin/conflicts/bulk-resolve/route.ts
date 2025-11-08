/**
 * Bulk Conflict Resolution API
 * POST /api/admin/conflicts/bulk-resolve
 *
 * Resolves multiple conflicts with the same source choice
 * Use case: Admin selects 10 conflicts, chooses "DRHP wins all", bulk resolves
 *
 * Body:
 * {
 *   conflictIds: string[],
 *   resolvedSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | etc.,
 *   resolutionReason: string,
 *   resolvedBy: string,
 *   applyToDatabase: boolean,
 *   protectField?: boolean
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   successful: number,
 *   failed: number,
 *   results: Array<ResolutionResult>
 * }
 *
 * Authentication: Admin-only (add authentication middleware as needed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConflictResolutionService } from '@/lib/services/conflict-resolution';

/**
 * POST /api/admin/conflicts/bulk-resolve
 * Resolve multiple conflicts with same source choice
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.conflictIds || !Array.isArray(body.conflictIds) || body.conflictIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'conflictIds array is required and must not be empty',
      }, { status: 400 });
    }

    if (!body.resolvedSource || !body.resolutionReason || !body.resolvedBy) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: resolvedSource, resolutionReason, resolvedBy',
      }, { status: 400 });
    }

    // Limit bulk operations to prevent timeouts
    if (body.conflictIds.length > 100) {
      return NextResponse.json({
        success: false,
        error: 'Bulk resolution limited to 100 conflicts at a time',
      }, { status: 400 });
    }

    const service = new ConflictResolutionService();

    const result = await service.bulkResolve(body.conflictIds, {
      resolvedSource: body.resolvedSource,
      resolutionReason: body.resolutionReason,
      resolvedBy: body.resolvedBy,
      applyToDatabase: body.applyToDatabase ?? true,
      protectField: body.protectField ?? false,
    });

    return NextResponse.json({
      success: result.successful > 0,
      successful: result.successful,
      failed: result.failed,
      results: result.results,
      message: `Resolved ${result.successful} of ${body.conflictIds.length} conflicts`,
    }, { status: 200 });
  } catch (error) {
    console.error('Bulk Conflict Resolution Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to bulk resolve conflicts',
    }, { status: 500 });
  }
}
