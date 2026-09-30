/**
 * §9.2 item 23 (OD-116, OD-118, OD-150): the ONE place that decides whether the scraper may write to
 * an IPO. A row is blocked when an admin locked it (`ipos.scraper_locked`) or hid it
 * (`ipos.hidden_at IS NOT NULL`).
 *
 * Why one module: item 23 failed two review rounds because the "who reads the lock" and "which tables
 * a hidden row touches" coverage lived in hand-typed lists that nothing checked. Every place that
 * reads the lock now reads it through this module, and
 * `web/tests/unit/lib/scraper-write-block-sites.test.ts` fails when any other source file
 * reads `scraper_locked` / `scraperLocked`. Adding a third blocking reason here reaches every reader
 * at once. A hidden row is skipped by the scraper's candidate selection (`notHiddenIpoSql`), so it is
 * not walked; a write that still reaches it is DROPPED inside field-hold.ts (never thrown, OD-151, so
 * one hidden row cannot abort a job for other IPOs). OD-151: a stray child write from a non-walk path
 * may land; the nightly check d_hidden_ipo_child_writes flags it.
 *
 * No schema import (field-hold.ts, a reader, must stay loadable without the schema module).
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * The record reached a row an admin HID. Thrown only by the identity bind (resolveIpoRow), whose
 * callers catch it per record: the row is bound (never recreated) and this record is skipped. A
 * decision, not a failure: its name is in SOURCE_KEY_NO_WRITE_ERROR_NAMES (ipo-source-keys.ts), so it
 * is never retried. field-hold.ts drops a hidden row's patch instead of throwing (OD-151).
 */
export class IpoHiddenError extends Error {
  constructor(message: string, public readonly ipoId: string) {
    super(message);
    this.name = 'IpoHiddenError';
    Object.setPrototypeOf(this, IpoHiddenError.prototype);
  }
}

/** OD-150: an admin write to a hidden row is refused with this reason (result kind HIDDEN, HTTP 409 IPO_HIDDEN). */
export const IPO_HIDDEN_ADMIN_REASON =
  'this IPO is hidden (§9.2 item 23, OD-150): a hidden row is view-only; unhide it to edit';

/** The two stored facts the predicate reads, in either the drizzle (camel) or the raw-row shape. */
export interface ScraperWriteBlockFacts {
  scraperLocked?: boolean | null;
  hiddenAt?: Date | string | null;
}

export interface ScraperWriteBlockRawFacts {
  scraper_locked?: boolean | null;
  hidden_at?: Date | string | null;
}

/** True when an admin hid the row (§9.2 item 23). */
export function isHiddenIpo(row: ScraperWriteBlockFacts | null | undefined): boolean {
  return row?.hiddenAt !== null && row?.hiddenAt !== undefined;
}

/**
 * THE predicate: the scraper writes nothing to this IPO. Fails closed on a malformed lock value only
 * in the sense that anything but an explicit `true` is "not locked" (the column's own default is false).
 */
export function scraperWriteBlocked(row: ScraperWriteBlockFacts | null | undefined): boolean {
  return row?.scraperLocked === true || isHiddenIpo(row);
}

/** Same predicate over a raw `SELECT scraper_locked, hidden_at` row. */
export function scraperWriteBlockedRaw(row: ScraperWriteBlockRawFacts | null | undefined): {
  locked: boolean;
  hidden: boolean;
  blocked: boolean;
} {
  const facts: ScraperWriteBlockFacts = { scraperLocked: row?.scraper_locked ?? null, hiddenAt: row?.hidden_at ?? null };
  return { locked: facts.scraperLocked === true, hidden: isHiddenIpo(facts), blocked: scraperWriteBlocked(facts) };
}

/** Drizzle select columns for the predicate: `db.select({ ...scraperWriteBlockColumns(ipos) })`. */
export function scraperWriteBlockColumns<T extends { scraperLocked: unknown; hiddenAt: unknown }>(
  iposTable: T
): { scraperLocked: T['scraperLocked']; hiddenAt: T['hiddenAt'] } {
  return { scraperLocked: iposTable.scraperLocked, hiddenAt: iposTable.hiddenAt };
}

/** Raw SQL select list for the predicate's facts (`SELECT id, ${scraperWriteBlockSqlColumns()} FROM ipos`). */
// A function, not a module-level constant: test files that mock drizzle-orm without `sql` must still
// be able to import this module (a top-level sql.raw call ran at import and broke them).
export function scraperWriteBlockSqlColumns(): SQL {
  return sql.raw('scraper_locked, hidden_at');
}

/**
 * Candidate-selection filter: "this ipos row is visible to the scraper's walks" — hidden rows are
 * skipped so the scraper stops walking them (§9.2 item 23). `alias` is the ipos alias in the query.
 * Deliberately hidden-only: a scraper_locked row keeps being selected and is refused per write, as
 * before this change.
 */
export function notHiddenIpoSql(alias = 'ipos'): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`notHiddenIpoSql: invalid alias ${alias}`);
  return sql.raw(`${alias}.hidden_at IS NULL`);
}

/** Candidate-selection filter for a child-table query keyed by an ipo id column (`col` = `t.ipo_id`). */
export function ipoIdNotHiddenSql(ipoIdColumnSql: string): SQL {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(ipoIdColumnSql)) throw new Error(`ipoIdNotHiddenSql: invalid column ${ipoIdColumnSql}`);
  return sql.raw(`NOT EXISTS (SELECT 1 FROM ipos hid WHERE hid.id = ${ipoIdColumnSql} AND hid.hidden_at IS NOT NULL)`);
}
