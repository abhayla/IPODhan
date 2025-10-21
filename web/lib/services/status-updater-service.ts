/**
 * IPO Status Updater Service
 *
 * Automatically updates IPO statuses based on open_date and close_date
 * Fixes Phase 5 data quality issue: 29 IPOs with outdated status
 *
 * Status workflow:
 * - UPCOMING → OPEN (when open_date has passed)
 * - OPEN → CLOSED (when close_date has passed and no listing_date)
 * - CLOSED → LISTED (when listing_date is set)
 *
 * @module web/lib/services/status-updater-service
 */

import { getDb } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq, and, lt, lte, gte, sql } from 'drizzle-orm';
import { getRedisClient } from '@/lib/cache/redis-client';

/**
 * Result of status update operation
 */
export interface StatusUpdateResult {
  upcomingToOpen: number;
  openToClosed: number;
  closedToListed: number;
  total: number;
  updatedIPOs: {
    id: string;
    companyName: string;
    oldStatus: string;
    newStatus: string;
  }[];
}

/**
 * Update IPO statuses based on current dates
 *
 * This function implements the automatic status workflow:
 * 1. UPCOMING → OPEN: When current date >= open_date and < close_date
 * 2. OPEN → CLOSED: When current date > close_date and listing_date is NULL
 * 3. CLOSED → LISTED: When listing_date is set
 *
 * @returns Promise<StatusUpdateResult> - Number of IPOs updated in each category
 */
export async function updateIPOStatuses(): Promise<StatusUpdateResult> {
  console.log('[Status Updater] Starting status update...');

  const db = await getDb();
  const redis = getRedisClient();
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

  const updatedIPOs: StatusUpdateResult['updatedIPOs'] = [];

  try {
    // STEP 1: UPCOMING → OPEN (open_date has passed, close_date not yet passed)
    const upcomingToOpen = await db.update(ipos)
      .set({
        status: 'OPEN',
        updatedAt: now
      })
      .where(
        and(
          eq(ipos.status, 'UPCOMING'),
          sql`${ipos.openDate} <= ${today}::date`,
          sql`${ipos.closeDate} >= ${today}::date`
        )
      )
      .returning({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug
      });

    upcomingToOpen.forEach(ipo => {
      updatedIPOs.push({
        id: ipo.id,
        companyName: ipo.companyName,
        oldStatus: 'UPCOMING',
        newStatus: 'OPEN'
      });
      console.log(`[Status Updater] UPCOMING → OPEN: ${ipo.companyName}`);
    });

    console.log(`[Status Updater] UPCOMING → OPEN: ${upcomingToOpen.length} IPOs updated`);

    // STEP 2: OPEN → CLOSED (close_date has passed, not yet listed)
    const openToClosed = await db.update(ipos)
      .set({
        status: 'CLOSED',
        updatedAt: now
      })
      .where(
        and(
          eq(ipos.status, 'OPEN'),
          sql`${ipos.closeDate} < ${today}::date`,
          // Only if not yet listed
          sql`${ipos.listingDate} IS NULL`
        )
      )
      .returning({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug
      });

    openToClosed.forEach(ipo => {
      updatedIPOs.push({
        id: ipo.id,
        companyName: ipo.companyName,
        oldStatus: 'OPEN',
        newStatus: 'CLOSED'
      });
      console.log(`[Status Updater] OPEN → CLOSED: ${ipo.companyName}`);
    });

    console.log(`[Status Updater] OPEN → CLOSED: ${openToClosed.length} IPOs updated`);

    // STEP 3: CLOSED → LISTED (listing_date is set)
    const closedToListed = await db.update(ipos)
      .set({
        status: 'LISTED',
        updatedAt: now
      })
      .where(
        and(
          eq(ipos.status, 'CLOSED'),
          sql`${ipos.listingDate} IS NOT NULL`
        )
      )
      .returning({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug
      });

    closedToListed.forEach(ipo => {
      updatedIPOs.push({
        id: ipo.id,
        companyName: ipo.companyName,
        oldStatus: 'CLOSED',
        newStatus: 'LISTED'
      });
      console.log(`[Status Updater] CLOSED → LISTED: ${ipo.companyName}`);
    });

    console.log(`[Status Updater] CLOSED → LISTED: ${closedToListed.length} IPOs updated`);

    // Invalidate cache for updated IPOs
    const totalUpdated = upcomingToOpen.length + openToClosed.length + closedToListed.length;

    if (totalUpdated > 0) {
      console.log(`[Status Updater] Invalidating cache for ${totalUpdated} updated IPOs...`);

      // Invalidate individual IPO caches
      const allUpdated = [...upcomingToOpen, ...openToClosed, ...closedToListed];
      for (const ipo of allUpdated) {
        try {
          await redis.del(`ipo:slug:${ipo.slug}`);
          await redis.del(`ipo:id:${ipo.id}`);
        } catch (error) {
          console.error(`[Status Updater] Cache invalidation failed for ${ipo.slug}:`, error);
        }
      }

      // Invalidate list caches (all filters)
      try {
        const keys = await redis.keys('ipo:list:*');
        if (keys.length > 0) {
          await redis.del(...keys);
          console.log(`[Status Updater] Invalidated ${keys.length} list cache keys`);
        }
      } catch (error) {
        console.error('[Status Updater] List cache invalidation failed:', error);
      }
    }

    const result: StatusUpdateResult = {
      upcomingToOpen: upcomingToOpen.length,
      openToClosed: openToClosed.length,
      closedToListed: closedToListed.length,
      total: totalUpdated,
      updatedIPOs
    };

    console.log('[Status Updater] Status update completed successfully:', {
      upcomingToOpen: result.upcomingToOpen,
      openToClosed: result.openToClosed,
      closedToListed: result.closedToListed,
      total: result.total
    });

    return result;
  } catch (error) {
    console.error('[Status Updater] Error during status update:', error);
    throw error;
  }
}

/**
 * Get count of IPOs with outdated statuses (for monitoring)
 *
 * @returns Promise<object> - Count of IPOs needing status updates
 */
export async function getOutdatedStatusCount(): Promise<{
  upcomingToOpen: number;
  openToClosed: number;
  closedToListed: number;
  total: number;
}> {
  const db = await getDb();
  const today = new Date().toISOString().split('T')[0];

  try {
    // Count UPCOMING IPOs that should be OPEN
    const upcomingToOpenCount = await db.select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(
        and(
          eq(ipos.status, 'UPCOMING'),
          sql`${ipos.openDate} <= ${today}::date`,
          sql`${ipos.closeDate} >= ${today}::date`
        )
      );

    // Count OPEN IPOs that should be CLOSED
    const openToClosedCount = await db.select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(
        and(
          eq(ipos.status, 'OPEN'),
          sql`${ipos.closeDate} < ${today}::date`,
          sql`${ipos.listingDate} IS NULL`
        )
      );

    // Count CLOSED IPOs that should be LISTED
    const closedToListedCount = await db.select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(
        and(
          eq(ipos.status, 'CLOSED'),
          sql`${ipos.listingDate} IS NOT NULL`
        )
      );

    const upcomingToOpen = Number(upcomingToOpenCount[0]?.count || 0);
    const openToClosed = Number(openToClosedCount[0]?.count || 0);
    const closedToListed = Number(closedToListedCount[0]?.count || 0);

    return {
      upcomingToOpen,
      openToClosed,
      closedToListed,
      total: upcomingToOpen + openToClosed + closedToListed
    };
  } catch (error) {
    console.error('[Status Updater] Error getting outdated status count:', error);
    throw error;
  }
}
