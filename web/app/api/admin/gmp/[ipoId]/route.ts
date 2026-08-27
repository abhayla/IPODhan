/**
 * API Route: GMP Records Management
 * POST /api/admin/gmp/[ipoId] - Create new GMP record
 * PATCH /api/admin/gmp/[ipoId] - Update existing GMP record
 * DELETE /api/admin/gmp/[ipoId] - Delete GMP record
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { gmpRecords } from '@ipodhan/shared/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { markFieldAsManuallyEdited } from '@/lib/admin/field-protection-checker';
import { apiErrorResponse } from '@/lib/errors/api-error-response';

interface CreateGMPRequest {
  gmpPrice: number;
  gmpPercentage?: number;
  estimatedListingPrice?: number;
  subject?: string;
  source: string;
  recordedAt?: string;
  autoProtect?: boolean;
  editNote?: string;
}

interface UpdateGMPRequest extends CreateGMPRequest {
  recordId: string; // ID of the GMP record to update
}

interface DeleteGMPRequest {
  recordId: string; // ID of the GMP record to delete
}

/**
 * POST /api/admin/gmp/[ipoId]
 * Create a new GMP record
 */
export const POST = withAdminAuth(async (
  request: NextRequest,
  adminContext,
  { params }: { params: Promise<{ ipoId: string }> }
) => {
  try {
    const { ipoId } = await params;
    const body: CreateGMPRequest = await request.json();
    const {
      gmpPrice,
      gmpPercentage,
      estimatedListingPrice,
      subject,
      source,
      recordedAt,
      autoProtect = true,
      editNote
    } = body;

    // Validation
    if (!gmpPrice || gmpPrice < 0) {
      return NextResponse.json(
        { error: 'gmpPrice is required and must be >= 0' },
        { status: 400 }
      );
    }

    if (!source || source.trim() === '') {
      return NextResponse.json(
        { error: 'source is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Create new GMP record
    const newRecord = await db
      .insert(gmpRecords)
      .values({
        ipoId,
        gmp: Math.round(gmpPrice), // Store as integer (schema requires integer)
        expectedListingPrice: estimatedListingPrice ? Math.round(estimatedListingPrice) : null,
        subjectRate: null, // Subject rate not provided in this interface
        kostakRate: null, // Kostak rate not provided
        saudaDetails: subject || null,
        source,
        timestamp: recordedAt ? new Date(recordedAt) : new Date(),
      })
      .returning();

    // Mark as manually edited and auto-protect
    await markFieldAsManuallyEdited(
      ipoId,
      'gmp_records',
      'gmp', // Protect the gmp field
      adminContext.adminName,
      editNote || `New GMP record created: ₹${gmpPrice}`,
      autoProtect
    );

    // Invalidate relevant caches
    const redis = getRedisClient();
    try {
      await redis.del(`ipo:id:${ipoId}`, `ipo:slug:*`);
      const listKeys = await redis.keys('ipo:list:*');
      if (listKeys.length > 0) {
        await redis.del(...listKeys);
      }
    } catch (error) {
      console.warn('[Admin API] Cache invalidation failed:', error);
    }

    console.log(
      `[Admin API] GMP record created: ₹${gmpPrice} for IPO ${ipoId} by ${adminContext.adminName}`
    );

    return NextResponse.json({
      success: true,
      data: newRecord[0],
      message: 'GMP record created successfully',
    });

  } catch (error) {
    return apiErrorResponse(error, '/api/admin/gmp/[ipoId]');
  }
});

/**
 * PATCH /api/admin/gmp/[ipoId]
 * Update an existing GMP record
 */
export const PATCH = withAdminAuth(async (
  request: NextRequest,
  adminContext,
  { params }: { params: Promise<{ ipoId: string }> }
) => {
  try {
    const { ipoId } = await params;
    const body: UpdateGMPRequest = await request.json();
    const {
      recordId,
      gmpPrice,
      gmpPercentage,
      estimatedListingPrice,
      subject,
      source,
      recordedAt,
      autoProtect = true,
      editNote
    } = body;

    // Validation
    if (!recordId) {
      return NextResponse.json(
        { error: 'recordId is required for update' },
        { status: 400 }
      );
    }

    if (!gmpPrice || gmpPrice < 0) {
      return NextResponse.json(
        { error: 'gmpPrice is required and must be >= 0' },
        { status: 400 }
      );
    }

    if (!source || source.trim() === '') {
      return NextResponse.json(
        { error: 'source is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Update GMP record
    const updateResult = await db
      .update(gmpRecords)
      .set({
        gmp: Math.round(gmpPrice),
        expectedListingPrice: estimatedListingPrice ? Math.round(estimatedListingPrice) : null,
        saudaDetails: subject || null,
        source,
        timestamp: recordedAt ? new Date(recordedAt) : new Date(),
      })
      .where(and(eq(gmpRecords.id, recordId), eq(gmpRecords.ipoId, ipoId)))
      .returning();

    if (!updateResult || updateResult.length === 0) {
      return NextResponse.json(
        { error: 'GMP record not found' },
        { status: 404 }
      );
    }

    // Mark as manually edited and auto-protect
    await markFieldAsManuallyEdited(
      ipoId,
      'gmp_records',
      'gmp',
      adminContext.adminName,
      editNote || `GMP record updated: ₹${gmpPrice}`,
      autoProtect
    );

    // Invalidate relevant caches
    const redis = getRedisClient();
    try {
      await redis.del(`ipo:id:${ipoId}`, `ipo:slug:*`);
      const listKeys = await redis.keys('ipo:list:*');
      if (listKeys.length > 0) {
        await redis.del(...listKeys);
      }
    } catch (error) {
      console.warn('[Admin API] Cache invalidation failed:', error);
    }

    console.log(
      `[Admin API] GMP record updated: ${recordId} -> ₹${gmpPrice} for IPO ${ipoId} by ${adminContext.adminName}`
    );

    return NextResponse.json({
      success: true,
      data: updateResult[0],
      message: 'GMP record updated successfully',
    });

  } catch (error) {
    return apiErrorResponse(error, '/api/admin/gmp/[ipoId]');
  }
});

/**
 * DELETE /api/admin/gmp/[ipoId]
 * Delete a GMP record
 */
export const DELETE = withAdminAuth(async (
  request: NextRequest,
  adminContext,
  { params }: { params: Promise<{ ipoId: string }> }
) => {
  try {
    const { ipoId } = await params;
    const { searchParams } = new URL(request.url);
    const recordId = searchParams.get('recordId');

    if (!recordId) {
      return NextResponse.json(
        { error: 'recordId query parameter is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Delete GMP record
    const deleteResult = await db
      .delete(gmpRecords)
      .where(and(eq(gmpRecords.id, recordId), eq(gmpRecords.ipoId, ipoId)))
      .returning();

    if (!deleteResult || deleteResult.length === 0) {
      return NextResponse.json(
        { error: 'GMP record not found' },
        { status: 404 }
      );
    }

    // Invalidate relevant caches
    const redis = getRedisClient();
    try {
      await redis.del(`ipo:id:${ipoId}`, `ipo:slug:*`);
      const listKeys = await redis.keys('ipo:list:*');
      if (listKeys.length > 0) {
        await redis.del(...listKeys);
      }
    } catch (error) {
      console.warn('[Admin API] Cache invalidation failed:', error);
    }

    console.log(
      `[Admin API] GMP record deleted: ${recordId} for IPO ${ipoId} by ${adminContext.adminName}`
    );

    return NextResponse.json({
      success: true,
      message: 'GMP record deleted successfully',
    });

  } catch (error) {
    return apiErrorResponse(error, '/api/admin/gmp/[ipoId]');
  }
});
