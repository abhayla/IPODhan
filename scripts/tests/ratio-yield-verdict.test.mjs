import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratioYieldFailure } from '../lib/ratio-yield-verdict.mjs';

const e9 = (ratioReasons) => JSON.stringify({ checksRun: 40, checksFailed: 0, failedFields: [], ratioReasons });
const QUICK = 'balance_sheet_inputs_absent:current_assets,inventories,current_liabilities';

test('a stored current_ratio passes', () => {
  assert.equal(ratioYieldFailure({ hasRatio: true, stepEvidence: '' }), null);
});

test('a document with no ratio note passes on its recorded reason', () => {
  assert.equal(ratioYieldFailure({ hasRatio: false, stepEvidence: e9({ current_ratio: 'ratio_note_not_in_document', quick_ratio: QUICK }) }), null);
});

test("quick_ratio's always-present reason does NOT excuse a missing current ratio (#771)", () => {
  const got = ratioYieldFailure({ hasRatio: false, stepEvidence: e9({ quick_ratio: QUICK }) });
  assert.equal(got, 'no current_ratio and no recorded reason');
});

test('ratio_row_not_in_note is a reader gap, not a pass (#771)', () => {
  const got = ratioYieldFailure({ hasRatio: false, stepEvidence: e9({ current_ratio: 'ratio_row_not_in_note', quick_ratio: QUICK }) });
  assert.match(got, /reader gap/);
});

test('an E9 row from before #771 (no ratioReasons) fails with no recorded reason', () => {
  const old = JSON.stringify({ checksRun: 41, checksFailed: 5, failedFields: ['lot_size'], extractionStatus: 'PARTIAL' });
  assert.equal(ratioYieldFailure({ hasRatio: false, stepEvidence: old }), 'no current_ratio and no recorded reason');
});

test('no E9 row at all fails', () => {
  assert.equal(ratioYieldFailure({ hasRatio: false, stepEvidence: '' }), 'no current_ratio and no recorded reason');
});
