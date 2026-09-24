/**
 * Item 7 S4 (spec docs/design/data-sourcing-pull-model.md §2.1 job table row
 * "Opening-day check", OD-31): pure decision logic for the opening-day
 * check.
 *
 * WHY THIS JOB EXISTS (§2.1): "The 08:00 data job can run before either
 * exchange has published the day's opening list, and the next data job is at
 * 14:00 — so an IPO that opens at 10:00 could be invisible on the site for
 * the first four hours of its own bidding window." The fix is
 * discovery-only: fetch the two exchange lists, register anything new or
 * changed, and stop. It downloads nothing and extracts nothing, which is why
 * it is safe to run on a clock without violating "offer document never on a
 * clock" (§2.1, "One download, one read").
 *
 * This module owns only the GATE (is today a day an IPO opens?) as a pure,
 * clock-injectable predicate, same shape as `due-step-cycle.ts` and
 * `closed-ipo-job.ts`'s own due-checks. The caller (scraper/src/index.ts,
 * `runOpeningDayCheckWake`) owns the lock, the NSE/BSE calls and the log
 * lines.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';

/**
 * The check's scheduled time (§2.1, OD-31): 09:45 IST is a MEASURED number
 * only once three real opening-day observations exist in
 * `docs/design/probes/exchange-list-change-time.out.json` — as of that
 * file's last run (2026-09-09, `insufficient`, 0/3 observations) it is
 * PROVISIONAL. The number itself is not read from that file at runtime (it
 * is a probe log, not a config source) — this constant is the single named
 * home for it so a future probe result changes ONE line, cited here rather
 * than re-typed at each cron/wrapper call site.
 *
 * PROVISIONAL — see docs/design/probes/exchange-list-change-time.out.json.
 */
export const OPENING_DAY_CHECK_TIME_IST_MINUTES = 9 * 60 + 45;

/**
 * `ipos.status` values the gate treats as "an IPO opening today would be
 * findable under". A row already OPEN, CLOSED or LISTED is not "opening
 * today" in the sense this check exists for (§2.1: "register a new or
 * changed IPO so the live jobs can see it") — the check exists for the
 * UPCOMING row whose `open_date` is today and which the exchanges have not
 * yet reflected as OPEN in our own data. Read broadly (any status) so a row
 * whose status transition is itself late does not hide it from the gate;
 * the gate only asks "does today's IST date match an open_date", never
 * filters by status.
 */

/**
 * True when the STORED `ipos` table already has a row whose `open_date`
 * equals `now`'s IST calendar date.
 *
 * §2.1: "only on a day an IPO is due to open (OD-31)". `open_date` is a
 * plain SQL `date` column (packages/shared/src/db/schema.ts:293) — a
 * calendar date with no time-of-day and no timezone attached, so the
 * comparison is a same-day string/date match against the IST calendar date,
 * never a UTC-instant comparison (`.claude/rules/ist-timezone.md`: "Every
 * date the platform publishes is the Indian market date").
 *
 * Review finding 1 (CRITICAL): this predicate alone MUST NOT be used to
 * decide whether to fetch — a DB row can only equal today if a PRIOR job
 * already stored it, so an IPO with NO row yet, a NULL `open_date`, or a
 * stale/postponed `open_date` would never trip this and the check would
 * silently never run for exactly the IPOs it exists to catch (§2.1's own
 * example: "an IPO that opens at 10:00 could be invisible on the site").
 * The caller (`runOpeningDayCheckWake`, scraper/src/index.ts) fetches BOTH
 * exchange lists UNCONDITIONALLY at the scheduled time and only uses this
 * predicate AFTER that fetch+write, to decide what to log — never to decide
 * whether to fetch. `opensTodayFromFetch` below is the equivalent pure,
 * clock-injectable decision over fetched + stored rows, kept for callers
 * that have the raw rows in hand rather than a freshly-written DB to re-read.
 */
export async function anyIpoOpensToday(
  db: NodePgDatabase<typeof schema>,
  now: Date = new Date()
): Promise<boolean> {
  const todayIso = istDayIso(now);
  const [row] = await db
    .select({ id: schema.ipos.id })
    .from(schema.ipos)
    .where(eq(schema.ipos.openDate, todayIso))
    .limit(1);
  return row !== undefined;
}

/**
 * Row shape common to both exchanges' list-fetch results, narrowed to the
 * one field this gate reads (`openDate`, an ISO `YYYY-MM-DD` string or
 * undefined/null when the source did not report one).
 */
export interface FetchedListRow {
  openDate?: string | null;
}

/**
 * Pure decision: does at least one row — from the freshly FETCHED exchange
 * lists, OR already stored in the DB — open today (IST)? This is the actual
 * opening-day gate (review finding 1): it does not require a pre-existing DB
 * row, because the fetched rows are exactly the signal the DB does not have
 * yet for a brand-new IPO, a NULL `open_date` row, or a stale/postponed
 * `open_date` row the exchange has since corrected.
 *
 * Pure and clock-injectable (no I/O) so the mutation-proof test (review
 * finding 3) can assert against a fixed `now` without a live DB or network.
 */
export function opensTodayFromFetch(
  fetchedRows: readonly FetchedListRow[],
  storedRows: readonly FetchedListRow[],
  now: Date = new Date()
): boolean {
  const todayIso = istDayIso(now);
  const opensToday = (row: FetchedListRow): boolean => row.openDate === todayIso;
  return fetchedRows.some(opensToday) || storedRows.some(opensToday);
}

/**
 * Diagnostic variant of `anyIpoOpensToday` for the dry-run proof (this
 * item's Core): names the rows instead of only a boolean, so the proof
 * output can print identities per signal-ownership R1 ("a number is not a
 * reading").
 */
export async function iposOpeningToday(
  db: NodePgDatabase<typeof schema>,
  now: Date = new Date()
): Promise<Array<{ id: string; companyName: string; status: string; openDate: string | null }>> {
  const todayIso = istDayIso(now);
  return db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      status: schema.ipos.status,
      openDate: schema.ipos.openDate,
    })
    .from(schema.ipos)
    .where(eq(schema.ipos.openDate, todayIso));
}
