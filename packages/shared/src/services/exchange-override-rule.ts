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
 *
 * The baseline is kept PER SOURCE, and "unknown" is not "answered nothing": a key that is absent
 * from `exchangeAtSave` is unknown (a hold saved before this rule recorded it), a key holding null
 * means that exchange stated nothing at the time. An unknown baseline is first rebuilt from the
 * ADMIN row's `previous_value` when its `previous_source` is that exchange (`resolveExchangeBaseline`);
 * otherwise the exchange's answer at the first held read is recorded as the baseline, with no
 * replacement on that read, and only a later, different answer replaces the admin value.
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
  // `bidDate` lives on anchor_investors, a row-keyed table admins cannot hold until Phase B item 8;
  // it joins this set with that work (deferred issue #1281).
  [...E1_EXCHANGE_STATED_FIELDS].filter((f) => f !== 'status' && f !== 'bidDate')
);

/** The tables whose held fields the override writes: `ipos` and the one-row child table. */
export const EXCHANGE_OVERRIDE_TABLES: ReadonlySet<string> = new Set(['ipos', 'ipo_details']);

/** The sources whose answer can release a hold (OD-106 "NSE or BSE"). */
export const EXCHANGE_OVERRIDE_SOURCES = ['NSE', 'BSE'] as const;
export type ExchangeOverrideSource = (typeof EXCHANGE_OVERRIDE_SOURCES)[number];

/** What each exchange said for the field when the admin saved it (null = no answer then). */
export type ExchangeAtSave = Record<ExchangeOverrideSource, unknown>;

/** A per-source baseline: an ABSENT key is unknown; a null value means the exchange stated nothing. */
export type ExchangeBaseline = Partial<ExchangeAtSave>;

/** Where each source's baseline came from (kept beside `exchangeAtSave` in the lineage). */
export type ExchangeBaselineOrigin = 'SAVE' | 'PREVIOUS_VALUE' | 'FIRST_HELD_READ';

/** Witness outcomes that mean the exchange was asked and stated nothing (not a failed check). */
const STATED_NOTHING_OUTCOMES: ReadonlySet<string> = new Set(['NOT_PRINTED', 'NOT_AVAILABLE_YET']);

function isOverrideSource(s: string): s is ExchangeOverrideSource {
  return (EXCHANGE_OVERRIDE_SOURCES as readonly string[]).includes(s);
}

function hasKnownBaseline(baseline: ExchangeBaseline, source: ExchangeOverrideSource): boolean {
  return Object.prototype.hasOwnProperty.call(baseline, source) && baseline[source] !== undefined;
}

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
  | {
      kind: 'KEEP';
      reason: 'BASELINE_RECORDED' | 'NO_EXCHANGE_ANSWER' | 'EXCHANGE_AGREES_WITH_ADMIN' | 'EXCHANGE_UNCHANGED_SINCE_SAVE';
      /** Sources whose baseline was unknown, with what they said at this held read (to be stored). */
      baseline?: ExchangeBaseline;
    };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rebuild the baseline an ADMIN provenance row carries. `exchangeAtSave` recorded at save is used
 * as is; for a source it lacks, the row's `previous_value` is that source's baseline when
 * `previous_source` is that exchange (the value the admin replaced). Returns null for a row that is
 * not ADMIN (no admin save to compare with).
 */
export function resolveExchangeBaseline(row: {
  lineage: unknown;
  source: string | null | undefined;
  previousSource: string | null | undefined;
  previousValue: unknown;
}): { baseline: ExchangeBaseline; rebuilt: ExchangeOverrideSource[] } | null {
  if (row.source !== 'ADMIN') return null;
  const recorded = (row.lineage as { exchangeAtSave?: unknown } | null)?.exchangeAtSave;
  const baseline: ExchangeBaseline = {};
  if (recorded && typeof recorded === 'object') {
    for (const src of EXCHANGE_OVERRIDE_SOURCES) {
      if (Object.prototype.hasOwnProperty.call(recorded, src)) baseline[src] = (recorded as ExchangeBaseline)[src] ?? null;
    }
  }
  const rebuilt: ExchangeOverrideSource[] = [];
  const prev = String(row.previousSource ?? '').trim().toUpperCase();
  if (isOverrideSource(prev) && !hasKnownBaseline(baseline, prev)) {
    baseline[prev] = normalizeExchangeValue(row.previousValue);
    rebuilt.push(prev);
  }
  return { baseline, rebuilt };
}

/**
 * Decide from this pass's answers (rank order). The first SUPPLIED NSE/BSE date that is newer
 * (differs from the admin value AND from that exchange's known baseline) replaces the admin value.
 * A higher-ranked exchange that agrees with the admin stops the search: the admin is confirmed.
 * A non-date answer is skipped and the scan continues. A source whose baseline is unknown never
 * replaces on this read: what it says now (or null when it stated nothing) is returned as the
 * baseline to store; a failed check leaves it unknown.
 */
export function decideExchangeOverride(args: {
  adminValue: unknown;
  exchangeAtSave: ExchangeBaseline | null | undefined;
  answers: readonly ExchangeAnswer[];
}): ExchangeOverrideDecision {
  const known: ExchangeBaseline =
    args.exchangeAtSave && typeof args.exchangeAtSave === 'object' ? args.exchangeAtSave : {};
  const admin = normalizeExchangeValue(args.adminValue);
  const toRecord: ExchangeBaseline = {};
  let sawExchange = false;
  let unchanged = false;
  let agrees = false;
  let replace: { source: ExchangeOverrideSource; value: unknown } | null = null;

  for (const a of args.answers) {
    const source = String(a.source ?? '').trim().toUpperCase();
    if (!isOverrideSource(source)) continue;
    const supplied = a.outcome === undefined || a.outcome === 'SUPPLIED';
    const now = supplied ? normalizeExchangeValue(a.value) : null;
    const isDate = now !== null && ISO_DAY.test(now);

    if (!hasKnownBaseline(known, source)) {
      if (Object.prototype.hasOwnProperty.call(toRecord, source)) continue;
      if (isDate) toRecord[source] = now;
      else if (!supplied && STATED_NOTHING_OUTCOMES.has(String(a.outcome))) toRecord[source] = null;
      if (isDate && now === admin && !replace) agrees = true;
      continue;
    }
    if (!isDate || replace || agrees) continue;
    sawExchange = true;
    if (now === admin) {
      agrees = true;
      continue;
    }
    if (now === normalizeExchangeValue(known[source])) {
      unchanged = true;
      continue;
    }
    replace = { source, value: a.value };
  }

  if (replace) return { kind: 'REPLACE', source: replace.source, value: replace.value };
  const baseline = Object.keys(toRecord).length > 0 ? { baseline: toRecord } : {};
  if (agrees) return { kind: 'KEEP', reason: 'EXCHANGE_AGREES_WITH_ADMIN', ...baseline };
  if (Object.keys(toRecord).length > 0) return { kind: 'KEEP', reason: 'BASELINE_RECORDED', ...baseline };
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
