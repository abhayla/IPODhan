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
import { invalidateProtectionCache } from '@/lib/admin/field-protection-checker';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import { unprotectGoneResponse, saveAdminFieldValue, adminWriteResponse } from '@/lib/admin/admin-field-save';

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
    const { tableName, fieldName, isProtected, editNote, expectedVersion, recordId } = body;

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

    // §9.2 item 11 (OD-121): an admin hold is never released here; a delete is an admin-empty save
    // through the field editor.
    if (!isProtected) return unprotectGoneResponse();

    // OD-121: a hold is always an admin value. "Protect" is an admin PICK of the value the editor
    // showed (from the source that supplied it) through the ONE write — value, ADMIN provenance,
    // hold, audit row with the admin id, version check — never a bare protection row. The version
    // token proves it is still the value the admin saw; a field showing nothing is refused (400).
    const hold = await saveAdminFieldValue({
      ipoId,
      tableName,
      row: typeof recordId === 'string' && recordId ? { recordId } : undefined,
      fieldName,
      mode: { kind: 'holdShown' },
      expectedVersion: typeof expectedVersion === 'string' ? expectedVersion : '',
      actor: { name: adminContext.adminName, adminId: adminContext.adminId },
      entryPoint: 'api/admin/protection/fields/[ipoId]',
      detail: editNote ? { note: editNote } : undefined,
      ipAddress: request.headers.get('x-forwarded-for'),
      userAgent: request.headers.get('user-agent'),
    });
    if (hold.kind !== 'OK') return adminWriteResponse(hold);
    const db = await getDb();
    await invalidateProtectionCache(ipoId, tableName, fieldName);

    console.log(`[Admin API] Field held (picked as shown) ${tableName}.${fieldName} by ${adminContext.adminName}`);

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
      data: { ipoId, tableName, fieldName, rowKey: hold.rowKey, value: hold.newValue, version: hold.version },
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
 * Gone (410): deleting a protection record released an admin hold, which §9.2 item 11 (OD-121)
 * forbids. To remove a value, save the field empty through the field editor.
 */
export const DELETE = withAdminAuth(async () => unprotectGoneResponse());
