/**
 * THE IST calendar-day helper for the whole monorepo (#687 slice 4).
 *
 * Every TypeScript caller derives the IST day from this one function:
 * web imports it through the package exports map as
 * `@ipodhan/shared/utils/ist-day` (re-exported under its historical name by
 * web/lib/utils/ist-date.ts), and scraper's
 * scheduler/due-step-cycle.ts istDateIso() is a thin wrapper over it.
 * scripts/lib/ist-day.mjs is the one deliberate duplicate — plain Node
 * cannot import TypeScript — and scripts/tests/ist-day.test.mjs pins it to
 * the same outputs.
 *
 * An offset-shifted instant read with UTC getters, never `.toISOString()` on
 * a local-midnight parse (which would be the UTC day, the #687 bug class).
 *
 * #687 slice 3: MarketHolidayRepository derived "today" from the UTC
 * calendar day (`new Date().toISOString().split('T')[0]`). Between 00:00 and
 * 05:30 IST the UTC day is still "yesterday", so "is today a holiday" /
 * "next trading day" answers were wrong for up to 5h30m every day.
 *
 * @module packages/shared/src/utils/ist-day
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** "YYYY-MM-DD" for `now` in IST (Asia/Kolkata, UTC+5:30, no DST). */
export function istDayIso(now: Date = new Date()): string {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
