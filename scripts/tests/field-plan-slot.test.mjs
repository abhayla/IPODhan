// #762 (S8) review round 1: F6 + MAJOR-3, and item 7 S2 (OD-19 slots).
//
// F6: checkS_pullPlanStuckReclaim (audit-detection-floor.mjs) shipped with
// NO test; this file pins the pure isStuckReclaimRow predicate RED on a
// planted stuck row and GREEN on a clean one.
//
// Item 7 S2: the slot list lives ONCE, in
// packages/shared/src/scheduler/data-job-slots.ts (OD-19: 00:00, 08:00,
// 14:00 IST). field-plan-slot.mjs no longer keeps a typed copy — it parses
// that file at load. The guards below prove (a) the parsed value is the real
// file's value, (b) a mutated file parses to something different, and (c) a
// file the parser cannot read throws instead of guessing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mostRecentFieldPlanSlotBoundary,
  FIELD_PLAN_SLOT_IST_MINUTES,
  PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS,
  isStuckReclaimRow,
  parseDataJobSlotsFromSource,
  DATA_JOB_SLOTS_SOURCE_PATH,
} from '../lib/field-plan-slot.mjs';

function istToUtc(dateIso, hh, mm) {
  const utcMs = Date.parse(`${dateIso}T00:00:00.000Z`) + (hh * 60 + mm - 5 * 60 - 30) * 60_000;
  return new Date(utcMs);
}

// ---- the one definition, read not retyped ---------------------------------

test('(S2) the slots field-plan-slot.mjs uses are the ones parsed from data-job-slots.ts, and they are OD-19\'s', () => {
  assert.match(DATA_JOB_SLOTS_SOURCE_PATH.split('\\').join('/'), /packages\/shared\/src\/scheduler\/data-job-slots\.ts$/);
  const parsed = parseDataJobSlotsFromSource(readFileSync(DATA_JOB_SLOTS_SOURCE_PATH, 'utf8'));
  assert.deepEqual(parsed, [0, 480, 840]);
  assert.deepEqual([...FIELD_PLAN_SLOT_IST_MINUTES], parsed);
});

test('(S2 mutation) a changed slot literal parses to a different list — the reader cannot pass a drifted file', () => {
  const source = readFileSync(DATA_JOB_SLOTS_SOURCE_PATH, 'utf8');
  const mutated = source.replace(
    'export const DATA_JOB_SLOTS_IST_MINUTES = [0, 480, 840] as const;',
    'export const DATA_JOB_SLOTS_IST_MINUTES = [0, 480, 900] as const;'
  );
  assert.notEqual(mutated, source, 'the mutation target text was not found — the real file changed shape; update this test');
  assert.notDeepEqual(parseDataJobSlotsFromSource(mutated), [...FIELD_PLAN_SLOT_IST_MINUTES]);
});

test('(S2) a slot literal that is not plain integers throws rather than being guessed at', () => {
  assert.throws(() => parseDataJobSlotsFromSource('export const DATA_JOB_SLOTS_IST_MINUTES = [8 * 60 + 30] as const;'));
  assert.throws(() => parseDataJobSlotsFromSource('export const DATA_JOB_SLOTS_IST_MINUTES = [0, 1500] as const;'));
  assert.throws(() => parseDataJobSlotsFromSource('no slots here'));
});

// ---- mostRecentFieldPlanSlotBoundary sanity (mirrors the TS unit tests) ----

test('mostRecentFieldPlanSlotBoundary: at each slot minute, returns that same instant', () => {
  for (const slotMinutes of FIELD_PLAN_SLOT_IST_MINUTES) {
    const hh = Math.floor(slotMinutes / 60);
    const mm = slotMinutes % 60;
    const now = istToUtc('2026-09-15', hh, mm);
    assert.equal(mostRecentFieldPlanSlotBoundary(now).getTime(), now.getTime());
  }
});

test('mostRecentFieldPlanSlotBoundary: slot gaps are [480, 360, 600] minutes; two adjacent gaps span at most 18h', () => {
  // 00:00->08:00 (480), 08:00->14:00 (360), 14:00->next 00:00 (600).
  const gaps = [];
  for (let i = 1; i < FIELD_PLAN_SLOT_IST_MINUTES.length; i++) {
    gaps.push(FIELD_PLAN_SLOT_IST_MINUTES[i] - FIELD_PLAN_SLOT_IST_MINUTES[i - 1]);
  }
  gaps.push(24 * 60 - FIELD_PLAN_SLOT_IST_MINUTES[FIELD_PLAN_SLOT_IST_MINUTES.length - 1] + FIELD_PLAN_SLOT_IST_MINUTES[0]);
  assert.deepEqual(gaps, [480, 360, 600]);
  let maxAdjacentSpan = 0;
  for (let i = 0; i < gaps.length; i++) {
    maxAdjacentSpan = Math.max(maxAdjacentSpan, gaps[i] + gaps[(i + 1) % gaps.length]);
  }
  assert.equal(maxAdjacentSpan, 1080, `two adjacent slot gaps must span exactly 1080 minutes (18h); got ${maxAdjacentSpan}`);
  assert.ok(maxAdjacentSpan > 7 * 60, 'a flat 7-hour threshold is still smaller than the real worst case');
});

// ---- F6: isStuckReclaimRow RED on a planted stuck row, GREEN on clean -----

test('(F6) isStuckReclaimRow: RED — a NOT_AVAILABLE_YET row unclaimed since 2 slot boundaries back IS stuck', () => {
  const now = istToUtc('2026-09-15', 14, 0); // 14:00 IST slot
  const row = {
    state: 'NOT_AVAILABLE_YET',
    attempts: 1,
    claimedAt: null,
    lastAttemptAt: istToUtc('2026-09-15', 7, 0).toISOString(), // before the 08:30 slot -> 2 boundaries back
  };
  assert.equal(isStuckReclaimRow(row, now), true);
});

test('(F6) isStuckReclaimRow: GREEN — a row attempted within the last slot is NOT stuck (clean/normal cadence)', () => {
  const now = istToUtc('2026-09-15', 14, 15); // just after the 14:00 slot
  const row = {
    state: 'NOT_AVAILABLE_YET',
    attempts: 1,
    claimedAt: null,
    lastAttemptAt: istToUtc('2026-09-15', 14, 5).toISOString(), // this same slot
  };
  assert.equal(isStuckReclaimRow(row, now), false);
});

test('(F6) isStuckReclaimRow: GREEN — a currently-claimed row is never stuck (a live walker owns it)', () => {
  const now = istToUtc('2026-09-15', 14, 0);
  const row = {
    state: 'NOT_AVAILABLE_YET',
    attempts: 1,
    claimedAt: new Date().toISOString(),
    lastAttemptAt: istToUtc('2026-09-14', 8, 0).toISOString(),
  };
  assert.equal(isStuckReclaimRow(row, now), false);
});

test('(F6) isStuckReclaimRow: GREEN — a CHECK_FAILED row at the attempts ceiling is never stuck (the churn guard, not a bug)', () => {
  const now = istToUtc('2026-09-15', 14, 0);
  const row = {
    state: 'CHECK_FAILED',
    attempts: PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS,
    claimedAt: null,
    lastAttemptAt: istToUtc('2026-09-14', 8, 0).toISOString(),
  };
  assert.equal(isStuckReclaimRow(row, now), false);
});

test('(F6) isStuckReclaimRow: RED — a CHECK_FAILED row below the ceiling, 2 slots stale, IS stuck', () => {
  const now = istToUtc('2026-09-15', 14, 0);
  const row = {
    state: 'CHECK_FAILED',
    attempts: PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS - 1,
    claimedAt: null,
    lastAttemptAt: istToUtc('2026-09-14', 8, 0).toISOString(),
  };
  assert.equal(isStuckReclaimRow(row, now), true);
});

test('(F6, F7 fix) isStuckReclaimRow: RED — a NULL last_attempt_at row is stuck immediately (not excluded)', () => {
  const now = istToUtc('2026-09-15', 14, 0);
  const row = { state: 'NOT_AVAILABLE_YET', attempts: 0, claimedAt: null, lastAttemptAt: null };
  assert.equal(isStuckReclaimRow(row, now), true, 'a null last_attempt_at must be treated as "due since forever", never excluded — the exact F7 blind spot');
});

test('(F6) isStuckReclaimRow: GREEN — SUPPLIED/PENDING/EXHAUSTED states are never in this check\'s population', () => {
  const now = istToUtc('2026-09-15', 14, 0);
  const stale = istToUtc('2026-09-14', 8, 0).toISOString();
  for (const state of ['SUPPLIED', 'PENDING', 'EXHAUSTED', 'NOT_PRINTED']) {
    assert.equal(isStuckReclaimRow({ state, attempts: 0, claimedAt: null, lastAttemptAt: stale }, now), false, `${state} must never be flagged stuck`);
  }
});

// ---- overnight false-positive regression (the exact bug this round fixed) -

test('(regression, CRITICAL-1) a row attempted at 14:05 IST is NOT stuck at 23:30 IST the same night (a flat 7h threshold would have flagged it)', () => {
  const lastAttemptAt = istToUtc('2026-09-15', 14, 5).toISOString(); // just after the 14:00 slot
  const now = istToUtc('2026-09-15', 23, 30); // 9h25m later, before the 00:00 slot
  const row = { state: 'NOT_AVAILABLE_YET', attempts: 0, claimedAt: null, lastAttemptAt };
  assert.equal(
    isStuckReclaimRow(row, now),
    false,
    'a row attempted just after the last slot of the day, checked before the next slot fires, must NOT be flagged'
  );
});
