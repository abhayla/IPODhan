/**
 * #1256 — the IPO status ladder is forward-only, for EVERY writer of `ipos.status`
 * (the web date ladder, status-updater-service.ts, and the scraper's consolidation,
 * data-consolidation-service.ts). One implementation, imported by both; never copied.
 *
 * Spec row 8 (`status`, data-sourcing-pull-model.md): "must be a legal transition
 * (UPCOMING→OPEN→CLOSED→LISTED); never regresses without an ADMIN row". The one sanctioned way
 * back is an exchange relaunch (OD-83, F-131, §2.9 "POSTPONED — not terminal, it comes back"):
 * the exchange publishes a NEWER window for the same row.
 *
 * Measured on staging 2026-09-28 before this existed: every dated backward move the ladder wrote
 * was a regression, none a relaunch — 10 CLOSED→OPEN on the IPO's own close day after the source
 * reported bidding closed (close_date never moved), and 4 LISTED→CLOSED while listing_date was
 * still null.
 */

import { istDayIso } from './ist-day';

export const LADDER_RANK: Readonly<Record<string, number>> = { UPCOMING: 0, OPEN: 1, CLOSED: 2, LISTED: 3 };

/** Pure: does `from` → `to` go down the ladder? A status off the ladder is never "backward". */
export function isBackwardMove(from: unknown, to: unknown): boolean {
  const a = LADDER_RANK[String(from ?? '').toUpperCase()];
  const b = LADDER_RANK[String(to ?? '').toUpperCase()];
  return a !== undefined && b !== undefined && b < a;
}

/** The date that makes a backward target true: UPCOMING needs open_date ahead, OPEN needs
 *  close_date ahead, CLOSED (from LISTED) needs listing_date ahead or gone. */
export const BACKWARD_DRIVING_FIELD: Readonly<Record<string, 'openDate' | 'closeDate' | 'listingDate'>> = {
  UPCOMING: 'openDate',
  OPEN: 'closeDate',
  CLOSED: 'listingDate',
};

export const EXCHANGE_SOURCES: ReadonlySet<string> = new Set(['NSE', 'BSE']);

/** The `field_sources` fields a backward decision reads (camelCase, `ipos`, row key ''). */
export const LADDER_EVIDENCE_FIELDS: readonly string[] = ['status', 'openDate', 'closeDate', 'listingDate'];

/** One `field_sources` row of this IPO's `ipos` record (status or a ladder date). */
export interface StatusEvidence {
  fieldName: string;
  source: string;
  previousValue: string | null;
  previousSource: string | null;
  updatedAt: Date;
}

export type BackwardDecision = { allowed: true; reason: string } | { allowed: false; cause: string };

export interface LadderDates {
  openDate: unknown;
  closeDate: unknown;
  listingDate: unknown;
}

/** A stored or scraped date as its IST calendar day `YYYY-MM-DD` (dates are IST market dates; a
 *  `Date` is read in IST, so an IST-midnight instant is never pulled back a day). */
export function ladderDay(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : istDayIso(value);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Pure decision for a backward ladder move. Allowed only when:
 *  - ADMIN: the driving date's field_sources row is ADMIN and was written after the status; or
 *  - relaunch (never from LISTED): the driving date's row is from NSE or BSE, it REPLACED an
 *    exchange's own earlier value (`previousSource` NSE/BSE — a takeover of a website's date is not
 *    an exchange moving its window), that previous value is an EARLIER date than the stored one,
 *    and the row was written after the status's own field_sources row. No status row means no
 *    source ever claimed the status, so any qualifying date change is newer than it.
 * Everything else — a weaker source, an unchanged date, a null date, a takeover — is refused.
 */
export function decideBackwardMove(
  from: unknown,
  to: unknown,
  dates: LadderDates,
  evidence: StatusEvidence[]
): BackwardDecision {
  const field = BACKWARD_DRIVING_FIELD[String(to ?? '').toUpperCase()];
  if (!field) return { allowed: false, cause: `no driving date for target ${String(to)}` };
  const driving = evidence.find((e) => e.fieldName === field);
  const statusRow = evidence.find((e) => e.fieldName === 'status');
  if (!driving) return { allowed: false, cause: `${field} has no source row` };
  const newerThanStatus = !statusRow || driving.updatedAt.getTime() > statusRow.updatedAt.getTime();

  if (driving.source === 'ADMIN') {
    return newerThanStatus
      ? { allowed: true, reason: `ADMIN set ${field}` }
      : { allowed: false, cause: `the ADMIN ${field} predates the status (${statusRow?.source})` };
  }
  if (String(from ?? '').toUpperCase() === 'LISTED') {
    return { allowed: false, cause: 'LISTED never regresses without an ADMIN row' };
  }
  if (!EXCHANGE_SOURCES.has(driving.source)) {
    return { allowed: false, cause: `${field} is from ${driving.source}, not an exchange` };
  }
  if (!driving.previousSource || !EXCHANGE_SOURCES.has(driving.previousSource)) {
    return {
      allowed: false,
      cause: `${driving.source} took ${field} over from ${driving.previousSource ?? 'no source'}, not an exchange moving its own window`,
    };
  }
  const current = ladderDay(dates[field]);
  const previous = ladderDay(driving.previousValue);
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
