/**
 * S-02 §5: pure decision logic for the "due-step" cycle
 * (`ENABLE_DUE_STEP_SCHEDULER`). Every function here is a deterministic,
 * clock-injectable predicate — no I/O — so the slot/market-hours arithmetic
 * can be unit-tested without a fake clock hack on the process timezone.
 *
 * IST is a fixed UTC+5:30 offset (no DST) — all "IST" comparisons below
 * compute IST wall-clock minutes from the (timezone-agnostic) epoch instant
 * rather than depending on the process's local timezone.
 */

import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import {
  DATA_JOB_SLOTS_IST_MINUTES,
  isDataJobDue,
  mostRecentDataJobSlotEpochMinute,
} from '@ipodhan/shared/scheduler/data-job-slots';

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * The data job's slots (spec §2.1, OD-19: 00:00, 08:00, 14:00 IST), which
 * supersede D-13's four. Defined ONCE in
 * packages/shared/src/scheduler/data-job-slots.ts; this is that same array,
 * re-exported under the name the scraper's callers already use.
 */
export const DISCOVERY_SLOTS_IST_MINUTES = DATA_JOB_SLOTS_IST_MINUTES;

interface IstClock {
  /** Days since the Unix epoch, in IST. */
  dayIndex: number;
  /** Minutes since IST midnight (0-1439). */
  minutesOfDay: number;
  /** 0 = Sunday .. 6 = Saturday, in IST. */
  weekday: number;
}

function toIstClock(now: Date): IstClock {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const istDate = new Date(istMs);
  const dayIndex = Math.floor(istMs / 86_400_000);
  const minutesOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  const weekday = istDate.getUTCDay();
  return { dayIndex, minutesOfDay, weekday };
}

/** Absolute minute (since epoch, IST-aligned) of the most recent data-job slot at-or-before `now`. */
export function mostRecentDiscoverySlotEpochMinute(now: Date): number {
  return mostRecentDataJobSlotEpochMinute(now);
}

/** Human-readable "HH:MM IST" label for a discovery slot, for logging. */
export function formatIstSlot(slotMinutesOfDay: number): string {
  const h = Math.floor(slotMinutesOfDay / 60);
  const m = slotMinutesOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} IST`;
}

/**
 * The data job (discovery, document download + extraction, the pull walk) is
 * due when the most recent slot at-or-before `now` is strictly after
 * `lastRunAt` (or it never ran). Catch-up-safe: a missed slot (process down,
 * a run that did not finish) fires on the next wake that observes it instead
 * of waiting for the same slot tomorrow. Outside that, a wake does no
 * data-job work (spec §2.1: "never re-read a document because time passed").
 */
export function isDiscoveryDue(now: Date, lastRunAt: Date | null): boolean {
  return isDataJobDue(now, lastRunAt);
}

/** For logging: the slot-of-day label the most recent due boundary corresponds to. */
export function mostRecentDiscoverySlotLabel(now: Date): string {
  const epochMinute = mostRecentDiscoverySlotEpochMinute(now);
  const slotOfDay = ((epochMinute % 1440) + 1440) % 1440;
  return formatIstSlot(slotOfDay);
}

/** Weekday market hours: Mon-Fri (IST weekday 1-5), 10:00-17:00 IST inclusive-start/exclusive-end. */
export function isMarketHoursIST(now: Date): boolean {
  const { weekday, minutesOfDay } = toIstClock(now);
  const isWeekday = weekday >= 1 && weekday <= 5;
  const inWindow = minutesOfDay >= 10 * 60 && minutesOfDay < 17 * 60;
  return isWeekday && inWindow;
}

/**
 * Item 7 S1: the live-figures job's bidding window (spec
 * docs/design/data-sourcing-pull-model.md §2.1 job table, OD-28) — subscription
 * and the demand graph run "every 30 minutes, 10:00–18:30, only on a day when
 * at least one IPO is OPEN". Both ends are inclusive, so the 18:30 wake reads
 * the day's final figure. 18:30 is the spec's number, not isMarketHoursIST's
 * 17:00: the exchanges keep publishing the day's final bid figures after the
 * 17:00 close of bidding.
 *
 * No weekday filter (round 1, Tier A finding): the spec's day gate is "a day
 * when at least one IPO is OPEN", and the caller already checks that an IPO is
 * OPEN. An IPO stays OPEN across a weekend, so a Mon–Fri filter was a rule the
 * spec does not state. On a non-bidding day the fetch returns an unchanged
 * figure and the snapshot writer's own guards keep it from regressing.
 */
export function isBiddingHoursIST(now: Date): boolean {
  const { minutesOfDay } = toIstClock(now);
  return minutesOfDay >= 10 * 60 && minutesOfDay <= 18 * 60 + 30;
}

/**
 * 0 = Sunday .. 6 = Saturday, in IST — exported so other cadence-gated code
 * (the document cycle's Sunday/Saturday calendar gate, T-cadence-D13) reuses
 * this module's IST calendar arithmetic instead of re-deriving it.
 */
export function istWeekday(now: Date): number {
  return toIstClock(now).weekday;
}

/**
 * "YYYY-MM-DD" for `now` in IST — matches the `market_holidays.date` column
 * format. #687 slice 4: the arithmetic now lives ONCE, in
 * packages/shared/src/utils/ist-day.ts; this wrapper keeps the `istDateIso`
 * name its 20+ scraper callers already import. The shared helper is built
 * from UTC getters on an already-IST-shifted epoch instant (never
 * `.toISOString()` on it), so this still never trips the T-327 naive-parse
 * ratchet (`date-tz-parse-ratchet.test.ts`).
 */
export function istDateIso(now: Date): string {
  return istDayIso(now);
}
