/**
 * IST calendar-day helper.
 *
 * web cannot import from scraper (separate workspace package), so this
 * mirrors scraper/src/scheduler/due-step-cycle.ts istDateIso() exactly: an
 * offset-shifted instant read with UTC getters, never `.toISOString()` on a
 * local-midnight parse, so it can't trip the T-327 naive-parse ratchet.
 *
 * GitHub #682: the status updater derived "today" from the UTC calendar day
 * (`now.toISOString().split('T')[0]`) and compared it against IST calendar
 * dates (open_date/close_date/listing_date). Between 00:00 and 05:30 IST the
 * UTC day is still "yesterday", so every IPO whose transition boundary fell on
 * that day was computed against the wrong day for up to 5h30m.
 *
 * @module web/lib/utils/ist-date
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** "YYYY-MM-DD" for `now` in IST (Asia/Kolkata, UTC+5:30, no DST). */
export function istDateIso(now: Date): string {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
