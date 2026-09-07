// Failing-test-first for issue #191 (G-F). Pure, no DB. Run:
//   node --test scripts/lib/signal-health-checks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRepeatedMessages,
  classifyConflictBacklogCeiling,
  classifyInertDetector,
  REPEATED_MESSAGE_MAX_OCCURRENCES_24H,
  CONFLICT_BACKLOG_MAX_UNRESOLVED,
} from './signal-health-checks.mjs';

// ---- F1 ----------------------------------------------------------------
test('F1: a message logged 25x in 24h FAILs (fixture from #191 — InvIT/REIT WARN 20+/cycle)', () => {
  const rows = [{ message: 'InvIT/REIT unit-price mis-typed as currency', count: 25 }];
  const cls = classifyRepeatedMessages(rows);
  assert.equal(cls.fail, true);
  assert.equal(cls.offenders.length, 1);
});

test('F1: exactly at the threshold does not FAIL (> not >=)', () => {
  const rows = [{ message: 'noisy but tolerated', count: REPEATED_MESSAGE_MAX_OCCURRENCES_24H }];
  assert.equal(classifyRepeatedMessages(rows).fail, false);
});

test('F1: below threshold PASSes; no rows PASSes', () => {
  assert.equal(classifyRepeatedMessages([{ message: 'rare', count: 3 }]).fail, false);
  assert.equal(classifyRepeatedMessages([]).fail, false);
});

// ---- F2 ----------------------------------------------------------------
test('F2: 11,493 unresolved conflicts (T-285 fixture) FAILs the absolute ceiling', () => {
  const cls = classifyConflictBacklogCeiling(11493);
  assert.equal(cls.fail, true);
  assert.equal(cls.ceiling, CONFLICT_BACKLOG_MAX_UNRESOLVED);
});

test('F2: below the ceiling PASSes', () => {
  assert.equal(classifyConflictBacklogCeiling(50).fail, false);
});

// ---- F3 ----------------------------------------------------------------
test('F3: checkPriceBand violations > 0 AND 0 conflicts inserted in 24h -> inert detector FAIL (T-272 P3-5 fixture)', () => {
  const cls = classifyInertDetector(4, 0);
  assert.equal(cls.fail, true);
  assert.equal(cls.violations, 4);
});

test('F3: violations > 0 with conflicts actually inserted is healthy, not inert', () => {
  assert.equal(classifyInertDetector(4, 2).fail, false);
});

test('F3: no violations and 0 inserted is genuinely healthy (not inert)', () => {
  assert.equal(classifyInertDetector(0, 0).fail, false);
});
