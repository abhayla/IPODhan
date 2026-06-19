// Unit tests for the stage->due-fields model (Stage A acceptance: "a fixture IPO
// at each stage yields the right due set"). Pure, no DB. Run: node --test scripts/lib/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES, FIELDS, STAGE_DUE_FIELDS, dueFieldKeysForStage, deriveStage, computeStageGaps,
} from './ipo-stage-completeness.mjs';

test('every field key referenced by a stage exists in FIELDS', () => {
  for (const stage of STAGES) {
    for (const key of STAGE_DUE_FIELDS[stage]) {
      assert.ok(FIELDS[key], `stage ${stage} references unknown field ${key}`);
      assert.ok(['required', 'best_effort'].includes(FIELDS[key].severity), `field ${key} bad severity`);
      assert.equal(typeof FIELDS[key].sql, 'string');
    }
  }
});

test('deriveStage maps status + price band correctly', () => {
  assert.equal(deriveStage({ status: 'LISTED' }), 'LISTED');
  assert.equal(deriveStage({ status: 'CLOSED' }), 'CLOSED');
  assert.equal(deriveStage({ status: 'OPEN' }), 'OPEN');
  // UPCOMING with no price band = DRHP-only
  assert.equal(deriveStage({ status: 'UPCOMING', price_range_min: null }), 'UPCOMING');
  // UPCOMING with a real price band = RHP filed -> PRE_OPEN
  assert.equal(deriveStage({ status: 'UPCOMING', price_range_min: 100 }), 'PRE_OPEN');
  // a 0 price band is NOT a real band (substance) -> still UPCOMING
  assert.equal(deriveStage({ status: 'UPCOMING', price_range_min: 0 }), 'UPCOMING');
});

test('dueFieldKeysForStage is cumulative', () => {
  const upcoming = dueFieldKeysForStage('UPCOMING');
  const listed = dueFieldKeysForStage('LISTED');
  // UPCOMING due set is a subset of LISTED due set
  for (const k of upcoming) assert.ok(listed.includes(k), `${k} should still be due at LISTED`);
  // LISTED adds the listing fields not due at UPCOMING
  assert.ok(listed.includes('listing_date'));
  assert.ok(!upcoming.includes('listing_date'));
  assert.ok(!upcoming.includes('price_band')); // price band only due at PRE_OPEN+
  assert.ok(dueFieldKeysForStage('PRE_OPEN').includes('price_band'));
});

test('a fixture IPO at each stage yields the right due set size growth', () => {
  let prev = -1;
  for (const stage of STAGES) {
    const n = dueFieldKeysForStage(stage).length;
    assert.ok(n > prev, `stage ${stage} due-set (${n}) must grow over previous (${prev})`);
    prev = n;
  }
});

test('computeStageGaps splits missing by severity and ignores not-yet-due fields', () => {
  // An UPCOMING (DRHP) IPO missing financials (required) and gmp (not yet due).
  const row = { status: 'UPCOMING', price_range_min: null };
  const presence = { company_description: true, sector: true, financials: false, objectives: true, peers: true, promoter_holding: false };
  const r = computeStageGaps(row, presence);
  assert.equal(r.stage, 'UPCOMING');
  assert.ok(r.missingRequired.includes('financials'));
  assert.ok(r.missingBestEffort.includes('promoter_holding'));
  // gmp is an OPEN field, not due yet for an UPCOMING IPO -> not reported
  assert.ok(!r.missingRequired.includes('gmp'));
  assert.ok(!r.missingBestEffort.includes('gmp'));
});

test('computeStageGaps marks a fully-populated LISTED IPO as zero required gaps', () => {
  const row = { status: 'LISTED', price_range_min: 100 };
  const presence = {};
  for (const k of dueFieldKeysForStage('LISTED')) presence[k] = true;
  const r = computeStageGaps(row, presence);
  assert.equal(r.missingRequired.length, 0);
  assert.equal(r.presentCount, r.dueCount);
});
