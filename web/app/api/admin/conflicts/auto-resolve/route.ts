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
 * Authentication: Admin-only (withAdminAuth)
 *
 * Safety:
 * - Only auto-resolves conflicts where one source is ADMIN
 * - Other conflicts require manual review
 * - Use dryRun=true to preview what would be resolved
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConflictResolutionService } from '@/lib/services/conflict-resolution';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { auditAdminWrite } from '@/lib/admin/admin-write-audit';
import { AuditActionTypes } from '@/lib/services/audit-log-service';
import { getRedisClient } from '@/lib/cache/redis-client';
import { adminQueueCacheKeys } from '@/lib/cache/cache-keys';

/** See app/api/admin/conflicts/route.ts's dropQueueCache: a resolve with no field value applied
 * never drops the admin queue cache on its own (item 2, A4 review). Best-effort. */
async function dropQueueCache(): Promise<void> {
  try {
    await getRedisClient().del(...adminQueueCacheKeys());
  } catch (error) {
    console.warn('[Conflicts] failed to drop the admin queue cache after an auto-resolve:', error);
  }
}

/**
 * POST /api/admin/conflicts/auto-resolve
 * Auto-resolve obvious conflicts
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext) => {
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

    // A bulk, system-style action: the admin who TRIGGERED it is recorded (name + account id).
    // A dry run changes nothing and writes no row.
    if (!dryRun) {
      await auditAdminWrite(adminContext, request, {
        actionType: AuditActionTypes.CONFLICT_RESOLVED,
        action: 'CONFLICTS_AUTO_RESOLVED',
        entryPoint: 'api/admin/conflicts/auto-resolve POST',
        details: { resolved: result.resolved, skipped: result.skipped, maxConflicts: maxConflicts ?? null },
      });
    }
    if (!dryRun && result.resolved > 0) await dropQueueCache();

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
    return apiErrorResponse(error, '/api/admin/conflicts/auto-resolve');
  }
});
