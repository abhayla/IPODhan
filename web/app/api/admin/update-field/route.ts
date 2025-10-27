/**
 * API Route: Update Field Value
 * PATCH /api/admin/update-field
 *
 * Updates a field value in any table and automatically protects it
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, getAdminIdentity } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  ipos,
  financialData,
  listingPerformance,
  subscriptions,
  gmpRecords,
  documents,
  peerCompanies,
  ipoReviews,
  ipoScores,
  ipoFinancials,
  ipoDetails
} from '@ipodhan/shared/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { markFieldAsManuallyEdited } from '@/lib/admin/field-protection-checker';
import { sql } from 'drizzle-orm';
import { logAudit, AuditActionTypes, getClientIP, getUserAgent } from '@/lib/services/audit-log-service';

interface UpdateFieldRequest {
  ipoId: string;
  tableName: string;
  fieldName: string;
  value: any;
  autoProtect?: boolean; // Default: true (auto-lock after edit)
  editNote?: string;
}

// Table name to Drizzle table mapping
const TABLE_MAP: Record<string, any> = {
  ipos,
  financial_data: financialData,
  listing_performance: listingPerformance,
  subscriptions,
  gmp_records: gmpRecords,
  documents,
  peer_companies: peerCompanies,
  ipo_reviews: ipoReviews,
  ipo_scores: ipoScores,
  ipo_financials: ipoFinancials,
  ipo_details: ipoDetails,
};

// Fields that should not be editable
const NON_EDITABLE_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'ipo_id', // Foreign keys
  'scraper_locked', // Use dedicated endpoint
  'last_manual_edit_at', // Auto-managed
]);

/**
 * PATCH /api/admin/update-field
 * Update a field value and auto-protect it
 */
export const PATCH = withAdminAuth(async (request: NextRequest, adminContext) => {
  let oldValue: any = null;
  let body: UpdateFieldRequest | null = null;

  try {
    body = await request.json();

    if (!body) {
      return NextResponse.json(
        { error: 'Request body is required' },
        { status: 400 }
      );
    }

    const { ipoId, tableName, fieldName, value, autoProtect = true, editNote } = body;

    // Validation
    if (!ipoId || !tableName || !fieldName) {
      return NextResponse.json(
        { error: 'ipoId, tableName, and fieldName are required' },
        { status: 400 }
      );
    }

    // Check if table exists
    const table = TABLE_MAP[tableName];
    if (!table) {
      return NextResponse.json(
        { error: `Unknown table: ${tableName}` },
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

    // Get old value before update (for audit log)
    try {
      if (tableName === 'ipos') {
        const existing = await db.select().from(ipos).where(eq(ipos.id, ipoId)).limit(1);
        oldValue = existing[0]?.[fieldName as keyof typeof existing[0]];
      }
    } catch (err) {
      console.warn('[Audit] Failed to get old value:', err);
    }

    // Special handling for different tables
    let updateResult;

    if (tableName === 'ipos') {
      // Update ipos table
      updateResult = await db
        .update(ipos)
        .set({
          [fieldName]: value,
          lastManualEditAt: new Date(),
        } as any)
        .where(eq(ipos.id, ipoId))
        .returning();

    } else if (tableName === 'financial_data') {
      // Update financial_data (one-to-one)
      updateResult = await db
        .update(financialData)
        .set({ [fieldName]: value } as any)
        .where(eq(financialData.ipoId, ipoId))
        .returning();

    } else if (tableName === 'listing_performance') {
      // Update listing_performance (one-to-one)
      updateResult = await db
        .update(listingPerformance)
        .set({
          [fieldName]: value,
          updatedAt: new Date(),
        } as any)
        .where(eq(listingPerformance.ipoId, ipoId))
        .returning();

    } else if (tableName === 'ipo_financials') {
      // Update ipo_financials (one-to-one)
      updateResult = await db
        .update(ipoFinancials)
        .set({
          [fieldName]: value,
          updatedAt: new Date(),
        } as any)
        .where(eq(ipoFinancials.ipoId, ipoId))
        .returning();

    } else if (tableName === 'ipo_details') {
      // Update ipo_details (one-to-one)
      updateResult = await db
        .update(ipoDetails)
        .set({
          [fieldName]: value,
          updatedAt: new Date(),
        } as any)
        .where(eq(ipoDetails.ipoId, ipoId))
        .returning();

    } else if (tableName === 'ipo_scores') {
      // Update ipo_scores (one-to-one)
      updateResult = await db
        .update(ipoScores)
        .set({
          [fieldName]: value,
          updatedAt: new Date(),
        } as any)
        .where(eq(ipoScores.ipoId, ipoId))
        .returning();

    } else if (tableName === 'subscriptions') {
      // Update latest subscription record (time-series)
      const latestSubscription = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.ipoId, ipoId))
        .orderBy(desc(subscriptions.timestamp))
        .limit(1);

      if (latestSubscription.length === 0) {
        return NextResponse.json(
          { error: 'No subscription record found for this IPO' },
          { status: 404 }
        );
      }

      updateResult = await db
        .update(subscriptions)
        .set({ [fieldName]: value } as any)
        .where(eq(subscriptions.id, latestSubscription[0].id))
        .returning();

    } else if (tableName === 'gmp_records') {
      // Update latest GMP record (time-series)
      const latestGMP = await db
        .select()
        .from(gmpRecords)
        .where(eq(gmpRecords.ipoId, ipoId))
        .orderBy(desc(gmpRecords.timestamp))
        .limit(1);

      if (latestGMP.length === 0) {
        return NextResponse.json(
          { error: 'No GMP record found for this IPO' },
          { status: 404 }
        );
      }

      updateResult = await db
        .update(gmpRecords)
        .set({ [fieldName]: value } as any)
        .where(eq(gmpRecords.id, latestGMP[0].id))
        .returning();

    } else {
      // Generic update (not recommended - use specific handlers above)
      return NextResponse.json(
        { error: `Table ${tableName} requires specific update handler` },
        { status: 400 }
      );
    }

    // Check if update was successful
    if (!updateResult || updateResult.length === 0) {
      return NextResponse.json(
        { error: 'Record not found or update failed' },
        { status: 404 }
      );
    }

    // Mark field as manually edited and auto-protect
    await markFieldAsManuallyEdited(
      ipoId,
      tableName,
      fieldName,
      adminContext.adminName,
      editNote,
      autoProtect
    );

    // Invalidate relevant caches
    const redis = getRedisClient();
    try {
      // Invalidate IPO detail cache
      await redis.del(`ipo:id:${ipoId}`, `ipo:slug:*`);

      // Invalidate list caches (IPO might appear in lists)
      const listKeys = await redis.keys('ipo:list:*');
      if (listKeys.length > 0) {
        await redis.del(...listKeys);
      }
    } catch (error) {
      console.warn('[Admin API] Cache invalidation failed:', error);
      // Non-fatal - caches will expire naturally
    }

    console.log(
      `[Admin API] Field updated: ${tableName}.${fieldName} = ${value} for IPO ${ipoId} by ${adminContext.adminName}`
    );

    // Log audit entry
    logAudit({
      adminUser: adminContext.adminName,
      actionType: AuditActionTypes.FIELD_UPDATED,
      ipoId,
      tableName,
      fieldName,
      oldValue,
      newValue: value,
      details: {
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
        ipoId,
        tableName,
        fieldName,
        value,
        autoProtected: autoProtect,
        updatedRecord: updateResult[0],
      },
      message: `Field ${fieldName} updated successfully${autoProtect ? ' and protected' : ''}`,
    });

  } catch (error) {
    console.error('[Admin API] Failed to update field:', error);

    // Log failed audit entry
    logAudit({
      adminUser: adminContext.adminName,
      actionType: AuditActionTypes.FIELD_UPDATED,
      ipoId: body?.ipoId,
      tableName: body?.tableName,
      fieldName: body?.fieldName,
      oldValue,
      newValue: body?.value,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      {
        error: 'Failed to update field',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});
