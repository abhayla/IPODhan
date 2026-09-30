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

/**
 * The exchanges (OD-106). Which ONE of them may release a hold is decided per field by rank
 * (OD-141, `decideExchangeOverride`): the highest-ranked exchange that states the field.
 */
export const EXCHANGE_OVERRIDE_SOURCES = ['NSE', 'BSE'] as const;
export type ExchangeOverrideSource = (typeof EXCHANGE_OVERRIDE_SOURCES)[number];

/** What each exchange said for the field when the admin saved it (null = no answer then). */
export type ExchangeAtSave = Record<ExchangeOverrideSource, unknown>;

/** A per-source baseline: an ABSENT key is unknown; a null value means the exchange stated nothing. */
export type ExchangeBaseline = Partial<ExchangeAtSave>;

/** Where each source's baseline came from (kept beside `exchangeAtSave` in the lineage). */
export type ExchangeBaselineOrigin = 'SAVE' | 'PREVIOUS_VALUE' | 'FIRST_HELD_READ';

/**
 * OD-145 (owner 2026-09-30): the ONLY outcome that means an exchange does not state a field is an
 * explicit "not printed". NOT_AVAILABLE_YET is what a fetcher answers for a not-found IPO or (before
 * OD-145) an ambiguous match or an empty board after a failed scrape, so it is UNKNOWN, never
 * "stated nothing" (round-4 Tier A CRITICAL-1, #1287).
 */
const STATED_NOTHING_OUTCOMES: ReadonlySet<string> = new Set(['NOT_PRINTED']);

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

/** Why an admin value was kept (every KEEP names one). */
export type ExchangeKeepReason =
  | 'BASELINE_RECORDED'
  | 'NO_EXCHANGE_ANSWER'
  | 'EXCHANGE_AGREES_WITH_ADMIN'
  | 'EXCHANGE_UNCHANGED_SINCE_SAVE'
  /** OD-141/OD-145: the top-ranked exchange's read failed, was CHECK_FAILED or NOT_AVAILABLE_YET, or gave a non-date. */
  | 'TOP_EXCHANGE_UNKNOWN'
  /** OD-141: the top-ranked exchange stated a date at save and now states nothing. */
  | 'TOP_EXCHANGE_WITHDREW';

export type ExchangeOverrideDecision =
  | { kind: 'REPLACE'; source: ExchangeOverrideSource; value: unknown }
  | {
      kind: 'KEEP';
      reason: ExchangeKeepReason;
      /** Sources whose baseline was unknown, with what they said at this held read (to be stored). */
      baseline?: ExchangeBaseline;
      /**
       * OD-141: a LOWER-ranked exchange published a newer value (differs from the admin value and
       * from its own known baseline) while the top-ranked exchange kept the admin value. It goes to
       * the admin queue as a disagreement (OD-63); it never releases the hold.
       */
      lowerRankDisagreement?: { source: ExchangeOverrideSource; value: unknown; topSource: ExchangeOverrideSource };
    };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ONE rule for what a piece of stored evidence says about an exchange's baseline, used at EVERY
 * site that writes one (admin save, admin re-save, held read; the legacy rebuild from
 * `previous_value` is the only other source): a SUPPLIED answer with a value -> that value; an
 * explicit NOT_PRINTED -> null (the exchange does not print the field); anything else
 * (NOT_AVAILABLE_YET, no answer stored, CHECK_FAILED, FAILED, SUPPLIED with no value) -> unknown
 * (OD-145). Absence of evidence is never "stated nothing".
 */
export type BaselineEvidence = { known: true; value: string | null; at: string | null } | { known: false };

export function baselineEvidenceFromAnswer(a: { value?: unknown; outcome?: unknown; at?: unknown }): BaselineEvidence {
  const at = typeof a.at === 'string' ? a.at : null;
  if (a.outcome === undefined || a.outcome === 'SUPPLIED') {
    const value = normalizeExchangeValue(a.value);
    return value === null ? { known: false } : { known: true, value, at };
  }
  if (STATED_NOTHING_OUTCOMES.has(String(a.outcome))) return { known: true, value: null, at };
  return { known: false };
}

/** The strongest evidence a stored answer list (witnesses or plan answers) holds for one exchange. */
export function baselineEvidenceFromWitnesses(list: unknown, source: ExchangeOverrideSource): BaselineEvidence {
  if (!Array.isArray(list)) return { known: false };
  let nothing: BaselineEvidence = { known: false };
  for (const w of list as Array<{ source?: unknown; value?: unknown; outcome?: unknown; at?: unknown } | null>) {
    if (!w || String(w.source ?? '').trim().toUpperCase() !== source) continue;
    const ev = baselineEvidenceFromAnswer(w);
    if (ev.known && ev.value !== null) return ev;
    if (ev.known && !nothing.known) nothing = ev;
  }
  return nothing;
}

/**
 * The baseline an admin save stores. On a re-save of an existing hold the prior ADMIN row's KNOWN
 * entries (recorded, rebuilt from `previous_value`, or first-held-read) are carried forward, because
 * the re-save does not change what the exchange said; a stored answer replaces a carried entry only
 * when it is NEWER than that baseline (`at` later than `priorSince`). A source with neither stays
 * absent (unknown), and the first held read records it.
 */
export function baselineForAdminSave(args: {
  prior: { baseline: ExchangeBaseline; origin: Partial<Record<ExchangeOverrideSource, ExchangeBaselineOrigin>>; since: string | null } | null;
  evidence: Partial<Record<ExchangeOverrideSource, BaselineEvidence>>;
}): { baseline: ExchangeBaseline; origin: Partial<Record<ExchangeOverrideSource, ExchangeBaselineOrigin>> } {
  const baseline: ExchangeBaseline = {};
  const origin: Partial<Record<ExchangeOverrideSource, ExchangeBaselineOrigin>> = {};
  const sinceMs = args.prior?.since ? Date.parse(args.prior.since) : NaN;
  for (const src of EXCHANGE_OVERRIDE_SOURCES) {
    const ev = args.evidence[src];
    const carried = args.prior && hasKnownBaseline(args.prior.baseline, src);
    if (carried) {
      const evMs = ev?.known && ev.at ? Date.parse(ev.at) : NaN;
      const newer = ev?.known === true && Number.isFinite(evMs) && (!Number.isFinite(sinceMs) || evMs > sinceMs);
      if (!newer) {
        baseline[src] = args.prior!.baseline[src] ?? null;
        origin[src] = args.prior!.origin[src] ?? 'SAVE';
        continue;
      }
    }
    if (ev?.known) {
      baseline[src] = ev.value;
      origin[src] = 'SAVE';
    }
  }
  return { baseline, origin };
}

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
  // An empty previous_value is no evidence of what the exchange said (round-3 MINOR, #1287): the
  // baseline stays unknown and the first held read records it.
  const prevValue = normalizeExchangeValue(row.previousValue);
  if (isOverrideSource(prev) && !hasKnownBaseline(baseline, prev) && prevValue !== null) {
    baseline[prev] = prevValue;
    rebuilt.push(prev);
  }
  return { baseline, rebuilt };
}

/**
 * OD-141 (narrows OD-106 "NSE or BSE"; section 9.2 item 28(a)): decide from this pass's answers,
 * which arrive in the field's RANK order (the walk asks `policy.ranks` in order, the same order it
 * writes in after a release; Appendix A puts the exchanges first: MAINBOARD NSE, BSE; SME_BSE BSE;
 * SME_NSE NSE). Only the highest-ranked exchange that STATES the field can release an admin value
 * or an admin EMPTY:
 *
 * - The top exchange states a date: it alone decides. REPLACE only when that date differs from the
 *   admin value AND from its own known baseline (`exchangeAtSave`); an unknown baseline is recorded
 *   and keeps the admin value on this read.
 * - The top exchange's read is UNKNOWN (FAILED, CHECK_FAILED, NOT_AVAILABLE_YET, no answer, a
 *   non-date): KEEP, record no baseline for it, and never hand the decision down the ranking
 *   (OD-145). A failed rank-1 read is not "rank 1 moved", and the next walk would ask rank 1 first
 *   and could write the very date the admin rejected (round-3 and round-4 findings, #1287).
 * - The top exchange answers an explicit NOT_PRINTED (the only "does not state", OD-145): it does
 *   not state the field unless its known baseline is a date (then rank 1 withdrew the value: KEEP).
 *   With a null or unknown baseline the next exchange is the top stating one and is judged the same
 *   way; an unknown baseline is recorded as null.
 *
 * A lower-ranked exchange never releases. When it published a newer value (differs from the admin
 * value and from its own known baseline) and the hold is kept, the decision carries it as
 * `lowerRankDisagreement` for the admin queue (OD-63). Every exchange's unknown baseline is still
 * returned for storing, so a later read can judge it.
 */
export function decideExchangeOverride(args: {
  adminValue: unknown;
  exchangeAtSave: ExchangeBaseline | null | undefined;
  answers: readonly ExchangeAnswer[];
}): ExchangeOverrideDecision {
  const known: ExchangeBaseline =
    args.exchangeAtSave && typeof args.exchangeAtSave === 'object' ? args.exchangeAtSave : {};
  const admin = normalizeExchangeValue(args.adminValue);

  // One entry per exchange, first answer wins, rank order kept.
  const exchanges: Array<{ source: ExchangeOverrideSource; ev: BaselineEvidence; raw: unknown }> = [];
  for (const a of args.answers) {
    const source = String(a.source ?? '').trim().toUpperCase();
    if (!isOverrideSource(source) || exchanges.some((x) => x.source === source)) continue;
    exchanges.push({ source, ev: baselineEvidenceFromAnswer(a), raw: a.value });
  }

  const toRecord: ExchangeBaseline = {};
  for (const x of exchanges) {
    if (hasKnownBaseline(known, x.source)) continue;
    if (x.ev.known && (x.ev.value === null || ISO_DAY.test(x.ev.value))) toRecord[x.source] = x.ev.value;
  }
  const recorded = Object.keys(toRecord).length > 0 ? { baseline: toRecord } : {};

  // A lower-ranked exchange's newer value, for the queue (never a release).
  const disagreementBelow = (index: number, topSource: ExchangeOverrideSource) => {
    for (const x of exchanges.slice(index + 1)) {
      if (!x.ev.known || x.ev.value === null || !ISO_DAY.test(x.ev.value)) continue;
      if (!hasKnownBaseline(known, x.source)) continue;
      if (x.ev.value === admin || x.ev.value === normalizeExchangeValue(known[x.source])) continue;
      return { lowerRankDisagreement: { source: x.source, value: x.raw, topSource } };
    }
    return {};
  };
  const keep = (reason: ExchangeKeepReason, index: number, topSource: ExchangeOverrideSource | null): ExchangeOverrideDecision => ({
    kind: 'KEEP',
    reason,
    ...recorded,
    ...(topSource ? disagreementBelow(index, topSource) : {}),
  });

  for (const [i, x] of exchanges.entries()) {
    const baselineKnown = hasKnownBaseline(known, x.source);
    const baselineValue = baselineKnown ? normalizeExchangeValue(known[x.source]) : undefined;

    if (!x.ev.known) return keep('TOP_EXCHANGE_UNKNOWN', i, x.source);
    const now = x.ev.value;
    if (now === null) {
      // An explicit NOT_PRINTED (the only "stated nothing", OD-145). A date at save means rank 1
      // withdrew it; otherwise this exchange does not state the field and the next one decides.
      if (baselineKnown && baselineValue !== null) return keep('TOP_EXCHANGE_WITHDREW', i, x.source);
      continue;
    }
    if (!ISO_DAY.test(now)) return keep('TOP_EXCHANGE_UNKNOWN', i, x.source);

    // x is the highest-ranked exchange that states the field: it alone decides.
    if (!baselineKnown) return keep(now === admin ? 'EXCHANGE_AGREES_WITH_ADMIN' : 'BASELINE_RECORDED', i, x.source);
    if (now === admin) return keep('EXCHANGE_AGREES_WITH_ADMIN', i, x.source);
    if (now === baselineValue) return keep('EXCHANGE_UNCHANGED_SINCE_SAVE', i, x.source);
    return { kind: 'REPLACE', source: x.source, value: x.raw };
  }
  return keep(Object.keys(toRecord).length > 0 ? 'BASELINE_RECORDED' : 'NO_EXCHANGE_ANSWER', -1, null);
}

/** OD-112 / §9.2 item 16: an instant admin alert only for a live (UPCOMING or OPEN) IPO. */
export function isInstantAlertStatus(status: unknown): boolean {
  return status === 'UPCOMING' || status === 'OPEN';
}

/** §9.2 item 25 / OD-93 shape: one alert per IPO, field and IST day. */
export function exchangeOverrideDedupeKey(env: string, ipoId: string, fieldName: string, now: Date): string {
  return `admin-od106:${env}:${ipoId}:${fieldName}:${istDayIso(now)}`;
}
