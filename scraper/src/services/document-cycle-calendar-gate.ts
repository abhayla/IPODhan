/**
 * Cadence decision D-13 (owner, 2026-09-03): a Sunday or NSE-holiday wake does
 * DB reads and NO network calls for CLOSED/LISTED/WITHDRAWN candidates — only
 * UPCOMING/PRE_OPEN/OPEN candidates (still moving toward listing, so a filing
 * genuinely could appear) stay eligible for network work. See
 * `docs/scraper/due-step-scheduling.md` for the full cadence writeup.
 *
 * **Assumption:** Saturday is treated the same as Sunday. Nothing in this repo's
 * IST calendar helpers (`due-step-cycle.ts`) treats Saturday as a trading day
 * (market hours are Mon-Fri only), so gating it the same way is consistent with
 * the existing calendar, not a new claim about NSE's own weekend schedule.
 *
 * Kept as its own module (not inlined in `document-cycle.ts`, already 1300+
 * lines) so the pure weekday half is trivially unit-testable, and the
 * DB-backed holiday half is swappable via `HolidayLookup` for the same reason.
 */
import { istWeekday, istDateIso } from '../scheduler/due-step-cycle.js';
import { db, getRedisClient } from '@ipodhan/shared';
import { MarketHolidayRepository } from '@ipodhan/shared/repositories';
import logger from '../utils/logger.js';

export type CalendarGateReason = 'sunday' | 'saturday' | 'holiday';

export interface CalendarGate {
  /** true = live-only mode: only UPCOMING/PRE_OPEN/OPEN candidates get network work. */
  gated: boolean;
  reason: CalendarGateReason | null;
}

export interface HolidayLookup {
  /** @param dateIso "YYYY-MM-DD" in IST */
  isHoliday(dateIso: string): Promise<boolean>;
}

/** Production lookup — reads the `market_holidays` table (Story 5.4). */
export const defaultHolidayLookup: HolidayLookup = {
  async isHoliday(dateIso: string): Promise<boolean> {
    const redis = getRedisClient();
    const repo = new MarketHolidayRepository(db as never, redis as never);
    const rows = await repo.findByDateRange(dateIso, dateIso);
    return rows.some((r) => r.exchange === 'NSE' || r.exchange === 'BOTH');
  },
};

/** Pure — the weekend half of the gate. No I/O, so this is the fast/free check. */
export function weekendGateReason(now: Date): 'sunday' | 'saturday' | null {
  const weekday = istWeekday(now);
  if (weekday === 0) return 'sunday';
  if (weekday === 6) return 'saturday';
  return null;
}

/**
 * Weekend check first (free, no I/O) — only a Mon-Fri wake pays for the
 * holiday-table read. A holiday-lookup failure fails OPEN (treated as a normal
 * trading day): a lookup outage must never silently starve a live cycle on a
 * real business day.
 */
export async function computeCalendarGate(
  now: Date,
  holidayLookup: HolidayLookup = defaultHolidayLookup
): Promise<CalendarGate> {
  const weekendReason = weekendGateReason(now);
  if (weekendReason) return { gated: true, reason: weekendReason };

  try {
    const isHoliday = await holidayLookup.isHoliday(istDateIso(now));
    if (isHoliday) return { gated: true, reason: 'holiday' };
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Document cycle: holiday lookup failed — failing open (treating today as a trading day)'
    );
  }
  return { gated: false, reason: null };
}

/** Stages still eligible for network work on a calendar-gated wake. */
export const CALENDAR_GATE_ELIGIBLE_STAGES = new Set(['UPCOMING', 'PRE_OPEN', 'OPEN']);
