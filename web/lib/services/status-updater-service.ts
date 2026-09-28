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
import { ipos, fieldSources } from '@/lib/db';
import { and, eq, inArray } from 'drizzle-orm';
import { getRedisClient } from '@/lib/cache/redis-client';
import { getIPOBySlugKey, getIPOByIdKey } from '@/lib/cache/cache-keys';
import { DataConflictsRepository } from '@ipodhan/shared/repositories/data-conflicts-repository';
import { isBehaviourConflict } from '@ipodhan/shared/utils/conflict-reasons';
import { revalidateForSlugs } from './page-revalidation-service';
import { istDateIso } from '@/lib/utils/ist-date';

export type IPOStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED' | 'WITHDRAWN' | 'POSTPONED' | 'DELISTED';

/**
 * I4 / W-41 — TERMINAL statuses. These are set by an exchange signal (a BSE
 * public notice, an NSE status text), never by the calendar, and the calendar
 * must never take them back: a withdrawn IPO's close_date still passes and its
 * (never-happening) listing date may still exist, so an unguarded
 * computeTargetStatus would silently walk it WITHDRAWN -> CLOSED -> LISTED and
 * republish a dead issue as a listed company. Only a source that can observe
 * the issue coming back (or a manual admin edit) may clear these.
 */
// #983 / OD-132: DELISTED is set by the post-listing price job after three explicit exchange
// delisted reports; its listing date has passed, so the ladder would otherwise write LISTED back.
export const TERMINAL_STATUSES = ['WITHDRAWN', 'POSTPONED', 'DELISTED'] as const;

/** Pure guard: is this stored status one the date ladder must not overwrite? */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(String(status ?? '').toUpperCase());
}

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
  unresolvedConflicts: { fieldName: string; resolutionReason?: string | null; documentId?: string | null }[]
): boolean {
  if (!drivingField) return false;
  // OD-75 review round 2 (PR #914): an admin-only row (a source moving its OWN value) is a record,
  // not a dispute — holding on it would freeze OPEN->CLOSED for as long as the row stays open.
  // OD-90: a corrigendum suggestion waits for an admin; it is not a dispute either.
  return unresolvedConflicts.some((c) => c.fieldName === drivingField && isBehaviourConflict(c));
}

/**
 * #1256 — the date ladder is forward-only. Spec row 8 (`status`, data-sourcing-pull-model.md):
 * "must be a legal transition (UPCOMING→OPEN→CLOSED→LISTED); never regresses without an ADMIN
 * row". The one sanctioned way back is an exchange relaunch (OD-83, F-131, §2.9 "POSTPONED — not
 * terminal, it comes back"): the exchange publishes a NEWER window for the same row.
 *
 * Measured on staging 2026-09-28 before this existed: every dated backward move the ladder wrote
 * was a regression, none a relaunch — 10 CLOSED→OPEN on the IPO's own close day after the source
 * reported bidding closed (close_date never moved), and 4 LISTED→CLOSED while listing_date was
 * still null.
 */
export const LADDER_RANK: Readonly<Record<string, number>> = { UPCOMING: 0, OPEN: 1, CLOSED: 2, LISTED: 3 };

/** Pure: does `from` → `to` go down the ladder? A status off the ladder is never "backward". */
export function isBackwardMove(from: string, to: string): boolean {
  const a = LADDER_RANK[String(from).toUpperCase()];
  const b = LADDER_RANK[String(to).toUpperCase()];
  return a !== undefined && b !== undefined && b < a;
}

/** The date that makes a backward target true: UPCOMING needs open_date ahead, OPEN needs
 *  close_date ahead, CLOSED (from LISTED) needs listing_date ahead or gone. */
const BACKWARD_DRIVING_FIELD: Readonly<Record<string, 'openDate' | 'closeDate' | 'listingDate'>> = {
  UPCOMING: 'openDate',
  OPEN: 'closeDate',
  CLOSED: 'listingDate',
};

const EXCHANGE_SOURCES: ReadonlySet<string> = new Set(['NSE', 'BSE']);

/** One `field_sources` row of this IPO's `ipos` record (status or a ladder date). */
export interface StatusEvidence {
  fieldName: string;
  source: string;
  previousValue: string | null;
  updatedAt: Date;
}

export type BackwardDecision = { allowed: true; reason: string } | { allowed: false; cause: string };

/**
 * Pure decision for a backward ladder move. Allowed only when:
 *  - ADMIN: the driving date's field_sources row is ADMIN and was written after the status; or
 *  - relaunch (never from LISTED): the driving date's row is from NSE or BSE, its previous value is
 *    an EARLIER date than the stored one (the exchange moved the window later), and it was written
 *    after the status's own field_sources row (the newer window arrived after the status it
 *    contradicts). No status row means the ladder itself set the status.
 * Everything else — a weaker source, an unchanged date, a null date — is refused.
 */
export function decideBackwardMove(
  from: string,
  to: string,
  dates: { openDate: string | null; closeDate: string | null; listingDate: string | null },
  evidence: StatusEvidence[]
): BackwardDecision {
  const field = BACKWARD_DRIVING_FIELD[String(to).toUpperCase()];
  if (!field) return { allowed: false, cause: `no driving date for target ${to}` };
  const driving = evidence.find((e) => e.fieldName === field);
  const statusRow = evidence.find((e) => e.fieldName === 'status');
  if (!driving) return { allowed: false, cause: `${field} has no source row` };
  const newerThanStatus = !statusRow || driving.updatedAt.getTime() > statusRow.updatedAt.getTime();

  if (driving.source === 'ADMIN') {
    return newerThanStatus
      ? { allowed: true, reason: `ADMIN set ${field}` }
      : { allowed: false, cause: `the ADMIN ${field} predates the status (${statusRow?.source})` };
  }
  if (String(from).toUpperCase() === 'LISTED') {
    return { allowed: false, cause: 'LISTED never regresses without an ADMIN row' };
  }
  if (!EXCHANGE_SOURCES.has(driving.source)) {
    return { allowed: false, cause: `${field} is from ${driving.source}, not an exchange` };
  }
  const current = dates[field]?.slice(0, 10) ?? null;
  const previous = driving.previousValue?.slice(0, 10) ?? null;
  if (!current || !previous || !(previous < current)) {
    return {
      allowed: false,
      cause: `the exchange did not move ${field} later (previous=${previous ?? 'none'}, now=${current ?? 'none'})`,
    };
  }
  if (!newerThanStatus) {
    return { allowed: false, cause: `the new ${field} predates the status (${statusRow?.source})` };
  }
  return { allowed: true, reason: `relaunch: ${driving.source} moved ${field} ${previous} -> ${current}` };
}

const LADDER_EVIDENCE_FIELDS = ['status', 'openDate', 'closeDate', 'listingDate'];

export type StatusEvidenceLoader = (ipoId: string) => Promise<StatusEvidence[]>;

function dbEvidenceLoader(db: Awaited<ReturnType<typeof getDb>>): StatusEvidenceLoader {
  return async (ipoId) => {
    const rows = await db
      .select({
        fieldName: fieldSources.fieldName,
        source: fieldSources.source,
        previousValue: fieldSources.previousValue,
        updatedAt: fieldSources.updatedAt,
      })
      .from(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, ipoId),
          eq(fieldSources.tableName, 'ipos'),
          eq(fieldSources.rowKey, ''),
          inArray(fieldSources.fieldName, LADDER_EVIDENCE_FIELDS)
        )
      );
    return rows.map((r) => ({ ...r, source: String(r.source) }));
  };
}

export interface StatusUpdateResult {
  upcomingToOpen: number;
  openToClosed: number;
  closedToListed: number;
  total: number;
  /** #1256: backward moves the ladder computed but refused (no newer exchange window, no ADMIN). */
  refusedBackward: number;
  /**
   * Pages actually refreshed for this batch of transitions.
   *
   * Reported next to `total` ON PURPOSE: the scraper logs this whole result
   * object every cycle, so `total: 3, pagesRevalidated: 0` is a visible
   * mismatch in a line a human already reads. Without it, a transition whose
   * page was never refreshed leaves no trace anywhere — which is exactly how
   * this defect survived: nothing in the database is wrong, so no data audit
   * could ever have found it.
   */
  pagesRevalidated: number;
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
/**
 * Refresh the pages a reader actually sees after a status flip.
 *
 * Separated from `updateIPOStatuses` so it is testable without a database:
 * the same reason `revalidateForSlugs` takes its own dependencies.
 *
 * Deliberately never throws. By the time this runs the transition is already
 * committed, so a failed refresh means the page waits out its timer — which is
 * exactly the behaviour before this existed. Throwing would abort the rest of
 * the status update and lose the report the caller returns.
 */
export async function revalidateAfterStatusChange(
  slugs: string[],
  deps: { redis: { del(key: string): Promise<unknown> }; revalidatePath: (path: string) => void }
): Promise<number> {
  if (slugs.length === 0) return 0;
  try {
    const outcome = await revalidateForSlugs(slugs, deps);
    return outcome.revalidated;
  } catch (error) {
    console.error('[Status Updater] page revalidation failed (non-fatal):', error);
    return 0;
  }
}

export async function updateIPOStatuses(
  deps?: { revalidatePath?: (path: string) => void; now?: Date; loadEvidence?: StatusEvidenceLoader }
): Promise<StatusUpdateResult> {
  console.log('[Status Updater] Starting status update...');

  const db = await getDb();
  const redis = getRedisClient();
  const conflictsRepo = new DataConflictsRepository(db, redis);
  const now = deps?.now ?? new Date();
  // GitHub #682: open_date/close_date/listing_date are IST calendar dates;
  // the UTC calendar day was wrong for up to 5h30m a day (00:00-05:30 IST).
  const today = istDateIso(now);
  const loadEvidence = deps?.loadEvidence ?? dbEvidenceLoader(db);

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
  let pagesRevalidated = 0;
  let refusedBackward = 0;

  for (const r of rows) {
    if (r.scraperLocked) continue; // respect manual lock
    if (isTerminalStatus(r.status)) continue; // W-41: never downgrade WITHDRAWN/POSTPONED
    const target = computeTargetStatus(
      { openDate: r.openDate, closeDate: r.closeDate, listingDate: r.listingDate },
      today
    );
    if (!target || target === r.status) continue;

    // #1256: spec row 8 — never regress without a newer exchange window (OD-83) or an ADMIN row.
    if (isBackwardMove(r.status, target)) {
      const decision = decideBackwardMove(
        r.status,
        target,
        { openDate: r.openDate, closeDate: r.closeDate, listingDate: r.listingDate },
        await loadEvidence(r.id)
      );
      if (!decision.allowed) {
        refusedBackward++;
        console.warn(
          `[Status Updater] refuse_backward_transition: ${r.companyName} (${r.id}) ${r.status} -> ${target} refused — ${decision.cause}`
        );
        continue;
      }
      console.log(
        `[Status Updater] backward_transition_allowed: ${r.companyName} (${r.id}) ${r.status} -> ${target} — ${decision.reason}`
      );
    }

    // T-328: refuse to flip status when the field driving this transition
    // has an unresolved HIGH_VALUE dispute for this IPO — belt-and-suspenders
    // alongside the scraper-side HOLD (data-consolidation-service.ts).
    const drivingField = getTransitionDrivingField(r.status as IPOStatus, target);
    if (drivingField) {
      const unresolved = await conflictsRepo.findUnresolvedForIPO(r.id);
      if (isTransitionHeld(drivingField, unresolved)) {
        const disputed = unresolved.find((c) => c.fieldName === drivingField && isBehaviourConflict(c))!;
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
        await redis.del(getIPOBySlugKey(slug));
        await redis.del(getIPOByIdKey(id));
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

    // Item 21: clearing Redis is the DATA layer only. The pages are statically
    // generated on a timer (CacheTTL.IPO_LISTINGS is commented "matches page
    // ISR revalidation"), so the rendered HTML keeps being served until that
    // timer expires regardless of what Redis holds. An IPO would close, the
    // database would say CLOSED within the minute, and the site would keep
    // telling readers it was OPEN for up to another fifteen minutes.
    //
    // This was the one write path that never reached the refresh mechanism
    // item 21 built, and it is the most visible change on the page. It could
    // not reach it from outside: the scraper marks IPOs touched in memory in
    // its OWN process, while the transition is applied here, in the web app,
    // behind /api/admin/status/update.
    //
    // `revalidatePath` is injected rather than imported so this service stays
    // callable from scripts and tests that have no Next request context; the
    // route supplies the real one.
    if (deps?.revalidatePath) {
      pagesRevalidated = await revalidateAfterStatusChange(
        changedSlugs.map((c) => c.slug),
        { redis, revalidatePath: deps.revalidatePath }
      );
    }
  }

  const countTransition = (from: string, to: string) =>
    updatedIPOs.filter((u) => u.oldStatus === from && u.newStatus === to).length;

  const result: StatusUpdateResult = {
    upcomingToOpen: countTransition('UPCOMING', 'OPEN'),
    openToClosed: countTransition('OPEN', 'CLOSED'),
    closedToListed: countTransition('CLOSED', 'LISTED'),
    total: updatedIPOs.length,
    refusedBackward,
    pagesRevalidated,
    updatedIPOs,
  };

  console.log('[Status Updater] Completed:', { total: result.total, refusedBackward, istDay: today });
  return result;
}

/**
 * Count IPOs whose stored status differs from their computed target status
 * (i.e. how many updateIPOStatuses would change), for monitoring. Read-only.
 */
export async function getOutdatedStatusCount(now: Date = new Date()): Promise<{
  upcomingToOpen: number;
  openToClosed: number;
  closedToListed: number;
  total: number;
}> {
  const db = await getDb();
  // GitHub #682: same IST-day fix as updateIPOStatuses — this must agree with
  // it or the monitor and the writer disagree about what's "outdated".
  const today = istDateIso(now);

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
    if (isTerminalStatus(r.status)) continue; // W-41: terminal rows are not "outdated"
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
