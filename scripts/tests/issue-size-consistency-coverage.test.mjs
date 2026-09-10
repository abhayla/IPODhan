// Item 14 slice 4 — c_issue_size_consistency must say how many rows it examined,
// and must never report PASS having examined none.
//
// MEASURED 2026-09-11, read-only, before this was written:
//   production: 24 of 277 IPO rows examinable (8.7%) — 253 skipped, no shares_offered
//   staging:    24 of 323
// and it skips NIRBHAY COLOURS and PIYUSH LIMITED specifically — the exact two
// rows c_issue_size_floor flags. So item 14's proof recipe paired a check that
// FAILS on two rows with a check that PASSES having never looked at them, and the
// detail line read "0 violation(s)" with no coverage at all. A reader cannot tell
// 0-of-277-clean from 0-of-24-looked-at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkIssueSizeSharesConsistency,
  issueSizeConsistencyExaminable,
  summariseIssueSizeConsistency,
} from '../lib/detection-floor-checks.mjs';

const examinable = { issueSize: 1000000, sharesOffered: 1000, priceRangeMax: 1000 };

test('a row without shares_offered is NOT examinable (the 91% case)', () => {
  assert.equal(issueSizeConsistencyExaminable({ ...examinable, sharesOffered: null }), false);
  assert.equal(issueSizeConsistencyExaminable({ ...examinable, priceRangeMax: null }), false);
  assert.equal(issueSizeConsistencyExaminable({ ...examinable, issueSize: 0 }), false);
});

test('a row with all three values IS examinable', () => {
  assert.equal(issueSizeConsistencyExaminable(examinable), true);
});

test('the predicate still returns null for an examinable, consistent row', () => {
  assert.equal(checkIssueSizeSharesConsistency(examinable), null);
});

test('skipped and clean are no longer conflated — the summary separates them', () => {
  const rows = [
    examinable,                                   // examined, clean
    { ...examinable, sharesOffered: null },       // skipped
    { ...examinable, sharesOffered: null },       // skipped
  ];
  const s = summariseIssueSizeConsistency(rows);
  assert.equal(s.examined, 1);
  assert.equal(s.skipped, 2);
  assert.equal(s.total, 3);
  assert.equal(s.violations.length, 0);
  assert.equal(s.status, 'PASS');
  // The whole point: the detail states coverage, so "0 violations" cannot be
  // read as "277 rows are clean".
  assert.match(s.detail, /examined 1 of 3/);
  assert.match(s.detail, /2 skipped/);
});

test('examining NOTHING is UNVERIFIABLE, never PASS', () => {
  const rows = [
    { ...examinable, sharesOffered: null },
    { ...examinable, sharesOffered: null },
  ];
  const s = summariseIssueSizeConsistency(rows);
  assert.equal(s.examined, 0);
  assert.equal(s.status, 'UNVERIFIABLE');
  assert.match(s.detail, /examined 0 of 2/);
});

test('an empty population is UNVERIFIABLE too — a scan of nothing is not a pass', () => {
  const s = summariseIssueSizeConsistency([]);
  assert.equal(s.status, 'UNVERIFIABLE');
  assert.equal(s.examined, 0);
});

test('a real violation still FAILS and is still named', () => {
  const bad = { issueSize: 10490, sharesOffered: 1000000, priceRangeMax: 100 };
  const s = summariseIssueSizeConsistency([bad, examinable]);
  assert.equal(s.status, 'FAIL');
  assert.equal(s.examined, 2);
  assert.equal(s.violations.length, 1);
  assert.match(s.detail, /examined 2 of 2/);
});
