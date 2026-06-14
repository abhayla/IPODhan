/**
 * IPO Status Updater Service
 *
 * Automatically updates IPO statuses based on open_date / close_date /
 * listing_date. The transition rules live in a single pure function,
 * computeTargetStatus, so the full state machine is unit-testable and there is
 * one source of truth.
 *
 * @module web/lib/services/status-updater-service
 */

import { getDb } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getRedisClient } from '@/lib/cache/redis-client';

export type IPOStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';

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
 * Pure state machine: given an IPO's dates and today's date (YYYY-MM-DD),
 * return the status the IPO SHOULD have, or null if there isn't enough date
 * information to decide (leave the row as-is).
 *
 * Precedence (highest first):
 *  - LISTED   — listing_date has arrived (<= today)
 *  - CLOSED   — bidding window has passed (close_date < today) and not yet listed
 *  - OPEN     — within the bidding window (open_date <= today <= close_date)
 *  - UPCOMING — open_date is still in the future
 *
 * This deliberately fixes the gaps the partial earlier logic had (GitHub #4/#6):
 *  - a future listing_date no longer marks a row LISTED prematurely
 *  - an UPCOMING whose whole window has passed transitions to CLOSED/LISTED
 *  - an OPEN that already has a listing_date transitions to LISTED
 */
export function computeTargetStatus(
  dates: { openDate: string | null; closeDate: string | null; listingDate: string | null },
  today: string
): IPOStatus | null {
  const { openDate, closeDate, listingDate } = dates;

  if (listingDate && listingDate <= today) return 'LISTED';
  if (closeDate && closeDate < today) return 'CLOSED';
  if (openDate && openDate <= today && (!closeDate || closeDate >= today)) return 'OPEN';
  if (openDate && openDate > today) return 'UPCOMING';
  return null;
}

/**
 * Apply computeTargetStatus to every non-locked IPO, persist the rows whose
 * status changed, and invalidate their caches.
 */
export async function updateIPOStatuses(): Promise<StatusUpdateResult> {
  console.log('[Status Updater] Starting status update...');

  const db = await getDb();
  const redis = getRedisClient();
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const rows = await db
    .select({
      id: ipos.id,
      slug: ipos.slug,
      companyName: ipos.companyName,
      status: ipos.status,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate,
      listingDate: ipos.listingDate,
      scraperLocked: ipos.scraperLocked,
    })
    .from(ipos);

  const updatedIPOs: StatusUpdateResult['updatedIPOs'] = [];
  const changedSlugs: { slug: string; id: string }[] = [];

  for (const r of rows) {
    if (r.scraperLocked) continue; // respect manual lock
    const target = computeTargetStatus(
      { openDate: r.openDate, closeDate: r.closeDate, listingDate: r.listingDate },
      today
    );
    if (!target || target === r.status) continue;

    await db.update(ipos).set({ status: target, updatedAt: now }).where(eq(ipos.id, r.id));
    updatedIPOs.push({ id: r.id, companyName: r.companyName, oldStatus: r.status, newStatus: target });
    changedSlugs.push({ slug: r.slug, id: r.id });
    console.log(`[Status Updater] ${r.status} → ${target}: ${r.companyName}`);
  }

  // Invalidate caches for changed IPOs + the list caches
  if (changedSlugs.length > 0) {
    for (const { slug, id } of changedSlugs) {
      try {
        await redis.del(`ipo:slug:${slug}`);
        await redis.del(`ipo:id:${id}`);
      } catch (error) {
        console.error(`[Status Updater] Cache invalidation failed for ${slug}:`, error);
      }
    }
    try {
      const keys = await redis.keys('ipo:list:*');
      if (keys.length > 0) await redis.del(...keys);
    } catch (error) {
      console.error('[Status Updater] List cache invalidation failed:', error);
    }
  }

  const countTransition = (from: string, to: string) =>
    updatedIPOs.filter((u) => u.oldStatus === from && u.newStatus === to).length;

  const result: StatusUpdateResult = {
    upcomingToOpen: countTransition('UPCOMING', 'OPEN'),
    openToClosed: countTransition('OPEN', 'CLOSED'),
    closedToListed: countTransition('CLOSED', 'LISTED'),
    total: updatedIPOs.length,
    updatedIPOs,
  };

  console.log('[Status Updater] Completed:', { total: result.total });
  return result;
}

/**
 * Count IPOs whose stored status differs from their computed target status
 * (i.e. how many updateIPOStatuses would change), for monitoring. Read-only.
 */
export async function getOutdatedStatusCount(): Promise<{
  upcomingToOpen: number;
  openToClosed: number;
  closedToListed: number;
  total: number;
}> {
  const db = await getDb();
  const today = new Date().toISOString().split('T')[0];

  const rows = await db
    .select({
      status: ipos.status,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate,
      listingDate: ipos.listingDate,
      scraperLocked: ipos.scraperLocked,
    })
    .from(ipos);

  let upcomingToOpen = 0;
  let openToClosed = 0;
  let closedToListed = 0;
  let total = 0;

  for (const r of rows) {
    if (r.scraperLocked) continue;
    const target = computeTargetStatus(
      { openDate: r.openDate, closeDate: r.closeDate, listingDate: r.listingDate },
      today
    );
    if (!target || target === r.status) continue;
    total++;
    if (r.status === 'UPCOMING' && target === 'OPEN') upcomingToOpen++;
    else if (r.status === 'OPEN' && target === 'CLOSED') openToClosed++;
    else if (r.status === 'CLOSED' && target === 'LISTED') closedToListed++;
  }

  return { upcomingToOpen, openToClosed, closedToListed, total };
}
