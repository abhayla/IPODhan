// W-151 — the audit's "details row present" counter.
//
// Run: node --test scripts/tests/details-row-coverage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDetailsRowCoverage,
  detailsRowMinPct,
  DETAILS_ROW_MIN_PCT,
  DETAILS_ROW_HARD_FROM,
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

// ---- W-151 round 2: WARN until the activation date, HARD after it ----

test('a shortfall is a WARN before the activation date', () => {
  const r = evaluateDetailsRowCoverage({
    withCompletedFiling: 40,
    withDetailsRow: 3,
    now: '2026-09-06T12:00:00Z',
  });
  assert.equal(r.pass, false);
  assert.equal(r.hard, false); // caller must NOT count it toward exit 1
  assert.match(r.detail, /WARN until 2026-09-09/);
});

test('the same shortfall is HARD on and after the activation date', () => {
  for (const now of ['2026-09-09T00:00:00Z', '2026-09-20T00:00:00Z']) {
    const r = evaluateDetailsRowCoverage({ withCompletedFiling: 40, withDetailsRow: 3, now });
    assert.equal(r.pass, false);
    assert.equal(r.hard, true, `expected HARD at ${now}`);
  }
  assert.equal(DETAILS_ROW_HARD_FROM, '2026-09-09');
});

test('DETAILS_ROW_MIN_PCT overrides the threshold', () => {
  assert.equal(detailsRowMinPct({}), DETAILS_ROW_MIN_PCT);
  assert.equal(detailsRowMinPct({ DETAILS_ROW_MIN_PCT: '50' }), 50);
  assert.equal(
    evaluateDetailsRowCoverage({ withCompletedFiling: 10, withDetailsRow: 6, minPct: 50 }).pass,
    true
  );
  assert.throws(() => detailsRowMinPct({ DETAILS_ROW_MIN_PCT: 'lots' }), RangeError);
  assert.throws(() => detailsRowMinPct({ DETAILS_ROW_MIN_PCT: '101' }), RangeError);
});
