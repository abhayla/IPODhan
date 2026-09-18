// #762 (S8) review round 1: F6 + MAJOR-3.
//
// F6: checkS_pullPlanStuckReclaim (audit-detection-floor.mjs) shipped with
// NO test. Nothing would have caught the flat `interval '7 hours'` error
// (the real max gap between two consecutive discovery slots is 18.5h, not
// ~7h) — this file pins the pure isStuckReclaimRow predicate RED on a
// planted stuck row and GREEN on a clean one.
//
// MAJOR-3: the repository's doc comment claimed "a test in this package
// pins these values equal to the scraper module's, so the two can never
// drift silently" — FALSE. The slot list was typed a THIRD time in
// packages/shared's own test, which compared copy-2 against copy-3, both
// inside packages/shared; changing scraper/src/scheduler/due-step-cycle.ts
// broke nothing. packages/shared cannot import scraper/src (the dependency
// runs the other way — see either file's own header), so the guard here
// reads and PARSES the real due-step-cycle.ts SOURCE TEXT and compares its
// DISCOVERY_SLOTS_IST_MINUTES literal against this module's own constant —
// a genuine cross-file guard, not two copies compared against each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mostRecentFieldPlanSlotBoundary,
  FIELD_PLAN_SLOT_IST_MINUTES,
  PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS,
  isStuckReclaimRow,
} from '../lib/field-plan-slot.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DUE_STEP_CYCLE_PATH = join(REPO_ROOT, 'scraper', 'src', 'scheduler', 'due-step-cycle.ts');

function istToUtc(dateIso, hh, mm) {
  const utcMs = Date.parse(`${dateIso}T00:00:00.000Z`) + (hh * 60 + mm - 5 * 60 - 30) * 60_000;
  return new Date(utcMs);
}

// ---- MAJOR-3: a REAL cross-file drift guard --------------------------------

test('(drift guard, MAJOR-3) DISCOVERY_SLOTS_IST_MINUTES parsed from the REAL scraper source equals field-plan-slot.mjs', () => {
  const source = readFileSync(DUE_STEP_CYCLE_PATH, 'utf8');
  const match = source.match(/export const DISCOVERY_SLOTS_IST_MINUTES\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, 'DISCOVERY_SLOTS_IST_MINUTES not found in due-step-cycle.ts — the drift guard cannot verify anything');
  // eslint-disable-next-line no-eval -- reading a small numeric-literal array from our own repo's source, not user input
  const parsed = eval(`[${match[1]}]`);
  assert.deepEqual(
    parsed,
    FIELD_PLAN_SLOT_IST_MINUTES,
    'field-plan-slot.mjs (used by both the claim query duplicate in ' +
      'ipo-field-plan-repository.ts and the detection check here) has drifted from ' +
      'the real scraper/src/scheduler/due-step-cycle.ts source — update field-plan-slot.mjs, ' +
      'and the TS duplicate in packages/shared, to match'
  );
});

test('(drift guard, MAJOR-3) mutating due-step-cycle.ts in a scratch copy is caught by re-parsing it', () => {
  const source = readFileSync(DUE_STEP_CYCLE_PATH, 'utf8');
  const mutated = source.replace(
    /export const DISCOVERY_SLOTS_IST_MINUTES = \[8 \* 60 \+ 30, 11 \* 60, 14 \* 60, 17 \* 60 \+ 30\] as const;/,
    'export const DISCOVERY_SLOTS_IST_MINUTES = [9 * 60, 12 * 60, 15 * 60, 18 * 60] as const;'
  );
  assert.notEqual(mutated, source, 'the mutation target text was not found — the real file has changed shape; update this test');
  const match = mutated.match(/export const DISCOVERY_SLOTS_IST_MINUTES\s*=\s*\[([^\]]+)\]/);
  // eslint-disable-next-line no-eval
  const parsedMutated = eval(`[${match[1]}]`);
  assert.notDeepEqual(
    parsedMutated,
    FIELD_PLAN_SLOT_IST_MINUTES,
    'a mutated due-step-cycle.ts must produce a DIFFERENT parsed value than field-plan-slot.mjs — proves the guard can actually fail'
  );
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

test('mostRecentFieldPlanSlotBoundary: the real max span of two ADJACENT gaps is 18.5h (900+210 min), never ~7h', () => {
  // Gaps between consecutive slot boundaries, walking the cycle:
  // 08:30->11:00 (150), 11:00->14:00 (180), 14:00->17:30 (210), 17:30->next 08:30 (900, overnight).
  const gaps = [];
  for (let i = 1; i < FIELD_PLAN_SLOT_IST_MINUTES.length; i++) {
    gaps.push(FIELD_PLAN_SLOT_IST_MINUTES[i] - FIELD_PLAN_SLOT_IST_MINUTES[i - 1]);
  }
  const overnightGap =
    24 * 60 - FIELD_PLAN_SLOT_IST_MINUTES[FIELD_PLAN_SLOT_IST_MINUTES.length - 1] + FIELD_PLAN_SLOT_IST_MINUTES[0];
  gaps.push(overnightGap);
  assert.deepEqual(gaps, [150, 180, 210, 900], 'the four gap minutes must match the coordinator\'s measured [150, 180, 210, 900]');
  // Two ADJACENT gaps (the span a row can sit un-reclaimed across, from just
  // after one slot to just before the slot-after-next): the worst case is
  // the 210-minute gap immediately followed by the 900-minute overnight gap
  // (a row attempted just after 14:00, checked again just before the NEXT
  // day's 08:30) = 1110 minutes = 18.5h -- the exact figure CRITICAL-1 cited.
  let maxAdjacentSpan = 0;
  for (let i = 0; i < gaps.length; i++) {
    const next = gaps[(i + 1) % gaps.length];
    maxAdjacentSpan = Math.max(maxAdjacentSpan, gaps[i] + next);
  }
  assert.equal(maxAdjacentSpan, 1110, `two adjacent slot gaps must be able to span exactly 1110 minutes (18.5h); got ${maxAdjacentSpan} minutes`);
  assert.ok(maxAdjacentSpan > 7 * 60, 'the old flat 7-hour threshold is smaller than the real worst case, hence the nightly false-positive');
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

test('(regression, CRITICAL-1) a row attempted at 17:35 IST is NOT stuck at 02:00 IST the same night (the flat-7h bug would have flagged it)', () => {
  const lastAttemptAt = istToUtc('2026-09-15', 17, 35).toISOString(); // just after the 17:30 slot
  const now = istToUtc('2026-09-16', 2, 0); // 02:00 IST the next night -- 8h25m later, > the old flat 7h threshold
  const row = { state: 'NOT_AVAILABLE_YET', attempts: 0, claimedAt: null, lastAttemptAt };
  assert.equal(
    isStuckReclaimRow(row, now),
    false,
    'a row attempted just after the last slot of the day, checked overnight before the next slot fires, must NOT be flagged — this is exactly the false-positive the flat interval produced every night'
  );
});
