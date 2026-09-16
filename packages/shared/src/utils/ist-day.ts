/**
 * IST calendar-day helper for packages/shared.
 *
 * packages/shared cannot import from web or scraper (separate workspace
 * packages), so this mirrors web/lib/utils/ist-date.ts istDateIso() /
 * scraper/src/scheduler/due-step-cycle.ts istDateIso() exactly: an
 * offset-shifted instant read with UTC getters, never `.toISOString()` on a
 * local-midnight parse.
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
