import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ratioYieldJudgement, ratioYieldVerdict, summarizeRatioYield, isFixedExtractorVersion,
  RATIO_FIXED_EXTRACTOR_VERSION,
} from '../lib/ratio-yield-verdict.mjs';

const QUICK = 'balance_sheet_inputs_absent:current_assets,inventories,current_liabilities';
const e9 = (ratioReasons, ratioRead) => JSON.stringify({
  checksRun: 40, checksFailed: 0, failedFields: [], ratioReasons,
  ...(ratioRead ? { ratioRead: { current_ratio: ratioRead } } : {}),
});
const readFor = (period, latest, value = 1.54) => ({
  period, period_label: 'FY 25-26', latest_statement_period: latest, basis: 'standalone',
  statement_basis: null, value, current_ratio_line_pages: [],
});
const judge = (ev) => ratioYieldJudgement({ stepEvidence: ev });

// ------------------------------------------- #771 round 3: per document
test('a value read for the statement period PASSES', () => {
  assert.equal(judge(e9({ quick_ratio: QUICK }, readFor('2026-03-31', '2026-03-31'))).status, 'PASS');
});

test('a value read for another period FAILS (the positional bug, as a check)', () => {
  const v = judge(e9({ quick_ratio: QUICK }, readFor('2025-03-31', '2026-03-31', 1.34)));
  assert.equal(v.status, 'FAIL');
  assert.match(v.cause, /read for 2025-03-31, statement period is 2026-03-31/);
});

test('a value with no recorded period FAILS', () => {
  const v = judge(e9({}, { ...readFor(null, '2026-03-31'), period: null }));
  assert.equal(v.status, 'FAIL');
  assert.match(v.cause, /no recorded period/);
});

test('a value outside 0-50 FAILS', () => {
  const v = judge(e9({}, readFor('2026-03-31', '2026-03-31', 987.65)));
  assert.equal(v.status, 'FAIL');
  assert.match(v.cause, /outside 0-50/);
});

test('a has-ratio IPO row no longer passes a document on its own (review: per document)', () => {
  // The old verdict passed on `hasRatio`. The document's own evidence decides now.
  const v = ratioYieldVerdict({ hasRatio: true, stepEvidence: e9({ current_ratio: 'ratio_row_not_in_note' }),
    extractorVersion: RATIO_FIXED_EXTRACTOR_VERSION });
  assert.equal(v.status, 'FAIL');
});

test('"no note" PASSES only when no page prints a Current Ratio line', () => {
  const clean = { ...readFor(null, '2026-03-31'), value: null, period: null, current_ratio_line_pages: [] };
  assert.equal(judge(e9({ current_ratio: 'ratio_note_not_in_document', quick_ratio: QUICK }, clean)).status, 'PASS');
});

test('"no note" while a page prints a Current Ratio line FAILS (Studds, Water Infra)', () => {
  const lying = { ...readFor(null, '2025-03-31'), value: null, period: null, current_ratio_line_pages: [321] };
  const v = judge(e9({ current_ratio: 'ratio_note_not_in_document' }, lying));
  assert.equal(v.status, 'FAIL');
  assert.match(v.cause, /page\(s\) 321 print a Current Ratio line/);
});

test('"no note" with no page evidence recorded FAILS', () => {
  assert.equal(judge(e9({ current_ratio: 'ratio_note_not_in_document' })).status, 'FAIL');
});

test('ratio_row_not_in_note is a reader gap FAIL', () => {
  const v = judge(e9({ current_ratio: 'ratio_row_not_in_note', quick_ratio: QUICK }));
  assert.equal(v.status, 'FAIL');
  assert.match(v.cause, /reader gap/);
});

for (const reason of ['ratio_period_headings_unreadable', 'ratio_heading_count_differs_from_value_count',
  'ratio_latest_period_not_in_headings', 'ratio_rows_disagree_for_latest_period', 'ratio_value_out_of_range',
  'ratio_basis_differs_from_statement', 'ratio_statement_period_unknown']) {
  test(`a named refusal (${reason}) is REFUSED, not PASS and not FAIL`, () => {
    assert.deepEqual(judge(e9({ current_ratio: reason, quick_ratio: QUICK })), { status: 'REFUSED', cause: reason });
  });
}

test("quick_ratio's always-present reason does NOT excuse a missing current ratio", () => {
  assert.equal(judge(e9({ quick_ratio: QUICK })).cause, 'no current_ratio and no recorded reason');
});

test('no E9 row at all FAILS', () => {
  assert.equal(judge('').status, 'FAIL');
});

// ------------------------------------------------------------- scope
const FIXED = RATIO_FIXED_EXTRACTOR_VERSION;

test('the scraper writes a version the verdict counts as fixed (pins the two constants)', () => {
  const src = readFileSync(new URL('../../scraper/src/services/filing-auto-persist.ts', import.meta.url), 'utf8');
  const m = src.match(/export const EXTRACTOR_VERSION = '([^']+)'/);
  assert.ok(m, 'EXTRACTOR_VERSION literal not found');
  assert.equal(isFixedExtractorVersion(m[1]), true, `${m[1]} is older than ${FIXED}`);
});

test('versions compare by stored value; the round-2 reader is not fixed', () => {
  assert.equal(isFixedExtractorVersion(FIXED), true);
  assert.equal(isFixedExtractorVersion('extract_filing.py@2026-10-01'), true);
  assert.equal(isFixedExtractorVersion('extract_filing.py@2026-09-26b'), false);
  assert.equal(isFixedExtractorVersion('extract_filing.py@2026-09-26'), false);
  assert.equal(isFixedExtractorVersion(null), false);
  assert.equal(isFixedExtractorVersion('other.py@2027-01-01'), false);
});

test('a pre-fix document is PENDING re-read, never FAIL (R5)', () => {
  assert.equal(ratioYieldVerdict({ stepEvidence: '', extractorVersion: 'extract_filing.py@2026-09-26b' }).status, 'PENDING');
});

test('an all-pending population is UNVERIFIABLE, not PASS', () => {
  const s = summarizeRatioYield([{ status: 'PENDING' }, { status: 'PENDING' }]);
  assert.deepEqual(s, { status: 'UNVERIFIABLE', judged: 0, pending: 2, refused: 0, fails: 0 });
});

test('refusals are judged and counted but do not fail the check; one FAIL does', () => {
  assert.deepEqual(summarizeRatioYield([{ status: 'REFUSED' }, { status: 'PASS' }, { status: 'PENDING' }]),
    { status: 'PASS', judged: 2, pending: 1, refused: 1, fails: 0 });
  assert.deepEqual(summarizeRatioYield([{ status: 'PENDING' }, { status: 'FAIL' }, { status: 'PASS' }]),
    { status: 'FAIL', judged: 2, pending: 1, refused: 0, fails: 1 });
});
