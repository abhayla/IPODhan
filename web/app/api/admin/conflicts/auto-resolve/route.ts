/**
 * Auto Conflict Resolution API
 * POST /api/admin/conflicts/auto-resolve
 *
 * Automatically resolves obvious conflicts using priority matrix
 * Currently auto-resolves: ADMIN source always wins
 *
 * Body:
 * {
 *   maxConflicts?: number,  // Max conflicts to process (default: all)
 *   dryRun?: boolean        // Preview only, no changes (default: false)
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   resolved: number,
 *   skipped: number,
 *   details: Array<{
 *     conflictId: string,
 *     fieldName: string,
 *     chosenSource: string,
 *     reason: string
 *   }>
 * }
 *
 * Authentication: Admin-only (add authentication middleware as needed)
 *
 * Safety:
 * - Only auto-resolves conflicts where one source is ADMIN
 * - Other conflicts require manual review
 * - Use dryRun=true to preview what would be resolved
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConflictResolutionService } from '@/lib/services/conflict-resolution';

/**
 * POST /api/admin/conflicts/auto-resolve
 * Auto-resolve obvious conflicts
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Parse options with defaults
    const maxConflicts = body.maxConflicts ? parseInt(body.maxConflicts) : undefined;
    const dryRun = body.dryRun === true;

    // Validate maxConflicts if provided
    if (maxConflicts !== undefined && (isNaN(maxConflicts) || maxConflicts < 1)) {
      return NextResponse.json({
        success: false,
        error: 'maxConflicts must be a positive number',
      }, { status: 400 });
    }

    const service = new ConflictResolutionService();

    const result = await service.autoResolve({
      maxConflicts,
      dryRun,
    });

    // Add dry run message if applicable
    const message = dryRun
      ? `DRY RUN: Would resolve ${result.resolved} conflicts, skip ${result.skipped} (no changes made)`
      : `Auto-resolved ${result.resolved} conflicts, skipped ${result.skipped} requiring manual review`;

    return NextResponse.json({
      success: true,
      resolved: result.resolved,
      skipped: result.skipped,
      details: result.details,
      message,
      dryRun,
    }, { status: 200 });
  } catch (error) {
    console.error('Auto Conflict Resolution Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to auto-resolve conflicts',
    }, { status: 500 });
  }
}
