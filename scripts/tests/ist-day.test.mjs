import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istDayIso } from '../lib/ist-day.mjs';

test('istDayIso: 18:29:59Z stays the same UTC day (before the 02:00 IST rollover)', () => {
  assert.equal(istDayIso(new Date('2026-09-15T18:29:59Z')), '2026-09-15');
});

test('istDayIso: 18:30:00Z is the IST rollover instant -> next day', () => {
  assert.equal(istDayIso(new Date('2026-09-15T18:30:00Z')), '2026-09-16');
});

test('istDayIso: 23:59:59Z is well past the rollover -> next day', () => {
  assert.equal(istDayIso(new Date('2026-09-15T23:59:59Z')), '2026-09-16');
});

test('istDayIso: year boundary rolls over correctly', () => {
  assert.equal(istDayIso(new Date('2026-12-31T18:30:00Z')), '2027-01-01');
});

test('istDayIso: defaults to new Date() when called with no argument', () => {
  assert.doesNotThrow(() => istDayIso());
});
