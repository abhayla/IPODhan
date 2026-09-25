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
  slotsAgoBoundary,
  FIELD_PLAN_SLOT_IST_MINUTES,
  PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS,
  isStuckReclaimRow,
  isStrandedPendingRow,
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

// ---- #936: "two slots ago" was really "one slot ago" (self-composed boundary is a no-op) --------

test('(#936) slotsAgoBoundary: one slot ago != two slots ago — the exact bug (calling the boundary fn on its own output is a no-op)', () => {
  const now = istToUtc('2026-09-15', 14, 0); // exactly the 14:00 IST slot boundary
  const oneAgo = slotsAgoBoundary(now, 1); // 14:00 IST (the current slot itself)
  const twoAgo = slotsAgoBoundary(now, 2); // 08:00 IST (one slot before the current one)
  assert.equal(oneAgo.toISOString(), istToUtc('2026-09-15', 14, 0).toISOString());
  assert.equal(twoAgo.toISOString(), istToUtc('2026-09-15', 8, 0).toISOString());
  assert.notEqual(oneAgo.getTime(), twoAgo.getTime(), 'one-slot-ago and two-slots-ago boundaries must differ — the naive MRB(MRB(now)) call made them identical');
  // The naive, buggy composition — kept here as a comment, not code, so this test documents the
  // exact regression without reintroducing it:
  //   const buggyTwoAgo = mostRecentFieldPlanSlotBoundary(mostRecentFieldPlanSlotBoundary(now));
  //   buggyTwoAgo.getTime() === oneAgo.getTime() // true — the bug
});

test('(#936) isStuckReclaimRow: RED under the old bug — a row attempted 09:00 IST (one slot old, normal cadence) at now=14:00 IST must NOT be stuck', () => {
  // Under the pre-fix code, the threshold was MRB(MRB(now)) = MRB(14:00) = 14:00 IST (a no-op
  // second call), so ANY lastAttemptAt before the current slot's own start read as stuck — even a
  // row attempted only one slot ago, inside the *previous* slot window [08:00, 14:00). This is
  // the discriminating case #936 asked for: a real "one slot old" row must read as healthy.
  const now = istToUtc('2026-09-15', 14, 0);
  const row = {
    state: 'NOT_AVAILABLE_YET',
    attempts: 1,
    claimedAt: null,
    lastAttemptAt: istToUtc('2026-09-15', 9, 0).toISOString(), // inside the 08:00 slot -- one slot old
  };
  assert.equal(isStuckReclaimRow(row, now), false, 'one slot of lag is normal cadence (per this check\'s own doc comment) -- must not be flagged stuck');
});

test('(#936) isStuckReclaimRow: a row attempted before the 08:00 slot (two slots old) at now=14:00 IST IS stuck', () => {
  const now = istToUtc('2026-09-15', 14, 0);
  const row = {
    state: 'NOT_AVAILABLE_YET',
    attempts: 1,
    claimedAt: null,
    lastAttemptAt: istToUtc('2026-09-15', 7, 59).toISOString(), // just before the 08:00 slot -- two slots old
  };
  assert.equal(isStuckReclaimRow(row, now), true);
});

test('(#936) isStrandedPendingRow: same class — a row last attempted one slot ago (inside [08:00,14:00)) is not stranded at now=14:00 IST', () => {
  const now = istToUtc('2026-09-15', 14, 0);
  const row = {
    state: 'PENDING',
    claimedAt: null,
    ipoStatus: 'OPEN',
    nextDueAt: null,
    createdAt: istToUtc('2026-09-14', 0, 0).toISOString(),
    lastAttemptAt: istToUtc('2026-09-15', 9, 0).toISOString(),
  };
  assert.equal(isStrandedPendingRow(row, now), false);
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

// ---- PULL-PLAN-PENDING-STRANDED: isStrandedPendingRow -------------------
// Real shape, ipodhan_staging 2026-09-25 02:35 IST: 26 gmp_records.gmp rows
// (e.g. veegaland-developers-ltd, CLOSED, plan row 90f555a1) PENDING, next_due_at
// 2026-09-23 19:09 UTC, last_attempt_at 2026-09-23 18:54 UTC, attempts 0. The
// walk claims each one every wake, INVESTORGAIN_GMP answers, the write is
// DROPPED (MISSING_ROW_KEY) and the row goes back to PENDING with nothing
// advanced. pull_plan_stuck_reclaim never reads PENDING, so nothing reported it.

const NOW_0235_IST = new Date('2026-09-24T21:05:00.000Z');
const veegaland = {
  state: 'PENDING', ipoStatus: 'CLOSED', attempts: 0, claimedAt: null,
  createdAt: '2026-09-23T13:00:00.000Z',
  nextDueAt: '2026-09-23T19:09:19.442Z',
  lastAttemptAt: '2026-09-23T18:54:19.442Z',
};

test('(stranded) RED — the real veegaland gmp row: due PENDING on a live IPO, last attempt 2+ slots old', () => {
  assert.equal(isStrandedPendingRow(veegaland, NOW_0235_IST), true);
});

test('(stranded) RED — due PENDING, never attempted, created 2+ slots ago', () => {
  assert.equal(isStrandedPendingRow({ ...veegaland, nextDueAt: null, lastAttemptAt: null }, NOW_0235_IST), true);
});

test('(stranded) GREEN — a PENDING row created within the last two slots is new work', () => {
  assert.equal(isStrandedPendingRow({ ...veegaland, createdAt: '2026-09-24T20:00:00.000Z', lastAttemptAt: null }, NOW_0235_IST), false);
});

test('(stranded) GREEN — a PENDING row not yet due is waiting', () => {
  assert.equal(isStrandedPendingRow({ ...veegaland, nextDueAt: '2026-09-25T02:30:00.000Z' }, NOW_0235_IST), false);
});

test('(stranded) GREEN — last attempt within the last slot is normal cadence', () => {
  assert.equal(isStrandedPendingRow({ ...veegaland, lastAttemptAt: '2026-09-24T18:40:00.000Z' }, NOW_0235_IST), false);
});

test('(stranded) GREEN — a LISTED or WITHDRAWN IPO is not in scope; a claimed row is owned by a walker; other states are not PENDING', () => {
  assert.equal(isStrandedPendingRow({ ...veegaland, ipoStatus: 'LISTED' }, NOW_0235_IST), false);
  assert.equal(isStrandedPendingRow({ ...veegaland, ipoStatus: 'WITHDRAWN' }, NOW_0235_IST), false);
  assert.equal(isStrandedPendingRow({ ...veegaland, claimedAt: '2026-09-24T21:00:00.000Z' }, NOW_0235_IST), false);
  for (const state of ['SUPPLIED', 'NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED']) {
    assert.equal(isStrandedPendingRow({ ...veegaland, state }, NOW_0235_IST), false, state);
  }
});

test('(stranded) the floor check filters through isStrandedPendingRow (one definition) and records pull_plan_pending_stranded', () => {
  const src = readFileSync(new URL('../audit-detection-floor.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('async function checkS_pullPlanPendingStranded');
  assert.ok(start > 0, 'check function exists');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /isStrandedPendingRow\(/);
  assert.match(body, /record\('pull_plan_pending_stranded'/);
  assert.match(src, /await checkS_pullPlanPendingStranded\(\)/, 'the check is invoked by the floor run');
});
