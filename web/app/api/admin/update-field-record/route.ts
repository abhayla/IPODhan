/**
 * API Route: Update Field Value for One-to-Many Records
 * PATCH /api/admin/update-field-record
 *
 * Updates a field value in one-to-many tables (documents, peer_companies, ipo_reviews)
 * and automatically protects it at the record level
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  documents,
  peerCompanies,
  ipoReviews,
  fieldProtectionMetadata
} from '@ipodhan/shared/db/schema';
import { eq, and } from 'drizzle-orm';
import { createFieldProtectionService } from '@ipodhan/shared/admin/field-protection-checker';
import { logAudit, AuditActionTypes, getClientIP, getUserAgent } from '@/lib/services/audit-log-service';

interface UpdateFieldRecordRequest {
  recordId: string;      // Specific record ID (document, peer, review)
  ipoId: string;         // IPO ID for context
  tableName: string;     // documents, peer_companies, ipo_reviews
  fieldName: string;
  value: any;
  autoProtect?: boolean;
  editNote?: string;
}

// Table name to Drizzle table mapping for one-to-many tables
const RECORD_TABLE_MAP: Record<string, any> = {
  documents,
  peer_companies: peerCompanies,
  ipo_reviews: ipoReviews,
};

// Fields that should not be editable
const NON_EDITABLE_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'ipo_id',
]);

/**
 * PATCH /api/admin/update-field-record
 * Update a field value in a specific record (one-to-many relationship)
 */
export const PATCH = withAdminAuth(async (request: NextRequest, adminContext) => {
  let oldValue: any = null;
  let body: UpdateFieldRecordRequest | null = null;

  try {
    body = await request.json();

    if (!body) {
      return NextResponse.json(
        { error: 'Request body is required' },
        { status: 400 }
      );
    }

    const { recordId, ipoId, tableName, fieldName, value, autoProtect = true, editNote } = body;

    // Validation
    if (!recordId || !ipoId || !tableName || !fieldName) {
      return NextResponse.json(
        { error: 'recordId, ipoId, tableName, and fieldName are required' },
        { status: 400 }
      );
    }

    // Check if table exists
    const table = RECORD_TABLE_MAP[tableName];
    if (!table) {
      return NextResponse.json(
        { error: `Unknown table: ${tableName}. Supported: ${Object.keys(RECORD_TABLE_MAP).join(', ')}` },
        { status: 400 }
      );
    }

    // Check if field is editable
    if (NON_EDITABLE_FIELDS.has(fieldName)) {
      return NextResponse.json(
        { error: `Field ${fieldName} is not editable` },
        { status: 400 }
      );
    }

    const db = await getDb();
    const redis = getRedisClient();

    // Get old value before update (for audit log)
    try {
      const existing = await db.select().from(table).where(eq(table.id, recordId)).limit(1);
      oldValue = existing[0]?.[fieldName as keyof typeof existing[0]];

      // Verify the record belongs to the specified IPO
      if (existing[0] && existing[0].ipoId !== ipoId) {
        return NextResponse.json(
          { error: 'Record does not belong to the specified IPO' },
          { status: 400 }
        );
      }
    } catch (err) {
      console.warn('[Audit] Failed to get old value:', err);
    }

    // Update the specific record
    let updateResult;

    if (tableName === 'documents') {
      updateResult = await db
        .update(documents)
        .set({
          [fieldName]: value,
          updatedAt: new Date(),
        } as any)
        .where(eq(documents.id, recordId))
        .returning();

    } else if (tableName === 'peer_companies') {
      updateResult = await db
        .update(peerCompanies)
        .set({
          [fieldName]: value,
          updatedAt: new Date(),
        } as any)
        .where(eq(peerCompanies.id, recordId))
        .returning();

    } else if (tableName === 'ipo_reviews') {
      updateResult = await db
        .update(ipoReviews)
        .set({
          [fieldName]: value,
          updatedAt: new Date(),
        } as any)
        .where(eq(ipoReviews.id, recordId))
        .returning();
    }

    // Check if update was successful
    if (!updateResult || updateResult.length === 0) {
      return NextResponse.json(
        { error: 'Record not found or update failed' },
        { status: 404 }
      );
    }

    // Mark field as manually edited and auto-protect at record level
    // For one-to-many tables, we need to track the specific record ID
    const fieldProtectionService = createFieldProtectionService(db, redis);

    // Create a composite key for the protection metadata
    const compositeTableName = `${tableName}:${recordId}`;

    await db
      .insert(fieldProtectionMetadata)
      .values({
        ipoId,
        tableName: compositeTableName,  // Store as "documents:record-id"
        fieldName,
        isProtected: autoProtect,
        autoProtected: autoProtect,
        manuallyEditedAt: new Date(),
        manuallyEditedBy: adminContext.adminName,
        editNote,
      })
      .onConflictDoUpdate({
        target: [
          fieldProtectionMetadata.tableName,
          fieldProtectionMetadata.fieldName,
          fieldProtectionMetadata.ipoId,
        ],
        set: {
          isProtected: autoProtect,
          autoProtected: autoProtect,
          manuallyEditedAt: new Date(),
          manuallyEditedBy: adminContext.adminName,
          editNote,
          updatedAt: new Date(),
        },
      });

    // Invalidate relevant caches
    try {
      await redis.del(
        `ipo:id:${ipoId}`,
        `${tableName}:ipo:${ipoId}`,
        `${tableName}:record:${recordId}`
      );

      // Invalidate list caches
      const listKeys = await redis.keys(`${tableName}:list:*`);
      if (listKeys.length > 0) {
        await redis.del(...listKeys);
      }
    } catch (error) {
      console.warn('[Admin API] Cache invalidation failed:', error);
    }

    console.log(
      `[Admin API] Record field updated: ${tableName}.${fieldName} = ${value} for record ${recordId} (IPO ${ipoId}) by ${adminContext.adminName}`
    );

    // Log audit entry
    await logAudit({
      adminUser: adminContext.adminName,
      actionType: AuditActionTypes.FIELD_UPDATED,
      ipoId,
      tableName,
      fieldName,
      oldValue,
      newValue: value,
      details: {
        recordId,
        autoProtected: autoProtect,
        editNote: editNote || null,
      },
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
      success: true,
    });

    return NextResponse.json({
      success: true,
      data: {
        recordId,
        ipoId,
        tableName,
        fieldName,
        value,
        protected: autoProtect,
      },
    });

  } catch (error) {
    console.error('[Admin API] Update field record error:', error);

    // Log failed audit entry
    if (body) {
      await logAudit({
        adminUser: adminContext.adminName,
        actionType: AuditActionTypes.FIELD_UPDATED,
        ipoId: body.ipoId,
        tableName: body.tableName || '',
        fieldName: body.fieldName || '',
        oldValue,
        newValue: body.value,
        details: {
          recordId: body.recordId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        ipAddress: getClientIP(request),
        userAgent: getUserAgent(request),
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return NextResponse.json(
      {
        error: 'Failed to update field',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
});