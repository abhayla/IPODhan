/**
 * API Route: Field Protection Conflicts
 * GET /api/admin/conflicts
 *
 * Fetches conflicts where scrapers attempted to update protected fields
 * with different values than the manually set ones.
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
import { eq, and, desc, inArray, isNotNull } from 'drizzle-orm';
import { getBlockedUpdateNotifications } from '@/lib/admin/field-protection-checker';

interface FieldConflict {
  id: string;
  ipoId: string;
  companyName: string;
  tableName: string;
  fieldName: string;
  manualValue: any;
  scraperValue: any;
  protectedAt: Date;
  protectedBy: string;
  lastScraperAttempt: Date;
  scraperName: string;
  timesBlocked: number;
  status: 'pending' | 'resolved';
}

interface ConflictsResponse {
  conflicts: FieldConflict[];
  summary: {
    total: number;
    pending: number;
    resolved: number;
    byTable: Record<string, number>;
    byScraper: Record<string, number>;
  };
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

/**
 * GET /api/admin/conflicts
 * Fetch field protection conflicts
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status') as 'pending' | 'resolved' | null;
    const ipoId = searchParams.get('ipoId');
    const tableName = searchParams.get('tableName');

    const db = await getDb();

    // Get recent blocked updates from Redis
    const blockedUpdates = await getBlockedUpdateNotifications(100);

    // Get protected fields from database
    const protectedFields = await db
      .select({
        ipoId: fieldProtectionMetadata.ipoId,
        tableName: fieldProtectionMetadata.tableName,
        fieldName: fieldProtectionMetadata.fieldName,
        isProtected: fieldProtectionMetadata.isProtected,
        manuallyEditedAt: fieldProtectionMetadata.manuallyEditedAt,
        manuallyEditedBy: fieldProtectionMetadata.manuallyEditedBy,
      })
      .from(fieldProtectionMetadata)
      .where(
        and(
          eq(fieldProtectionMetadata.isProtected, true),
          ipoId ? eq(fieldProtectionMetadata.ipoId, ipoId) : undefined,
          tableName ? eq(fieldProtectionMetadata.tableName, tableName) : undefined
        )
      );

    // Get IPO details for context
    const ipoIds = [...new Set(protectedFields.map(f => f.ipoId))];
    const ipoDetails = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
      })
      .from(ipos)
      .where(inArray(ipos.id, ipoIds));

    const ipoMap = Object.fromEntries(
      ipoDetails.map(ipo => [ipo.id, ipo])
    );

    // Build conflicts array by matching blocked updates with protected fields
    const conflicts: FieldConflict[] = [];
    const conflictMap = new Map<string, FieldConflict>();

    // Process blocked updates from Redis
    for (const update of blockedUpdates) {
      const key = `${update.ipoId}-${update.tableName}-${update.fieldName || '*'}`;

      if (!conflictMap.has(key)) {
        const ipo = ipoMap[update.ipoId];
        const protectedField = protectedFields.find(
          f => f.ipoId === update.ipoId &&
               f.tableName === update.tableName &&
               (!update.fieldName || f.fieldName === update.fieldName)
        );

        if (ipo && protectedField) {
          conflictMap.set(key, {
            id: key,
            ipoId: update.ipoId,
            companyName: ipo.companyName,
            tableName: update.tableName,
            fieldName: update.fieldName || 'All fields',
            manualValue: await getFieldValue(db, update.ipoId, update.tableName, update.fieldName),
            scraperValue: update.attemptedValue,
            protectedAt: protectedField.manuallyEditedAt || new Date(),
            protectedBy: protectedField.manuallyEditedBy || 'Admin',
            lastScraperAttempt: update.timestamp,
            scraperName: update.scraperName,
            timesBlocked: 1,
            status: 'pending',
          });
        }
      } else {
        // Increment times blocked
        const conflict = conflictMap.get(key)!;
        conflict.timesBlocked++;
        conflict.lastScraperAttempt = update.timestamp;
      }
    }

    // Convert map to array
    conflicts.push(...conflictMap.values());

    // Apply status filter
    const filteredConflicts = status
      ? conflicts.filter(c => c.status === status)
      : conflicts;

    // Apply pagination
    const start = (page - 1) * limit;
    const paginatedConflicts = filteredConflicts.slice(start, start + limit);

    // Calculate summary statistics
    const summary = {
      total: conflicts.length,
      pending: conflicts.filter(c => c.status === 'pending').length,
      resolved: conflicts.filter(c => c.status === 'resolved').length,
      byTable: conflicts.reduce((acc, c) => {
        acc[c.tableName] = (acc[c.tableName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byScraper: conflicts.reduce((acc, c) => {
        acc[c.scraperName] = (acc[c.scraperName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    const response: ConflictsResponse = {
      conflicts: paginatedConflicts,
      summary,
      pagination: {
        page,
        limit,
        hasMore: start + limit < filteredConflicts.length,
      },
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('[Admin API] Failed to fetch conflicts:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch conflicts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
});

/**
 * Helper function to get current field value from database
 */
async function getFieldValue(
  db: any,
  ipoId: string,
  tableName: string,
  fieldName?: string
): Promise<any> {
  if (!fieldName) return null;

  try {
    // Handle different table types
    if (tableName === 'ipos') {
      const result = await db
        .select({ value: (ipos as any)[fieldName] })
        .from(ipos)
        .where(eq(ipos.id, ipoId))
        .limit(1);
      return result[0]?.value;
    }

    if (tableName === 'financial_data') {
      const result = await db
        .select({ value: (financialData as any)[fieldName] })
        .from(financialData)
        .where(eq(financialData.ipoId, ipoId))
        .limit(1);
      return result[0]?.value;
    }

    if (tableName === 'listing_performance') {
      const result = await db
        .select({ value: (listingPerformance as any)[fieldName] })
        .from(listingPerformance)
        .where(eq(listingPerformance.ipoId, ipoId))
        .limit(1);
      return result[0]?.value;
    }

    // For time-series tables, get latest value
    if (tableName === 'subscriptions') {
      const result = await db
        .select({ value: (subscriptions as any)[fieldName] })
        .from(subscriptions)
        .where(eq(subscriptions.ipoId, ipoId))
        .orderBy(desc(subscriptions.timestamp))
        .limit(1);
      return result[0]?.value;
    }

    if (tableName === 'gmp_records') {
      const result = await db
        .select({ value: (gmpRecords as any)[fieldName] })
        .from(gmpRecords)
        .where(eq(gmpRecords.ipoId, ipoId))
        .orderBy(desc(gmpRecords.timestamp))
        .limit(1);
      return result[0]?.value;
    }

    return null;
  } catch (error) {
    console.warn(`[Conflicts] Failed to get field value for ${tableName}.${fieldName}:`, error);
    return null;
  }
}