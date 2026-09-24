/**
 * OD-72 (owner, 2026-09-23, "Facts, no marker"): a scheduled live refresh that
 * misses its OD-19 slot raises an ADMIN alert naming the IPO and the slot --
 * never a label on the public page.
 *
 * THE SLOT. OD-19 lets subscription work run "every hour or even thirty
 * minutes"; spec section 2.1's job table fixes the live-figures job at every 30
 * minutes, 10:00-18:30 IST, on a day an IPO is bidding (OD-28). So a bidding day
 * has 17 half-hour slots, [10:00, 10:30) ... [18:00, 18:30) IST.
 *
 * THE MISS. An IPO that is bidding on the slot's day (open_date <= day <=
 * close_date, a weekday that is not a market holiday) and has NO subscription
 * snapshot whose time falls inside the slot. The snapshot time is the SOURCE's
 * observation time (subscriptions.timestamp, W-38), so a slot counts as covered
 * only when the reader's figure actually advanced in it -- a fetch that ran and
 * stored nothing (source did not list the IPO, regression guard, stale time)
 * is a miss, which is what the reader experiences.
 *
 * Measured on staging 2026-09-24 before this was built (read-only): of 20 live
 * IPOs, 11 had all of 17 slots covered, while anand-seamless-ltd (SME) had 0 of
 * 17, himalaya-nutravedics-india-ltd 2 of 17 and s-k-offset-ltd 5 of 17.
 *
 * ONCE PER MISS. Each live wake evaluates the most recent COMPLETED slot, sends
 * one alert for that slot listing every IPO that missed it, and claims the
 * slot with a Redis NX marker first, so a second wake in the same half hour (a
 * manual wake, a retry) never sends it twice. The Notifier dedupeKey is the
 * same slot key, a second line of defence.
 */
import { sql } from 'drizzle-orm';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import { notifyOwner } from './owner-notify.js';
import { logger } from '../utils/logger.js';

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const SLOT_MINUTES = 30;
/** Minutes after IST midnight at which each live slot STARTS: 10:00 .. 18:00. */
export const LIVE_SLOT_STARTS_IST_MINUTES: readonly number[] = Array.from(
  { length: 17 },
  (_, i) => 10 * 60 + i * SLOT_MINUTES
);

export interface LiveSlot {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  /** "10:00" .. "18:00", IST: the slot's start. */
  label: string;
  /** "10:30" .. "18:30", IST: the slot's end. */
  endLabel: string;
  startUtc: Date;
  endUtc: Date;
  /** Stable id for dedupe: "2026-09-24T10:00". */
  key: string;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The most recent live slot that has fully ENDED at `now`, on today's IST date;
 * null before 10:30 IST (no slot of today has ended yet).
 */
export function lastCompletedLiveSlot(now: Date): LiveSlot | null {
  const istMs = now.getTime() + IST_OFFSET_MS;
  const dayStartIstMs = Math.floor(istMs / 86_400_000) * 86_400_000;
  const minuteOfDay = Math.floor((istMs - dayStartIstMs) / 60_000);
  let start: number | null = null;
  for (const s of LIVE_SLOT_STARTS_IST_MINUTES) {
    if (s + SLOT_MINUTES <= minuteOfDay) start = s;
  }
  if (start === null) return null;
  const day = istDayIso(now);
  const startUtc = new Date(dayStartIstMs + start * 60_000 - IST_OFFSET_MS);
  return {
    day,
    label: hhmm(start),
    endLabel: hhmm(start + SLOT_MINUTES),
    startUtc,
    endUtc: new Date(startUtc.getTime() + SLOT_MINUTES * 60_000),
    key: `${day}T${hhmm(start)}`,
  };
}

export interface BiddingIpo {
  id: string;
  slug: string;
  companyName: string;
}

/** Everything the check reads, injected so the rule is testable without a database. */
export interface LiveSlotMissDeps {
  now?: Date;
  /** IPOs bidding on `slot.day` (trading day already applied), each with whether a snapshot landed inside the slot. */
  loadCoverage(slot: LiveSlot): Promise<Array<BiddingIpo & { covered: boolean }>>;
  /** True the FIRST time a slot key is claimed; false on every later call. */
  claimSlotOnce(key: string): Promise<boolean>;
  notify?: typeof notifyOwner;
}

export interface LiveSlotMissResult {
  slot: string | null;
  checked: number;
  missed: string[];
  alerted: boolean;
  reason?: string;
}

export async function checkLiveSlotMisses(deps: LiveSlotMissDeps): Promise<LiveSlotMissResult> {
  const now = deps.now ?? new Date();
  const slot = lastCompletedLiveSlot(now);
  if (!slot) return { slot: null, checked: 0, missed: [], alerted: false, reason: 'no live slot of today has ended yet' };

  const coverage = await deps.loadCoverage(slot);
  const missed = coverage.filter((c) => !c.covered);
  if (missed.length === 0) {
    return { slot: slot.key, checked: coverage.length, missed: [], alerted: false, reason: 'every bidding IPO was refreshed in this slot' };
  }

  if (!(await deps.claimSlotOnce(`live-slot-miss:${slot.key}`))) {
    return {
      slot: slot.key,
      checked: coverage.length,
      missed: missed.map((m) => m.slug),
      alerted: false,
      reason: 'this slot was already alerted by an earlier wake',
    };
  }

  const notify = deps.notify ?? notifyOwner;
  notify('P2', `Live refresh missed the ${slot.label} IST slot on ${slot.day}: ${missed.length} IPO(s)`, {
    type: 'live-slot-miss',
    dedupeKey: `live-slot-miss:${slot.key}`,
    body: missed
      .map(
        (m) =>
          `${m.companyName} (${m.slug}): no subscription figure dated inside ${slot.label}-${slot.endLabel} IST ${slot.day} ` +
          '(the source listed no newer figure, the fetch failed, or the write was refused)'
      )
      .join('\n'),
  });
  logger.warn(
    { slot: slot.key, missed: missed.map((m) => m.slug), checked: coverage.length },
    'Live-slot miss: admin alert sent (OD-72) - named IPOs had no subscription figure inside the slot'
  );
  return { slot: slot.key, checked: coverage.length, missed: missed.map((m) => m.slug), alerted: true };
}

/**
 * The database half: IPOs bidding on the slot's IST day, and whether each has a
 * subscription snapshot dated inside the slot. A weekend or a market holiday
 * returns no IPO -- nothing bids, so nothing can be missed. Timestamps are
 * bound as ISO strings (ist-timezone rule: never a Date object to a naive column).
 */
export function dbCoverageLoader(db: { execute(q: ReturnType<typeof sql>): Promise<unknown> }) {
  return async (slot: LiveSlot): Promise<Array<BiddingIpo & { covered: boolean }>> => {
    const result = await db.execute(sql`
      SELECT i.id, i.slug, i.company_name,
             EXISTS (
               SELECT 1 FROM subscriptions s
               WHERE s.ipo_id = i.id
                 AND s.timestamp >= ${slot.startUtc.toISOString()}::timestamptz
                 AND s.timestamp <  ${slot.endUtc.toISOString()}::timestamptz
             ) AS covered
      FROM ipos i
      WHERE i.status IN ('OPEN', 'CLOSED')
        AND i.open_date <= ${slot.day}::date
        AND i.close_date >= ${slot.day}::date
        AND EXTRACT(ISODOW FROM ${slot.day}::date) < 6
        AND NOT EXISTS (SELECT 1 FROM market_holidays h WHERE h.date = ${slot.day}::date)
      ORDER BY i.slug
    `);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    return rows.map((r) => ({
      id: r.id as string,
      slug: r.slug as string,
      companyName: (r.company_name as string) ?? (r.slug as string),
      covered: r.covered === true,
    }));
  };
}

/** Redis NX claim, two days: long enough to outlive every wake of the slot's day. */
export function redisSlotClaimer(redis: { set(...args: unknown[]): Promise<unknown> }) {
  return async (key: string): Promise<boolean> => (await redis.set(key, '1', 'EX', 172_800, 'NX')) === 'OK';
}
