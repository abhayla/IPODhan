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
 * Authentication: Admin-only (add authentication middleware as needed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConflictResolutionService } from '@/lib/services/conflict-resolution';

/**
 * GET /api/admin/conflicts
 * Fetch unresolved conflicts with optional filters
 */
export async function GET(request: NextRequest) {
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
    console.error('Conflicts API Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch conflicts',
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/conflicts
 * Resolve a single conflict
 *
 * Body:
 * {
 *   conflictId: string,
 *   resolvedSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | etc.,
 *   resolutionReason: string,
 *   resolvedBy: string,
 *   adminNote?: string,
 *   applyToDatabase: boolean,
 *   protectField?: boolean
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.conflictId || !body.resolvedSource || !body.resolutionReason || !body.resolvedBy) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: conflictId, resolvedSource, resolutionReason, resolvedBy',
      }, { status: 400 });
    }

    const service = new ConflictResolutionService();

    const result = await service.resolveConflict(body.conflictId, {
      resolvedSource: body.resolvedSource,
      resolutionReason: body.resolutionReason,
      resolvedBy: body.resolvedBy,
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
    console.error('Conflict Resolution Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve conflict',
    }, { status: 500 });
  }
}
