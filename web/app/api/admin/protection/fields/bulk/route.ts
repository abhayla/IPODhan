/**
 * API Route: Bulk Field Protection Operations
 * POST /api/admin/protection/fields/bulk - Bulk update field protections
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { FieldProtectionRepository } from '@/lib/repositories/field-protection-repository';
import { sendNotification } from '@/lib/services/notification-service';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/admin/protection/fields/bulk
 * Bulk update field protection status
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext) => {
  try {
    const body = await request.json();
    const { ipoId, tableName, fieldNames, isProtected } = body;

    // Validation
    if (!ipoId || !tableName || !Array.isArray(fieldNames) || fieldNames.length === 0) {
      return NextResponse.json(
        { error: 'ipoId, tableName, and fieldNames (array) are required' },
        { status: 400 }
      );
    }

    if (typeof isProtected !== 'boolean') {
      return NextResponse.json(
        { error: 'isProtected must be a boolean' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const redis = getRedisClient();
    const repository = new FieldProtectionRepository(db, redis);

    // Bulk update
    const updatedCount = await repository.bulkUpdateProtectionStatus(
      ipoId,
      tableName,
      fieldNames,
      isProtected
    );

    console.log(
      `[Admin API] Bulk ${isProtected ? 'protected' : 'unprotected'} ${updatedCount} fields in ${tableName} by ${adminContext.adminName}`
    );

    // Get company name for notification
    const ipoResult = await db
      .select({ companyName: ipos.companyName })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);

    // Send notification (async, non-blocking)
    if (ipoResult.length > 0) {
      sendNotification('bulk_operation_completed', {
        ipoId,
        companyName: ipoResult[0].companyName,
        adminName: adminContext.adminName,
        count: updatedCount,
        details: `Bulk ${isProtected ? 'protected' : 'unprotected'} ${updatedCount} fields in ${tableName}`,
      }).catch((error) => {
        console.error('[Admin API] Failed to send notification:', error);
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ipoId,
        tableName,
        fieldNames,
        isProtected,
        updatedCount,
      },
      message: `${updatedCount} fields ${isProtected ? 'protected' : 'unprotected'} successfully`,
    });
  } catch (error) {
    console.error('[Admin API] Failed to bulk update field protections:', error);
    return NextResponse.json(
      { error: 'Failed to bulk update field protections' },
      { status: 500 }
    );
  }
});
