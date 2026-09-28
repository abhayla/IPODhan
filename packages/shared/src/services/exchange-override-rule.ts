/**
 * OD-106 / OD-117 / §2.7 / §9.2 items 7 and 28(a): the ONE rule for when an exchange's answer on an
 * E-1 timetable field replaces an admin-held value. Pure (no schema, no database), so both the admin
 * write (which records what the exchanges said at save) and the override (which reads it back) use
 * the same field set and the same value comparison.
 *
 * "Newer" (the spec leaves it open for dates; OD-117 defines it for the exchange-published value):
 * the exchange now says something different from BOTH the admin's value AND what that same exchange
 * said when the admin saved (`exchangeAtSave`). An exchange that still says what it said at save is
 * the value the admin deliberately replaced, so it never undoes the admin. An admin EMPTY value is
 * compared the same way: any exchange value differs from empty, so it is replaced unless the
 * exchange still says what the admin deleted (item 28(a) "replaced by a newer exchange value").
 */
import { E1_EXCHANGE_STATED_FIELDS } from '../repositories/field-sources-repository';
import { istDayIso } from '../utils/ist-day';

/**
 * The fields an exchange value may take back from an admin (camelCase, as field_sources and
 * field_protection_metadata store them): the E-1 set minus `status` (OD-106 "other than
 * ipos.status"). `listingExchanges` is NOT here: OD-129 (2026-09-27) moved it out of E-1 into
 * class D (the offer document's listing sentence decides it), superseding OD-117's clause for it
 * (F-206). It is derived from `E1_EXCHANGE_STATED_FIELDS` so an E-1 membership change moves both.
 */
export const EXCHANGE_OVERRIDE_FIELDS: ReadonlySet<string> = new Set(
  [...E1_EXCHANGE_STATED_FIELDS].filter((f) => f !== 'status')
);

/** The tables whose held fields the override writes: `ipos` and the one-row child table. */
export const EXCHANGE_OVERRIDE_TABLES: ReadonlySet<string> = new Set(['ipos', 'ipo_details']);

/** The sources whose answer can release a hold (OD-106 "NSE or BSE"). */
export const EXCHANGE_OVERRIDE_SOURCES = ['NSE', 'BSE'] as const;
export type ExchangeOverrideSource = (typeof EXCHANGE_OVERRIDE_SOURCES)[number];

/** What each exchange said for the field when the admin saved it (null = no answer then). */
export type ExchangeAtSave = Record<ExchangeOverrideSource, unknown>;

export function isExchangeOverrideField(tableName: string, camelFieldName: string): boolean {
  return EXCHANGE_OVERRIDE_TABLES.has(tableName) && EXCHANGE_OVERRIDE_FIELDS.has(camelFieldName);
}

/**
 * One comparable form per value: a date-like value is its IST calendar day (a `Date` or a zoned
 * instant is converted with `istDayIso`, a bare `YYYY-MM-DD[...]` keeps its day), empty is null.
 */
export function normalizeExchangeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : istDayIso(value);
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return null;
    if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return istDayIso(d);
    }
    if (/^\d{4}-\d{2}-\d{2}(\b|T)/.test(s)) return s.slice(0, 10);
    return s;
  }
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort());
  return String(value);
}

export interface ExchangeAnswer {
  source: string;
  value: unknown;
  /** Absent on a witness written before OD-103 (then it was SUPPLIED). */
  outcome?: string;
}

export type ExchangeOverrideDecision =
  | { kind: 'REPLACE'; source: ExchangeOverrideSource; value: unknown }
  | { kind: 'KEEP'; reason: 'NO_EXCHANGE_AT_SAVE' | 'NO_EXCHANGE_ANSWER' | 'EXCHANGE_AGREES_WITH_ADMIN' | 'EXCHANGE_UNCHANGED_SINCE_SAVE' };

/**
 * Decide from this pass's answers (rank order). The first SUPPLIED NSE/BSE answer that is newer
 * (differs from the admin value AND from what that exchange said at save) replaces the admin value.
 * A higher-ranked exchange that agrees with the admin stops the search: the admin is confirmed.
 * With no recorded `exchangeAtSave` (a hold saved before this rule), "newer" cannot be told apart
 * from "the value the admin rejected", so the hold is kept.
 */
export function decideExchangeOverride(args: {
  adminValue: unknown;
  exchangeAtSave: Partial<ExchangeAtSave> | null | undefined;
  answers: readonly ExchangeAnswer[];
}): ExchangeOverrideDecision {
  if (!args.exchangeAtSave || typeof args.exchangeAtSave !== 'object') return { kind: 'KEEP', reason: 'NO_EXCHANGE_AT_SAVE' };
  const admin = normalizeExchangeValue(args.adminValue);
  let sawExchange = false;
  let unchanged = false;
  for (const a of args.answers) {
    const source = String(a.source ?? '').trim().toUpperCase() as ExchangeOverrideSource;
    if (!(EXCHANGE_OVERRIDE_SOURCES as readonly string[]).includes(source)) continue;
    if (a.outcome !== undefined && a.outcome !== 'SUPPLIED') continue;
    const now = normalizeExchangeValue(a.value);
    if (now === null) continue;
    sawExchange = true;
    if (now === admin) return { kind: 'KEEP', reason: 'EXCHANGE_AGREES_WITH_ADMIN' };
    if (now === normalizeExchangeValue(args.exchangeAtSave[source])) {
      unchanged = true;
      continue;
    }
    return { kind: 'REPLACE', source, value: a.value };
  }
  if (!sawExchange) return { kind: 'KEEP', reason: 'NO_EXCHANGE_ANSWER' };
  return { kind: 'KEEP', reason: unchanged ? 'EXCHANGE_UNCHANGED_SINCE_SAVE' : 'NO_EXCHANGE_ANSWER' };
}

/** OD-112 / §9.2 item 16: an instant admin alert only for a live (UPCOMING or OPEN) IPO. */
export function isInstantAlertStatus(status: unknown): boolean {
  return status === 'UPCOMING' || status === 'OPEN';
}

/** §9.2 item 25 / OD-93 shape: one alert per IPO, field and IST day. */
export function exchangeOverrideDedupeKey(env: string, ipoId: string, fieldName: string, now: Date): string {
  return `admin-od106:${env}:${ipoId}:${fieldName}:${istDayIso(now)}`;
}
