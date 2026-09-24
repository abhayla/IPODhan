/**
 * Data Conflicts API
 * Admin endpoints for viewing and resolving data conflicts
 *
 * Endpoints:
 * - GET    /api/admin/conflicts - List unresolved conflicts
 * - POST   /api/admin/conflicts - Resolve a conflict
 *
 * Query Parameters (GET):
 * - severity: Filter by severity (INFO, WARNING, CRITICAL)
 * - limit: Max number of conflicts to return
 * - ipoId: Filter by specific IPO
 *
 * Authentication: Admin-only (withAdminAuth)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConflictResolutionService } from '@/lib/services/conflict-resolution';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { withAdminAuth } from '@/lib/middleware/admin-auth';

/**
 * GET /api/admin/conflicts
 * Fetch unresolved conflicts with optional filters
 */
export const GET = withAdminAuth(async (request: NextRequest, _adminContext) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const severity = searchParams.get('severity') as 'INFO' | 'WARNING' | 'CRITICAL' | null;
    const limit = searchParams.get('limit');
    const ipoId = searchParams.get('ipoId');

    const service = new ConflictResolutionService();

    let conflicts;

    if (ipoId) {
      // Get conflicts for specific IPO
      conflicts = await service.getConflictsForIPO(ipoId);
    } else {
      // Get all unresolved conflicts with filters
      conflicts = await service.getUnresolvedConflicts({
        severity: severity || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
    }

    return NextResponse.json({
      success: true,
      count: conflicts.length,
      conflicts,
    }, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/conflicts');
  }
});

/**
 * POST /api/admin/conflicts
 * Resolve a single conflict
 *
 * Body:
 * {
 *   conflictId: string,
 *   resolvedSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | etc.,
 *   resolutionReason: string,
 *   adminNote?: string,
 *   applyToDatabase: boolean,
 *   protectField?: boolean
 * }
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext) => {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.conflictId || !body.resolvedSource || !body.resolutionReason) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: conflictId, resolvedSource, resolutionReason',
      }, { status: 400 });
    }

    const service = new ConflictResolutionService();

    const result = await service.resolveConflict(body.conflictId, {
      resolvedSource: body.resolvedSource,
      resolutionReason: body.resolutionReason,
      // The actor is the authenticated admin, never a client-supplied name.
      resolvedBy: adminContext.adminName,
      adminNote: body.adminNote,
      applyToDatabase: body.applyToDatabase ?? true,
      protectField: body.protectField ?? false,
    });

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to resolve conflict',
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      result,
      message: 'Conflict resolved successfully',
    }, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/conflicts');
  }
});
