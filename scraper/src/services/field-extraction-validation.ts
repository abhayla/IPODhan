import { parseAssertion, type ValidationRule } from '../config/validation-rules-schema.js';

export type { ValidationRule };

export type FieldValidationOutcome =
  | { status: 'PASS'; ruleId: string }
  /**
   * No rule's (offeringType, segment, date) window covers this value, OR the
   * one rule that does cover it cannot be EVALUATED with the inputs supplied
   * (a companion field or the working-day calendar is missing). Both are
   * "the current rule set was never written to judge this" — the value is
   * written, not blanked (5.3 "What this does not do"). Absence of a
   * judgement is never a failed judgement.
   */
  | { status: 'NO_RULE_APPLIES'; reason: string }
  | { status: 'FAIL'; ruleId: string; cause: string };

export interface ValidateFieldValueParams {
  table: string;
  /** DB column name (snake_case), exactly as validation-rules.json is keyed. */
  column: string;
  value: unknown;
  offeringType: string;
  segment: string | null;
  /**
   * The date the rule set is evaluated AS OF — the filing/effective date of
   * the ROW being validated, NEVER "today". This is what makes a 2022 backlog
   * row judged by the 2022-era rule, not today's.
   */
  asOfDate: Date | null;
  /** From loadValidationRules(), threaded in, not re-read per call. */
  rules: ValidationRule[];
  /**
   * Companion column values on the same row, snake_case-keyed, for assertions
   * that compare two fields (DATE_WITHIN_WORKING_DAYS). Absent companion =>
   * NO_RULE_APPLIES, never FAIL.
   */
  row?: Record<string, unknown>;
  /**
   * ISO `YYYY-MM-DD` trading holidays for the relevant exchange. `null` (the
   * default) means "the calendar was not supplied" — a working-day assertion
   * then returns NO_RULE_APPLIES rather than judging the value against a
   * calendar it does not have. An EMPTY set means "supplied, and there are no
   * holidays in the window".
   */
  holidays?: ReadonlySet<string> | null;
}

/** Pure. No DB access, no config read, no clock read — unit-testable without a database. */
export function validateFieldValue(params: ValidateFieldValueParams): FieldValidationOutcome {
  const rule = findApplicableRule(params);
  if (!rule) {
    return {
      status: 'NO_RULE_APPLIES',
      reason:
        `no rule covers ${params.table}.${params.column} for offeringType=${params.offeringType}, ` +
        `segment=${params.segment ?? 'null'}, asOf=${toIsoDate(params.asOfDate) ?? 'unknown'}`,
    };
  }

  // A null/undefined incoming value is not this gate's business — the existing
  // "no incoming value keeps existing" branch in consolidateField owns it.
  if (params.value === null || params.value === undefined || params.value === '') {
    return { status: 'NO_RULE_APPLIES', reason: `rule ${rule.id} does not judge an absent value` };
  }

  const assertion = parseAssertion(rule.assertion);

  switch (assertion.fn) {
    case 'ENUM': {
      const n = toFiniteNumber(params.value);
      if (n === null) {
        return {
          status: 'NO_RULE_APPLIES',
          reason: `rule ${rule.id} needs a numeric value; got "${String(params.value)}"`,
        };
      }
      return assertion.allowed.includes(n) ? pass(rule) : fail(rule, params.value);
    }

    case 'RANGE': {
      const n = toFiniteNumber(params.value);
      if (n === null) {
        return {
          status: 'NO_RULE_APPLIES',
          reason: `rule ${rule.id} needs a numeric value; got "${String(params.value)}"`,
        };
      }
      return n > assertion.min && n <= assertion.max ? pass(rule) : fail(rule, params.value);
    }

    case 'DATE_WITHIN_WORKING_DAYS': {
      if (!params.holidays) {
        return {
          status: 'NO_RULE_APPLIES',
          reason: `rule ${rule.id} needs a working-day calendar and none was supplied`,
        };
      }
      const later = toDate(params.value);
      const earlier = toDate(params.row?.[assertion.earlierField]);
      if (!later || !earlier) {
        return {
          status: 'NO_RULE_APPLIES',
          reason:
            `rule ${rule.id} needs both ${assertion.laterField} and ${assertion.earlierField}; ` +
            `${!later ? assertion.laterField : assertion.earlierField} is missing or unparseable`,
        };
      }
      if (later < earlier) return fail(rule, params.value);
      const gap = workingDaysBetween(earlier, later, params.holidays);
      return gap <= assertion.days ? pass(rule) : fail(rule, params.value);
    }
  }
}

function pass(rule: ValidationRule): FieldValidationOutcome {
  return { status: 'PASS', ruleId: rule.id };
}

function fail(rule: ValidationRule, value: unknown): FieldValidationOutcome {
  // signal-ownership.md R6: the cause must classify the failure from its own
  // row, with no re-run. Rule id and the offending value are both in it.
  const rendered = rule.causeTemplate.replace(/\{value\}/g, formatValue(value));
  return { status: 'FAIL', ruleId: rule.id, cause: `[${rule.id}] ${rendered}` };
}

function findApplicableRule(params: ValidateFieldValueParams): ValidationRule | undefined {
  const asOf = toIsoDate(params.asOfDate);
  const segment = params.segment ?? 'ALL';
  return params.rules.find((rule) => {
    if (rule.appliesTo.table !== params.table) return false;
    if (rule.appliesTo.column !== params.column) return false;
    if (!matches(rule.offeringTypes, params.offeringType)) return false;
    if (!matches(rule.segments, segment)) return false;
    // Date scoping (F-10). A rule with BOTH bounds null is date-unscoped and
    // applies at any asOfDate, including an unknown one. A rule WITH a bound
    // cannot be judged without a date, so it does not apply.
    if (rule.validFrom === null && rule.validTo === null) return true;
    if (!asOf) return false;
    if (rule.validFrom !== null && asOf < rule.validFrom) return false;
    if (rule.validTo !== null && asOf > rule.validTo) return false;
    return true;
  });
}

function matches(list: string[], candidate: string): boolean {
  return list.includes('ALL') || list.includes(candidate);
}

const MS_PER_DAY = 86_400_000;

/**
 * Working days STRICTLY AFTER `from`, up to and including `to`. Weekends and
 * any date in `holidays` (ISO YYYY-MM-DD) do not count. No such utility
 * existed anywhere in scraper/src before this item.
 */
export function workingDaysBetween(from: Date, to: Date, holidays: ReadonlySet<string>): number {
  let count = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  // Hard stop so a corrupt far-future date cannot spin: 2,000 calendar days is
  // ~5.5 years, far beyond any legitimate listing gap.
  let guard = 0;
  while (cursor.getTime() < end) {
    cursor.setTime(cursor.getTime() + MS_PER_DAY);
    if (++guard > 2000) return Number.POSITIVE_INFINITY;
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (holidays.has(cursor.toISOString().slice(0, 10))) continue;
    count++;
  }
  return count;
}

export function toIsoDate(value: unknown): string | null {
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
