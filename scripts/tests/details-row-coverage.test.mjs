// W-151 — the audit's "details row present" counter.
//
// Run: node --test scripts/tests/details-row-coverage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDetailsRowCoverage,
  DETAILS_ROW_MIN_PCT,
} from '../lib/details-row-coverage.mjs';

test('fails below the 90% threshold (the prod shape that motivated W-151)', () => {
  const r = evaluateDetailsRowCoverage({ withCompletedFiling: 358, withDetailsRow: 3 });
  assert.equal(r.pass, false);
  assert.ok(r.pct < 1);
  assert.match(r.detail, /^3\/358 = 0\.8%/);
});

test('passes at exactly the threshold', () => {
  const r = evaluateDetailsRowCoverage({ withCompletedFiling: 100, withDetailsRow: 90 });
  assert.equal(r.pass, true);
  assert.equal(r.pct, 90);
  assert.equal(DETAILS_ROW_MIN_PCT, 90);
});

test('fails one row below the threshold', () => {
  assert.equal(
    evaluateDetailsRowCoverage({ withCompletedFiling: 100, withDetailsRow: 89 }).pass,
    false
  );
});

test('an empty population passes vacuously rather than dividing by zero', () => {
  const r = evaluateDetailsRowCoverage({ withCompletedFiling: 0, withDetailsRow: 0 });
  assert.equal(r.pass, true);
  assert.equal(r.pct, 100);
});

test('more rows than the population is a broken measurement, not a pass', () => {
  assert.throws(
    () => evaluateDetailsRowCoverage({ withCompletedFiling: 5, withDetailsRow: 6 }),
    RangeError
  );
});

test('negative counts are rejected', () => {
  assert.throws(
    () => evaluateDetailsRowCoverage({ withCompletedFiling: 5, withDetailsRow: -1 }),
    RangeError
  );
});
