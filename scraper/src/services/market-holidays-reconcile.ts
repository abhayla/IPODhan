/**
 * Reconcile one year of market_holidays to NSE's own trading-holiday list (F-220, F-221, #1380).
 *
 * Spec: docs/design/data-sourcing-pull-model.md §4.6 ("working_days_inclusive, defined once" —
 * "the exchange holiday calendar") and OD-21 (§5.3): the working-day rules count against this
 * table, so it must hold the exchange's list, not a typed festival calendar. NSE and BSE trading
 * holidays are one set (F-220); the reconciled year is stored as BOTH/TRADING rows, which the
 * TradingCalendar of #1380 reads (TRADING rows of every exchange, keyed by the row DATE's year).
 *
 * Every NSE answer state and what it does (spec-verified-recommendations rule 10), implemented in
 * scripts/lib/nse-holiday-calendar.mjs and tested in
 * scraper/tests/integration/market-holidays-reconcile.integration.test.ts:
 *   list              -> reconcile Y: insert / move / relabel / retire, ONE transaction, re-read
 *   fetch-failed      -> nothing changed, exit 3 with the cause
 *   malformed         -> nothing changed, exit 3 with the cause
 *   no-rows-for-year  -> nothing changed for Y, exit 4
 *   unparseable-rows  -> nothing changed for Y, exit 5, rows printed
 */
import { sql } from 'drizzle-orm';
import {
  compareYearToNse,
  formatHolidayAction,
  interpretNseHolidayAnswer,
  planHolidayReconcile,
} from '../../../scripts/lib/nse-holiday-calendar.mjs';

export type NseFetchResult = { ok: true; body: string } | { ok: false; cause: string };

export interface HolidayAction {
  kind: 'insert' | 'move' | 'update' | 'retire';
  id?: string;
  date: string;
  from?: string;
  description: string;
  before?: string;
  exchange?: string;
  exchangeBefore?: string;
  why?: string;
}

export interface StoredHolidayRow {
  id: string;
  date: string;
  description: string;
  exchange: string;
}

export interface ReconcileOutcome {
  /** 0 done (or dry run planned); 3 NSE unreadable; 4 no rows for the year; 5 unparseable rows. */
  exitCode: 0 | 3 | 4 | 5;
  state: 'list' | 'fetch-failed' | 'malformed' | 'no-rows-for-year' | 'unparseable-rows';
  cause?: string;
  actions: HolidayAction[];
  applied: boolean;
  nseDates: string[];
}

interface ExecuteLike {
  execute: (query: unknown) => Promise<unknown>;
  transaction?: <T>(fn: (tx: ExecuteLike) => Promise<T>) => Promise<T>;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

/** TRADING rows dated in `year`, every exchange label (date returned as text, never as a Date). */
export async function readTradingRowsForYear(db: ExecuteLike, year: number): Promise<StoredHolidayRow[]> {
  const result = await db.execute(sql`
    SELECT id::text AS id, to_char(date, 'YYYY-MM-DD') AS date, description, exchange::text AS exchange
      FROM market_holidays
     WHERE type = 'TRADING'
       AND date >= ${`${year}-01-01`}::date AND date <= ${`${year}-12-31`}::date
     ORDER BY date, id`);
  return rowsOf<StoredHolidayRow>(result);
}

async function applyActions(tx: ExecuteLike, year: number, actions: HolidayAction[]): Promise<void> {
  for (const a of actions) {
    if (a.kind === 'retire') {
      await tx.execute(sql`DELETE FROM market_holidays WHERE id = ${a.id}::uuid`);
    } else if (a.kind === 'move' || a.kind === 'update') {
      await tx.execute(sql`
        UPDATE market_holidays
           SET date = ${a.date}::date, description = ${a.description}, exchange = 'BOTH', year = ${year},
               updated_at = now()
         WHERE id = ${a.id}::uuid`);
    } else {
      await tx.execute(sql`
        INSERT INTO market_holidays (date, description, exchange, type, year)
        VALUES (${a.date}::date, ${a.description}, 'BOTH', 'TRADING', ${year})`);
    }
  }
}

export async function reconcileMarketHolidayYear(input: {
  db: ExecuteLike;
  year: number;
  apply: boolean;
  answer: NseFetchResult;
  log?: (line: string) => void;
  /** Test seam: runs inside the transaction after the writes, before the re-read assertion. */
  afterWrites?: (tx: ExecuteLike) => Promise<void>;
}): Promise<ReconcileOutcome> {
  const log = input.log ?? ((l: string) => console.log(l));
  const { db, year, apply } = input;

  if (input.answer.ok === false) {
    const { cause } = input.answer as { ok: false; cause: string };
    log(`NSE answer: fetch-failed — ${cause}. Nothing changed.`);
    return { exitCode: 3, state: 'fetch-failed', cause, actions: [], applied: false, nseDates: [] };
  }
  const answer = interpretNseHolidayAnswer((input.answer as { ok: true; body: string }).body, year) as
    | { state: 'list'; holidays: Array<{ date: string; description: string; weekday: string }> }
    | { state: 'malformed'; cause: string }
    | { state: 'no-rows-for-year'; yearsPresent: number[] }
    | { state: 'unparseable-rows'; rows: unknown[] };

  if (answer.state === 'malformed') {
    log(`NSE answer: malformed — ${answer.cause}. Nothing changed.`);
    return { exitCode: 3, state: 'malformed', cause: answer.cause, actions: [], applied: false, nseDates: [] };
  }
  if (answer.state === 'no-rows-for-year') {
    const cause = `NSE lists no CM trading holiday dated ${year} (years present: ${answer.yearsPresent.join(', ') || 'none'}); a year NSE has not published is not "no holidays".`;
    log(`NSE answer: no-rows-for-year — ${cause} Nothing changed for ${year}.`);
    return { exitCode: 4, state: 'no-rows-for-year', cause, actions: [], applied: false, nseDates: [] };
  }
  if (answer.state === 'unparseable-rows') {
    const cause = `${answer.rows.length} CM row(s) for ${year} have a date that does not parse: ${JSON.stringify(answer.rows)}`;
    log(`NSE answer: unparseable-rows — ${cause}. Nothing changed for ${year}.`);
    return { exitCode: 5, state: 'unparseable-rows', cause, actions: [], applied: false, nseDates: [] };
  }

  const nseDates = answer.holidays.map((h) => h.date);
  log(`NSE answer: list — ${answer.holidays.length} CM trading holiday(s) for ${year}:`);
  for (const h of answer.holidays) log(`  ${h.date} (${h.weekday}) ${h.description}`);

  const existing = await readTradingRowsForYear(db, year);
  const actions = planHolidayReconcile(existing, answer.holidays) as HolidayAction[];
  log(`Stored: ${existing.length} TRADING row(s) dated ${year}. Plan: ${actions.length} action(s).`);
  for (const a of actions) log(`  ${formatHolidayAction(a)}`);

  if (!apply || actions.length === 0) {
    return { exitCode: 0, state: 'list', actions, applied: false, nseDates };
  }
  if (typeof db.transaction !== 'function') throw new Error('reconcileMarketHolidayYear: --apply needs a db with transaction()');

  await db.transaction(async (tx) => {
    await applyActions(tx, year, actions);
    if (input.afterWrites) await input.afterWrites(tx);
    const after = await readTradingRowsForYear(tx, year);
    const diff = compareYearToNse(
      after.map((r) => r.date),
      answer.holidays
    );
    const notBoth = after.filter((r) => r.exchange !== 'BOTH');
    if (diff.missing.length > 0 || diff.extra.length > 0 || after.length !== answer.holidays.length || notBoth.length > 0) {
      throw new Error(
        `re-read after apply does not equal NSE's ${year} list (missing ${diff.missing.join(',') || '-'}; extra ${diff.extra.join(',') || '-'}; rows ${after.length} vs ${answer.holidays.length}; non-BOTH ${notBoth.length}) — rolled back`
      );
    }
  });
  log(`Applied ${actions.length} action(s) in one transaction; ${year} now equals NSE's list (${answer.holidays.length} rows).`);
  return { exitCode: 0, state: 'list', actions, applied: true, nseDates };
}
