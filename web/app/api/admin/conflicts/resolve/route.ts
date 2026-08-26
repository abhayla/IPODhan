/**
 * API Route: Resolve Field Protection Conflicts
 * POST /api/admin/conflicts/resolve
 *
 * Resolves conflicts by either keeping manual data (protected) or accepting scraper data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  ipos,
  fieldProtectionMetadata,
  financialData,
  listingPerformance,
  subscriptions,
  gmpRecords
} from '@ipodhan/shared/db/schema';
import { eq, and } from 'drizzle-orm';
import { invalidateProtectionCache } from '@/lib/admin/field-protection-checker';
import { logAudit, AuditActionTypes, getClientIP, getUserAgent } from '@/lib/services/audit-log-service';
import { apiErrorResponse } from '@/lib/errors/api-error-response';

interface ResolveConflictRequest {
  conflicts: Array<{
    ipoId: string;
    tableName: string;
    fieldName: string;
    resolution: 'keep_manual' | 'accept_scraper' | 'unprotect';
    scraperValue?: any; // Value to apply if accepting scraper data
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

    const db = await getDb();
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

          // Update the field with scraper value
          await updateFieldValue(db, ipoId, tableName, fieldName, scraperValue);

          // Remove field protection
          await db
            .delete(fieldProtectionMetadata)
            .where(
              and(
                eq(fieldProtectionMetadata.ipoId, ipoId),
                eq(fieldProtectionMetadata.tableName, tableName),
                eq(fieldProtectionMetadata.fieldName, fieldName)
              )
            );

          // Invalidate cache
          await invalidateProtectionCache(ipoId, tableName, fieldName);

          // Log audit
          await logAudit({
            adminUser: adminContext.adminName,
            actionType: AuditActionTypes.CONFLICT_RESOLVED,
            ipoId,
            tableName,
            fieldName,
            newValue: scraperValue,
            details: {
              resolution: 'accept_scraper',
              reason: 'Admin accepted scraper data over manual value',
            },
            ipAddress: getClientIP(request),
            userAgent: getUserAgent(request),
            success: true,
          });

          response.resolved++;

        } else if (resolution === 'unprotect') {
          // Remove protection but keep current value
          await db
            .delete(fieldProtectionMetadata)
            .where(
              and(
                eq(fieldProtectionMetadata.ipoId, ipoId),
                eq(fieldProtectionMetadata.tableName, tableName),
                eq(fieldProtectionMetadata.fieldName, fieldName)
              )
            );

          // Invalidate cache
          await invalidateProtectionCache(ipoId, tableName, fieldName);

          // Log audit
          await logAudit({
            adminUser: adminContext.adminName,
            actionType: AuditActionTypes.PROTECTION_REMOVED,
            ipoId,
            tableName,
            fieldName,
            details: {
              reason: 'Unprotected field to allow future scraper updates',
            },
            ipAddress: getClientIP(request),
            userAgent: getUserAgent(request),
            success: true,
          });

          response.resolved++;

        } else {
          response.failed.push({
            ipoId,
            tableName,
            fieldName,
            error: `Invalid resolution: ${resolution}`,
          });
        }

      } catch (error) {
        response.failed.push({
          ipoId: conflict.ipoId,
          tableName: conflict.tableName,
          fieldName: conflict.fieldName,
          error: error instanceof Error ? error.message : 'Unknown error',
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

/**
 * Helper function to update field value in database
 */
async function updateFieldValue(
  db: any,
  ipoId: string,
  tableName: string,
  fieldName: string,
  value: any
): Promise<void> {
  // Handle different table types
  if (tableName === 'ipos') {
    await db
      .update(ipos)
      .set({ [fieldName]: value })
      .where(eq(ipos.id, ipoId));
    return;
  }

  if (tableName === 'financial_data') {
    await db
      .update(financialData)
      .set({ [fieldName]: value })
      .where(eq(financialData.ipoId, ipoId));
    return;
  }

  if (tableName === 'listing_performance') {
    await db
      .update(listingPerformance)
      .set({ [fieldName]: value })
      .where(eq(listingPerformance.ipoId, ipoId));
    return;
  }

  // Note: For time-series tables, this updates ALL records
  // In practice, you might want to update only the latest
  if (tableName === 'subscriptions') {
    await db
      .update(subscriptions)
      .set({ [fieldName]: value })
      .where(eq(subscriptions.ipoId, ipoId));
    return;
  }

  if (tableName === 'gmp_records') {
    await db
      .update(gmpRecords)
      .set({ [fieldName]: value })
      .where(eq(gmpRecords.ipoId, ipoId));
    return;
  }

  throw new Error(`Unsupported table for field update: ${tableName}`);
}