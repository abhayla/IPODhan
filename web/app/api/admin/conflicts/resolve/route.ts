/**
 * API Route: Resolve Field Protection Conflicts
 * POST /api/admin/conflicts/resolve
 *
 * Resolves conflicts by either keeping manual data (protected) or accepting scraper data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getRedisClient } from '@/lib/cache/redis-client';
import { STALE_EDITOR_REASON } from '@ipodhan/shared/services/admin-field-write';
import { saveAdminFieldValue, adminWriteResponse, unprotectGoneResponse, UNPROTECT_GONE_MESSAGE } from '@/lib/admin/admin-field-save';
import { logAudit, AuditActionTypes, getClientIP, getUserAgent } from '@/lib/services/audit-log-service';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { logger } from '@/lib/logger';

interface ResolveConflictRequest {
  conflicts: Array<{
    ipoId: string;
    tableName: string;
    fieldName: string;
    resolution: 'keep_manual' | 'accept_scraper' | 'unprotect';
    scraperValue?: any; // Value to apply if accepting scraper data
    scraperSource?: string; // The source label of the accepted value (provenance)
    expectedVersion?: string; // §9.2 item 20: version token when the row was opened
  }>;
}

interface ResolveConflictResponse {
  success: boolean;
  resolved: number;
  failed: Array<{
    ipoId: string;
    tableName: string;
    fieldName: string;
    error: string;
  }>;
}

/**
 * POST /api/admin/conflicts/resolve
 * Resolve field protection conflicts
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext) => {
  try {
    const body: ResolveConflictRequest = await request.json();

    if (!body.conflicts || !Array.isArray(body.conflicts)) {
      return NextResponse.json(
        { error: 'conflicts array is required' },
        { status: 400 }
      );
    }

    const redis = getRedisClient();

    const response: ResolveConflictResponse = {
      success: false,
      resolved: 0,
      failed: [],
    };

    // Process each conflict resolution
    for (const conflict of body.conflicts) {
      try {
        const { ipoId, tableName, fieldName, resolution, scraperValue } = conflict;

        if (resolution === 'keep_manual') {
          // Keep the manual value - already protected, just log the resolution
          await logAudit({
            adminUser: adminContext.adminName,
            actionType: AuditActionTypes.CONFLICT_RESOLVED,
            ipoId,
            tableName,
            fieldName,
            details: {
              resolution: 'keep_manual',
              reason: 'Admin chose to keep manually edited value',
            },
            ipAddress: getClientIP(request),
            userAgent: getUserAgent(request),
            success: true,
          });

          response.resolved++;

        } else if (resolution === 'accept_scraper') {
          // Accept scraper value - update field and remove protection
          if (scraperValue === undefined) {
            response.failed.push({
              ipoId,
              tableName,
              fieldName,
              error: 'scraperValue is required when accepting scraper data',
            });
            continue;
          }

          // §9.2 items 3, 11 (OD-121): accepting the scraper's value is an admin PICK of it. It goes
          // through the ONE admin write (ADMIN provenance, protection kept, audit row, version
          // check, cache drop); there is no "return to the loop".
          // §9.2 item 20: the token comes from the client that opened the row; never read here.
          if (!conflict.expectedVersion) {
            if (body.conflicts.length === 1) return adminWriteResponse({ kind: 'INVALID', reason: STALE_EDITOR_REASON });
            response.failed.push({ ipoId, tableName, fieldName, error: STALE_EDITOR_REASON });
            continue;
          }
          const expectedVersion = conflict.expectedVersion;
          const write = await saveAdminFieldValue({
            ipoId,
            tableName,
            fieldName,
            value: scraperValue,
            mode: { kind: 'pick', sourceLabel: conflict.scraperSource ?? 'scraper', readDate: null },
            expectedVersion,
            actor: { name: adminContext.adminName, adminId: adminContext.adminId },
            entryPoint: 'api/admin/conflicts/resolve',
            ipAddress: getClientIP(request) ?? null,
            userAgent: getUserAgent(request) ?? null,
          });
          if (write.kind !== 'OK') {
            if (body.conflicts.length === 1) return adminWriteResponse(write);
            response.failed.push({ ipoId, tableName, fieldName, error: write.kind === 'CONFLICT' ? 'CONFLICT' : `${write.kind}: ${write.reason}` });
            continue;
          }

          response.resolved++;

        } else if (resolution === 'unprotect') {
          // §9.2 item 11 (OD-121): there is no "return to the loop". An admin hold is never
          // released; to remove a value, save it empty through the field editor.
          if (body.conflicts.length === 1) return unprotectGoneResponse();
          response.failed.push({ ipoId, tableName, fieldName, error: UNPROTECT_GONE_MESSAGE });
          continue;

        } else {
          response.failed.push({
            ipoId,
            tableName,
            fieldName,
            error: `Invalid resolution: ${resolution}`,
          });
        }

      } catch (error) {
        // Real error detail (can include SQL/constraint text) logged server-side
        // only - never in the public response body (T-330 P2-5).
        logger.error(
          {
            ipoId: conflict.ipoId,
            tableName: conflict.tableName,
            fieldName: conflict.fieldName,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to resolve conflict'
        );
        response.failed.push({
          ipoId: conflict.ipoId,
          tableName: conflict.tableName,
          fieldName: conflict.fieldName,
          error: 'Failed to resolve conflict',
        });
      }
    }

    // Clear blocked updates from Redis after resolution
    try {
      // This clears the notifications since conflicts are resolved
      await redis.del('protection:blocked_updates');
    } catch (error) {
      console.warn('[Conflicts] Failed to clear blocked updates from Redis:', error);
    }

    response.success = response.resolved > 0;

    return NextResponse.json(response);

  } catch (error) {
    return apiErrorResponse(error, '/api/admin/conflicts/resolve');
  }
});
