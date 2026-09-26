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

// ------------------------------------------------ #771 review round 1: scope
import { readFileSync } from 'node:fs';
import {
  ratioYieldVerdict, summarizeRatioYield, isFixedExtractorVersion, RATIO_FIXED_EXTRACTOR_VERSION,
} from '../lib/ratio-yield-verdict.mjs';

const FIXED = RATIO_FIXED_EXTRACTOR_VERSION;
const OLD_SAME_DAY = 'extract_filing.py@2026-09-26'; // 9 staging docs re-read by the OLD reader

test('the scraper writes a version the verdict counts as fixed (pins the two constants)', () => {
  const src = readFileSync(new URL('../../scraper/src/services/filing-auto-persist.ts', import.meta.url), 'utf8');
  const m = src.match(/export const EXTRACTOR_VERSION = '([^']+)'/);
  assert.ok(m, 'EXTRACTOR_VERSION literal not found');
  assert.equal(isFixedExtractorVersion(m[1]), true, `${m[1]} is older than ${FIXED}`);
});

test('versions compare by stored value, not by date alone', () => {
  assert.equal(isFixedExtractorVersion(FIXED), true);
  assert.equal(isFixedExtractorVersion('extract_filing.py@2026-10-01'), true);
  assert.equal(isFixedExtractorVersion(OLD_SAME_DAY), false);
  assert.equal(isFixedExtractorVersion('extract_filing.py@2026-09-03'), false);
  assert.equal(isFixedExtractorVersion(null), false);
  assert.equal(isFixedExtractorVersion('other.py@2027-01-01'), false);
});

test('a pre-fix document with no ratio is PENDING re-read, never FAIL (R5)', () => {
  const v = ratioYieldVerdict({ hasRatio: false, stepEvidence: '', extractorVersion: OLD_SAME_DAY });
  assert.equal(v.status, 'PENDING');
});

test('a pre-fix document WITH a (possibly stale-year) ratio is PENDING, not PASS', () => {
  // German Green Steel: 1.03 stored from the older year by the old reader.
  const v = ratioYieldVerdict({ hasRatio: true, stepEvidence: '', extractorVersion: 'extract_filing.py@2026-09-03' });
  assert.equal(v.status, 'PENDING');
});

test('a fixed-reader document with ratio_row_not_in_note FAILS', () => {
  const v = ratioYieldVerdict({ hasRatio: false, extractorVersion: FIXED,
    stepEvidence: e9({ current_ratio: 'ratio_row_not_in_note', quick_ratio: QUICK }) });
  assert.equal(v.status, 'FAIL');
  assert.match(v.cause, /reader gap/);
});

test('a fixed-reader document with a ratio PASSES', () => {
  assert.equal(ratioYieldVerdict({ hasRatio: true, stepEvidence: '', extractorVersion: FIXED }).status, 'PASS');
});

test('an all-pending population is UNVERIFIABLE, not PASS', () => {
  const s = summarizeRatioYield([{ status: 'PENDING' }, { status: 'PENDING' }]);
  assert.deepEqual(s, { status: 'UNVERIFIABLE', judged: 0, pending: 2, fails: 0 });
});

test('one judged FAIL among pendings fails the check', () => {
  const s = summarizeRatioYield([{ status: 'PENDING' }, { status: 'FAIL' }, { status: 'PASS' }]);
  assert.deepEqual(s, { status: 'FAIL', judged: 2, pending: 1, fails: 1 });
});
