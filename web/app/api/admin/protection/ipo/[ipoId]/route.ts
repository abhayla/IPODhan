/**
 * API Route: Get/Update IPO Protection Status
 * GET /api/admin/protection/ipo/[ipoId] - Get IPO lock status
 * PATCH /api/admin/protection/ipo/[ipoId] - Update IPO lock status
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, getAdminIdentity } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import { invalidateProtectionCache } from '@/lib/admin/field-protection-checker';
import { sendNotification } from '@/lib/services/notification-service';
import { logAudit, AuditActionTypes, getClientIP, getUserAgent } from '@/lib/services/audit-log-service';

interface RouteParams {
  params: Promise<{ ipoId: string }>;
}

/**
 * GET /api/admin/protection/ipo/[ipoId]
 * Get IPO protection status (lock status and metadata)
 */
export const GET = withAdminAuth(async (request: NextRequest, adminContext, { params }: RouteParams) => {
  try {
    const { ipoId } = await params;
    const db = await getDb();

    // Fetch IPO with protection fields
    const result = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        scraperLocked: ipos.scraperLocked,
        scraperLockNote: ipos.scraperLockNote,
        lastManualEditAt: ipos.lastManualEditAt,
      })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'IPO not found' },
        { status: 404 }
      );
    }

    const ipo = result[0];

    return NextResponse.json({
      success: true,
      data: {
        ipoId: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        scraperLocked: ipo.scraperLocked,
        scraperLockNote: ipo.scraperLockNote,
        lastManualEditAt: ipo.lastManualEditAt,
      },
    });
  } catch (error) {
    console.error('[Admin API] Failed to get IPO protection status:', error);
    return NextResponse.json(
      { error: 'Failed to get IPO protection status' },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/admin/protection/ipo/[ipoId]
 * Update IPO lock status
 */
export const PATCH = withAdminAuth(async (request: NextRequest, adminContext, { params }: RouteParams) => {
  let ipoId: string = '';
  let scraperLocked: boolean = false;

  try {
    const resolvedParams = await params;
    ipoId = resolvedParams.ipoId;
    const body = await request.json();
    const { scraperLocked: locked, scraperLockNote } = body;
    scraperLocked = locked;

    if (typeof scraperLocked !== 'boolean') {
      return NextResponse.json(
        { error: 'scraperLocked must be a boolean' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Update IPO lock status
    const result = await db
      .update(ipos)
      .set({
        scraperLocked,
        scraperLockNote: scraperLockNote || null,
        lastManualEditAt: new Date(),
      })
      .where(eq(ipos.id, ipoId))
      .returning({
        id: ipos.id,
        companyName: ipos.companyName,
        scraperLocked: ipos.scraperLocked,
        scraperLockNote: ipos.scraperLockNote,
      });

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'IPO not found' },
        { status: 404 }
      );
    }

    // Invalidate protection cache
    await invalidateProtectionCache(ipoId);

    console.log(
      `[Admin API] IPO ${ipoId} lock ${scraperLocked ? 'enabled' : 'disabled'} by ${adminContext.adminName}`
    );

    // Send notification (async, non-blocking)
    sendNotification(scraperLocked ? 'ipo_locked' : 'ipo_unlocked', {
      ipoId,
      companyName: result[0].companyName,
      adminName: adminContext.adminName,
      note: scraperLockNote || undefined,
    }).catch((error) => {
      console.error('[Admin API] Failed to send notification:', error);
    });

    // Log audit entry
    logAudit({
      adminUser: adminContext.adminName,
      actionType: scraperLocked ? AuditActionTypes.IPO_LOCKED : AuditActionTypes.IPO_UNLOCKED,
      ipoId,
      details: {
        note: scraperLockNote || null,
      },
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
      success: true,
    });

    return NextResponse.json({
      success: true,
      data: result[0],
      message: `IPO ${scraperLocked ? 'locked' : 'unlocked'} successfully`,
    });
  } catch (error) {
    console.error('[Admin API] Failed to update IPO lock status:', error);

    // Log failed audit entry
    logAudit({
      adminUser: adminContext.adminName,
      actionType: scraperLocked ? AuditActionTypes.IPO_LOCKED : AuditActionTypes.IPO_UNLOCKED,
      ipoId,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to update IPO lock status' },
      { status: 500 }
    );
  }
});
