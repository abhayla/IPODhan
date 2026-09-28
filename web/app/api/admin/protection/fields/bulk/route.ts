/**
 * API Route: Bulk Field Protection Operations
 * POST /api/admin/protection/fields/bulk - Bulk update field protections
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { unprotectGoneResponse, saveAdminFieldValue } from '@/lib/admin/admin-field-save';
import { getDb } from '@/lib/db';
import { sendNotification } from '@/lib/services/notification-service';
import { invalidateProtectionCacheForIpo } from '@/lib/admin/field-protection-checker';
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

    // §9.2 item 11 (OD-121): an admin hold is never released here; a delete is an admin-empty save
    // through the field editor. Protecting (isProtected: true) still works.
    if (!isProtected) return unprotectGoneResponse();

    // OD-121: each hold is an admin PICK of the shown value through the ONE write, with the token
    // that field was opened with (`versions[fieldName]`); a missing token or an empty field refuses
    // that field. Nothing sets a bare protection row any more.
    const versions: Record<string, unknown> = body.versions && typeof body.versions === 'object' ? body.versions : {};
    const refused: Array<{ fieldName: string; kind: string; reason: string }> = [];
    let updatedCount = 0;
    for (const fieldName of fieldNames as string[]) {
      const token = versions[fieldName];
      const hold = await saveAdminFieldValue({
        ipoId,
        tableName,
        fieldName,
        mode: { kind: 'holdShown' },
        expectedVersion: typeof token === 'string' ? token : '',
        actor: { name: adminContext.adminName, adminId: adminContext.adminId },
        entryPoint: 'api/admin/protection/fields/bulk',
      });
      if (hold.kind === 'OK') updatedCount++;
      else refused.push({ fieldName, kind: hold.kind, reason: hold.kind === 'CONFLICT' ? 'the field changed after the editor opened' : hold.reason });
    }
    const db = await getDb();

    // Belt-and-braces: the repository invalidates each field's cache key on
    // write, but a bulk toggle can affect (ipoId, table, field) triples the
    // route never enumerates individually — clear the whole IPO's protection
    // cache (field-level + IPO lock) so no stale entry survives (W-58).
    await invalidateProtectionCacheForIpo(ipoId);

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
        refused,
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
