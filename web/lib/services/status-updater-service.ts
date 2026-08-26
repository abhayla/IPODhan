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
import { DataConflictsRepository } from '@ipodhan/shared/repositories/data-conflicts-repository';

export type IPOStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';

/**
 * T-328 (LIFECYCLE-1, belt-and-suspenders half of HOLD): the date field that
 * DRIVES each transition computeTargetStatus can produce. If that field has
 * an unresolved HIGH_VALUE data_conflicts row for this IPO, the transition is
 * skipped this cycle rather than acted on — the scraper-side HOLD in
 * data-consolidation-service.ts already stops the wrong value from being
 * written, but this is an independent second check in case a disputed value
 * reached `ipos` some other way (an older code path, a manual repair with a
 * lingering unresolved conflict row, etc.). `listingDate` is not a
 * HIGH_VALUE field (see cross-source-disagreement-monitor.ts
 * HIGH_VALUE_FIELDS), so CLOSED→LISTED is never held by this check.
 */
const TRANSITION_DRIVING_FIELD: Partial<Record<`${IPOStatus}->${IPOStatus}`, string>> = {
  'UPCOMING->OPEN': 'openDate',
  'OPEN->CLOSED': 'closeDate',
};

/** Pure lookup — which field (if any) drives a given status transition. */
export function getTransitionDrivingField(from: IPOStatus, to: IPOStatus): string | undefined {
  return TRANSITION_DRIVING_FIELD[`${from}->${to}`];
}

/**
 * Pure decision: given the driving field for a transition and the IPO's
 * unresolved data_conflicts rows, should the transition be held? True only
 * when the driving field itself has an unresolved conflict — an unresolved
 * conflict on an unrelated field must not block an otherwise-safe transition.
 */
export function isTransitionHeld(
  drivingField: string | undefined,
  unresolvedConflicts: { fieldName: string }[]
): boolean {
  if (!drivingField) return false;
  return unresolvedConflicts.some((c) => c.fieldName === drivingField);
}

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
  const conflictsRepo = new DataConflictsRepository(db, redis);
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

    // T-328: refuse to flip status when the field driving this transition
    // has an unresolved HIGH_VALUE dispute for this IPO — belt-and-suspenders
    // alongside the scraper-side HOLD (data-consolidation-service.ts).
    const drivingField = getTransitionDrivingField(r.status as IPOStatus, target);
    if (drivingField) {
      const unresolved = await conflictsRepo.findUnresolvedForIPO(r.id);
      if (isTransitionHeld(drivingField, unresolved)) {
        const disputed = unresolved.find((c) => c.fieldName === drivingField)!;
        console.warn(
          `[Status Updater] hold_status_transition: ${r.companyName} (${r.id}) ${r.status} -> ${target} held — ${drivingField} disputed (${disputed.source1}="${disputed.value1}" vs ${disputed.source2}="${disputed.value2}")`
        );
        continue;
      }
    }

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
