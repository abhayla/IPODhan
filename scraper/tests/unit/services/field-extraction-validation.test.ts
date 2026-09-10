import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  validateFieldValue,
  workingDaysBetween,
  type ValidationRule,
} from '../../../src/services/field-extraction-validation.js';
import { loadValidationRules } from '../../../src/config/validation-rules-loader.js';

const RULES: ValidationRule[] = loadValidationRules();

const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

function faceValue(offeringType: string, value: unknown) {
  return validateFieldValue({
    table: 'ipos',
    column: 'face_value',
    value,
    offeringType,
    segment: 'MAINBOARD',
    asOfDate: new Date('2026-03-01'),
    rules: RULES,
  });
}

function listingDate(listing: string, close: string, asOf: string) {
  return validateFieldValue({
    table: 'ipos',
    column: 'listing_date',
    value: new Date(listing),
    offeringType: 'IPO',
    segment: 'MAINBOARD',
    asOfDate: new Date(asOf),
    rules: RULES,
    row: { close_date: new Date(close) },
    holidays: NO_HOLIDAYS,
  });
}

describe('validateFieldValue — the rule set actually loads', () => {
  it('loads the shipped rules file', () => {
    expect(RULES.map((r) => r.id).sort()).toEqual([
      'face_value_debt_positive',
      'face_value_equity_enum',
      'listing_t3',
      'listing_t6',
    ]);
  });
});

describe('offering-type scoping', () => {
  it('rejects face_value 3 for an equity IPO', () => {
    const outcome = faceValue('IPO', 3);
    expect(outcome.status).toBe('FAIL');
    if (outcome.status !== 'FAIL') throw new Error('unreachable');
    expect(outcome.ruleId).toBe('face_value_equity_enum');
    // signal-ownership.md R6: the cause classifies the failure from its own row.
    expect(outcome.cause).toContain('face_value_equity_enum');
    expect(outcome.cause).toContain('3');
  });

  it('accepts face_value 10 for an equity IPO', () => {
    expect(faceValue('IPO', 10).status).toBe('PASS');
  });

  it('accepts face_value 1000 for an NCD — the equity enum must NOT fire', () => {
    const outcome = faceValue('NCD', 1000);
    expect(outcome.status).toBe('PASS');
    if (outcome.status !== 'PASS') throw new Error('unreachable');
    expect(outcome.ruleId).toBe('face_value_debt_positive');
  });
});

describe('date scoping (F-10) — the same value, the same field, two eras', () => {
  // 2026: close Mon 2026-03-02, listing Mon 2026-03-09 = 5 working days = T+5.
  it('listing_t3 REJECTS a T+5 gap for a 2026 row', () => {
    const outcome = listingDate('2026-03-09', '2026-03-02', '2026-03-09');
    expect(outcome.status).toBe('FAIL');
    if (outcome.status !== 'FAIL') throw new Error('unreachable');
    expect(outcome.ruleId).toBe('listing_t3');
  });

  // The literal F-10 regression: the SAME gap, judged as of 2022, must PASS.
  it('listing_t6 ACCEPTS that same T+5 gap for a 2022 row', () => {
    const outcome = listingDate('2022-03-09', '2022-03-02', '2022-03-09');
    expect(outcome.status).toBe('PASS');
    if (outcome.status !== 'PASS') throw new Error('unreachable');
    expect(outcome.ruleId).toBe('listing_t6');
  });

  it('a rule whose validFrom is after the row date does not apply', () => {
    const futureRule: ValidationRule[] = [
      {
        id: 'listing_t1_future',
        appliesTo: { table: 'ipos', column: 'listing_date' },
        offeringTypes: ['ALL'],
        segments: ['ALL'],
        validFrom: '2030-01-01',
        validTo: null,
        assertion: 'DATE_WITHIN_WORKING_DAYS(listing_date, close_date, 1, exchange)',
        causeTemplate: 'listing_date {value} is more than 1 working day after close_date',
      },
    ];
    const outcome = validateFieldValue({
      table: 'ipos',
      column: 'listing_date',
      value: new Date('2026-03-09'),
      offeringType: 'IPO',
      segment: 'MAINBOARD',
      asOfDate: new Date('2026-03-09'),
      rules: futureRule,
      row: { close_date: new Date('2026-03-02') },
      holidays: NO_HOLIDAYS,
    });
    expect(outcome.status).toBe('NO_RULE_APPLIES');
  });

  it('a rule whose window CONTAINS the row date does apply', () => {
    const windowRule: ValidationRule[] = [
      {
        id: 'listing_t1_now',
        appliesTo: { table: 'ipos', column: 'listing_date' },
        offeringTypes: ['ALL'],
        segments: ['ALL'],
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        assertion: 'DATE_WITHIN_WORKING_DAYS(listing_date, close_date, 1, exchange)',
        causeTemplate: 'listing_date {value} is more than 1 working day after close_date',
      },
    ];
    const outcome = validateFieldValue({
      table: 'ipos',
      column: 'listing_date',
      value: new Date('2026-03-09'),
      offeringType: 'IPO',
      segment: 'MAINBOARD',
      asOfDate: new Date('2026-03-09'),
      rules: windowRule,
      row: { close_date: new Date('2026-03-02') },
      holidays: NO_HOLIDAYS,
    });
    expect(outcome.status).toBe('FAIL');
  });
});

describe('an uncovered field is KEPT, never blanked', () => {
  it('returns NO_RULE_APPLIES for a column no rule mentions', () => {
    const outcome = validateFieldValue({
      table: 'ipos',
      column: 'registrar_name',
      value: 'Link Intime',
      offeringType: 'IPO',
      segment: 'MAINBOARD',
      asOfDate: new Date('2026-03-01'),
      rules: RULES,
    });
    expect(outcome.status).toBe('NO_RULE_APPLIES');
    expect(outcome.status).not.toBe('FAIL');
  });

  it('returns NO_RULE_APPLIES for an offering type no rule covers', () => {
    expect(faceValue('SOVEREIGN_GOLD_BOND', 999).status).toBe('NO_RULE_APPLIES');
  });

  it('returns NO_RULE_APPLIES when the working-day calendar was not supplied', () => {
    const outcome = validateFieldValue({
      table: 'ipos',
      column: 'listing_date',
      value: new Date('2026-03-09'),
      offeringType: 'IPO',
      segment: 'MAINBOARD',
      asOfDate: new Date('2026-03-09'),
      rules: RULES,
      row: { close_date: new Date('2026-03-02') },
      holidays: null,
    });
    expect(outcome.status).toBe('NO_RULE_APPLIES');
  });
});

describe('workingDaysBetween', () => {
  it('skips weekends', () => {
    // Mon 2026-03-02 -> Mon 2026-03-09 is 5 working days, not 7.
    expect(workingDaysBetween(new Date('2026-03-02'), new Date('2026-03-09'), NO_HOLIDAYS)).toBe(5);
  });

  it('skips a supplied holiday', () => {
    const holidays = new Set(['2026-03-04']);
    expect(workingDaysBetween(new Date('2026-03-02'), new Date('2026-03-09'), holidays)).toBe(4);
  });
});

describe('loadValidationRules rejects a malformed file at startup', () => {
  function writeRules(body: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'validation-rules-'));
    const file = join(dir, 'validation-rules.json');
    writeFileSync(file, JSON.stringify(body), 'utf-8');
    return file;
  }

  it('throws on a schema violation', () => {
    const file = writeRules({ version: 1, rules: [{ id: 'x' }] });
    expect(() => loadValidationRules(file)).toThrow(/failed schema validation/);
  });

  it('throws on an unknown assertion function', () => {
    const file = writeRules({
      version: 1,
      rules: [
        {
          id: 'bogus',
          appliesTo: { table: 'ipos', column: 'face_value' },
          offeringTypes: ['IPO'],
          segments: ['ALL'],
          validFrom: null,
          validTo: null,
          assertion: 'EVAL(whatever)',
          causeTemplate: 'nope',
        },
      ],
    });
    expect(() => loadValidationRules(file)).toThrow(/unknown or malformed assertion/);
  });

  it('throws on two overlapping rules for the same column', () => {
    const rule = {
      appliesTo: { table: 'ipos', column: 'face_value' },
      offeringTypes: ['IPO'],
      segments: ['ALL'],
      validFrom: null,
      validTo: null,
      assertion: 'ENUM(value, [1, 2])',
      causeTemplate: 'nope {value}',
    };
    const file = writeRules({
      version: 1,
      rules: [
        { ...rule, id: 'a' },
        { ...rule, id: 'b' },
      ],
    });
    expect(() => loadValidationRules(file)).toThrow(/overlapping/);
  });

  it('throws on a file that is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'validation-rules-'));
    const file = join(dir, 'validation-rules.json');
    writeFileSync(file, '{ not json', 'utf-8');
    expect(() => loadValidationRules(file)).toThrow(/not valid JSON/);
  });
});
