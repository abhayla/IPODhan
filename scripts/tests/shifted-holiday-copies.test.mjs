// #1380 / F-220: self-test of the shared rule behind the repair tool and the nightly check
// h_market_holiday_shifted_copy. Imports the REAL rule; weakening it turns a named case red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  weekdayName,
  selectShiftedHolidayCopies,
  evaluateShiftedHolidayCopies,
  normalizeHolidayDescription,
} from '../lib/shifted-holiday-copies.mjs';

let n = 0;
const row = (date, exchange, description, type = 'TRADING') => ({ id: `id-${++n}`, date, exchange, description, type, year: Number(date.slice(0, 4)) });

// The F-220 staging shape (2025): Good Friday BOTH Fri 04-18 vs NSE Thu 04-17, Dussehra / Gandhi Jayanti double holiday on 10-02.
const BOTH_GOOD_FRIDAY = row('2025-04-18', 'BOTH', 'Good Friday');
const NSE_GOOD_FRIDAY = row('2025-04-17', 'NSE', 'Good Friday');
const BOTH_DIWALI = row('2025-10-21', 'BOTH', 'Diwali Laxmi Pujan');
const NSE_DIWALI = row('2025-10-20', 'NSE', ' diwali  LAXMI pujan ');
const GENUINE_NSE_ONLY = row('2025-06-10', 'NSE', 'Special NSE closure');
const BOTH_GANDHI = row('2025-10-02', 'BOTH', 'Mahatma Gandhi Jayanti');
const NSE_DUSSEHRA_SAME_DATE = row('2025-10-02', 'NSE', 'Dussehra');
const BOTH_DUSSEHRA_NEXT = row('2025-10-03', 'BOTH', 'Dussehra');

const ALL = [BOTH_GOOD_FRIDAY, NSE_GOOD_FRIDAY, BOTH_DIWALI, NSE_DIWALI, GENUINE_NSE_ONLY, BOTH_GANDHI, NSE_DUSSEHRA_SAME_DATE, BOTH_DUSSEHRA_NEXT];

test('selects the one-day-early copies (case and whitespace insensitive) with the row each copies', () => {
  const sel = selectShiftedHolidayCopies(ALL);
  assert.deepEqual(sel.map((s) => s.row.id).sort(), [NSE_GOOD_FRIDAY.id, NSE_DIWALI.id].sort());
  const gf = sel.find((s) => s.row.id === NSE_GOOD_FRIDAY.id);
  assert.equal(gf.copyOf.id, BOTH_GOOD_FRIDAY.id);
  assert.equal(gf.weekday, 'Thursday');
});

test('a genuine exchange-only holiday with no later copy is NOT selected', () => {
  assert.equal(selectShiftedHolidayCopies([GENUINE_NSE_ONLY, BOTH_GOOD_FRIDAY]).length, 0);
});

test('a real double holiday (the other exchange carries the same date) is NOT selected', () => {
  assert.equal(selectShiftedHolidayCopies([BOTH_GANDHI, NSE_DUSSEHRA_SAME_DATE, BOTH_DUSSEHRA_NEXT]).length, 0);
});

test('a different description the next day is not a copy; non-TRADING rows never match; BSE copies are selected too', () => {
  assert.equal(selectShiftedHolidayCopies([row('2025-04-17', 'NSE', 'Good Friday'), row('2025-04-18', 'BOTH', 'Mahavir Jayanti')]).length, 0);
  assert.equal(selectShiftedHolidayCopies([row('2025-04-17', 'NSE', 'Good Friday', 'SETTLEMENT'), row('2025-04-18', 'BOTH', 'Good Friday')]).length, 0);
  assert.equal(selectShiftedHolidayCopies([row('2025-04-17', 'BSE', 'Good Friday'), row('2025-04-18', 'BOTH', 'Good Friday')]).length, 1);
  assert.equal(selectShiftedHolidayCopies([row('2025-04-17', 'BSE', 'Good Friday'), row('2025-04-18', 'NSE', 'Good Friday')]).length, 1);
});

test('a BOTH row is never itself selected, and two same-exchange rows are not each other\'s copy', () => {
  assert.equal(selectShiftedHolidayCopies([row('2025-04-17', 'BOTH', 'Good Friday'), row('2025-04-18', 'BOTH', 'Good Friday')]).length, 0);
  assert.equal(selectShiftedHolidayCopies([row('2025-04-17', 'NSE', 'Good Friday'), row('2025-04-18', 'NSE', 'Good Friday')]).length, 0);
});

test('calendar arithmetic is by parts: month and year boundaries and leap day, no ISO round trip', () => {
  assert.equal(addCalendarDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addCalendarDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addCalendarDays('2025-03-01', -1), '2025-02-28');
  assert.equal(weekdayName('2025-04-17'), 'Thursday');
  assert.equal(normalizeHolidayDescription('  A   b '), 'a b');
  assert.throws(() => addCalendarDays('2025-4-17', 1));
});

test('evaluateShiftedHolidayCopies: FAIL lists every offender by id, PASS on a clean calendar', async () => {
  const fail = await evaluateShiftedHolidayCopies(async () => ALL);
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.rows.length, 2);
  assert.ok(fail.lines.every((l) => /id id-\d+/.test(l) && /Thursday|Monday/.test(l)), fail.lines.join('|'));
  assert.equal(fail.scanned, ALL.length);
  const pass = await evaluateShiftedHolidayCopies(async () => [BOTH_GOOD_FRIDAY, GENUINE_NSE_ONLY, BOTH_GANDHI, NSE_DUSSEHRA_SAME_DATE]);
  assert.equal(pass.status, 'PASS');
});
