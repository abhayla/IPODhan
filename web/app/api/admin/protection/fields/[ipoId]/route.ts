/**
 * API Route: Field Protection Management
 * GET /api/admin/protection/fields/[ipoId] - Get all field protections for IPO
 * POST /api/admin/protection/fields/[ipoId] - Create/update field protection
 * DELETE /api/admin/protection/fields/[ipoId] - Delete field protection
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, getAdminIdentity } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { FieldProtectionRepository } from '@/lib/repositories/field-protection-repository';
import { sendNotification } from '@/lib/services/notification-service';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

interface RouteParams {
  params: Promise<{ ipoId: string }>;
}

/**
 * GET /api/admin/protection/fields/[ipoId]
 * Get all field protections for an IPO
 */
export const GET = withAdminAuth(async (request: NextRequest, adminContext, { params }: RouteParams) => {
  try {
    const { ipoId } = await params;
    const { searchParams } = new URL(request.url);
    const tableName = searchParams.get('tableName');

    const db = await getDb();
    const redis = getRedisClient();
    const repository = new FieldProtectionRepository(db, redis);

    let protections;
    if (tableName) {
      // Get protections for specific table
      protections = await repository.findByTable(ipoId, tableName);
    } else {
      // Get all protections for IPO
      protections = await repository.findByIPOId(ipoId);
    }

    // Group by table for easier consumption
    const groupedByTable = protections.reduce((acc, protection) => {
      if (!acc[protection.tableName]) {
        acc[protection.tableName] = [];
      }
      acc[protection.tableName].push(protection);
      return acc;
    }, {} as Record<string, any[]>);

    return NextResponse.json({
      success: true,
      data: {
        ipoId,
        tableName,
        protections,
        groupedByTable,
        totalProtected: protections.filter((p) => p.isProtected).length,
        totalFields: protections.length,
      },
    });
  } catch (error) {
    console.error('[Admin API] Failed to get field protections:', error);
    return NextResponse.json(
      { error: 'Failed to get field protections' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/admin/protection/fields/[ipoId]
 * Create or update field protection
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext, { params }: RouteParams) => {
  try {
    const { ipoId } = await params;
    const body = await request.json();
    const { tableName, fieldName, isProtected, autoProtected, editNote } = body;

    // Validation
    if (!tableName || !fieldName) {
      return NextResponse.json(
        { error: 'tableName and fieldName are required' },
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

    // Upsert protection record
    const protection = await repository.upsert({
      ipoId,
      tableName,
      fieldName,
      isProtected,
      autoProtected: autoProtected ?? false,
      manuallyEditedBy: adminContext.adminName,
      editNote,
    });

    console.log(
      `[Admin API] Field protection ${isProtected ? 'enabled' : 'disabled'} for ${tableName}.${fieldName} by ${adminContext.adminName}`
    );

    // Get company name for notification
    const ipoResult = await db
      .select({ companyName: ipos.companyName })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);

    // Send notification (async, non-blocking)
    if (ipoResult.length > 0) {
      sendNotification(
        isProtected ? 'field_protection_enabled' : 'field_protection_disabled',
        {
          ipoId,
          companyName: ipoResult[0].companyName,
          tableName,
          fieldName,
          adminName: adminContext.adminName,
          note: editNote || undefined,
        }
      ).catch((error) => {
        console.error('[Admin API] Failed to send notification:', error);
      });
    }

    return NextResponse.json({
      success: true,
      data: protection,
      message: `Field protection ${isProtected ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    console.error('[Admin API] Failed to update field protection:', error);
    return NextResponse.json(
      { error: 'Failed to update field protection' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/admin/protection/fields/[ipoId]
 * Delete field protection record
 */
export const DELETE = withAdminAuth(async (request: NextRequest, adminContext, { params }: RouteParams) => {
  try {
    const { ipoId } = await params;
    const { searchParams } = new URL(request.url);
    const tableName = searchParams.get('tableName');
    const fieldName = searchParams.get('fieldName');

    if (!tableName || !fieldName) {
      return NextResponse.json(
        { error: 'tableName and fieldName are required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const redis = getRedisClient();
    const repository = new FieldProtectionRepository(db, redis);

    const deleted = await repository.delete(ipoId, tableName, fieldName);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Field protection not found' },
        { status: 404 }
      );
    }

    console.log(
      `[Admin API] Field protection deleted for ${tableName}.${fieldName} by ${adminContext.adminName}`
    );

    return NextResponse.json({
      success: true,
      message: 'Field protection deleted successfully',
    });
  } catch (error) {
    console.error('[Admin API] Failed to delete field protection:', error);
    return NextResponse.json(
      { error: 'Failed to delete field protection' },
      { status: 500 }
    );
  }
});
