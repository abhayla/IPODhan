// scripts/lib/ist-day.mjs — #687 slice 1: the IST calendar day for run
// labels, state-file names and dedupe keys.
//
// WHY: `new Date().toISOString().slice(0, 10)` (or `.split('T')[0]`) is the
// UTC calendar day. The nightly floor runs at 02:00 IST, when UTC is still
// the previous day, so every run label / state file / dedupe key built this
// way is off by one for the first 5h30m of the IST day (same family as
// #682/#689, fixed there for the status updater and due-step-cycle).
//
// SOURCE OF TRUTH: packages/shared/src/utils/ist-day.ts (istDayIso). This
// file is the one deliberate duplicate of it — plain-Node scripts/*.mjs
// cannot import TypeScript — and scripts/tests/ist-day.test.mjs pins the two
// to identical output at the day boundaries (#687 slice 4). Change the
// shared TS file first, then mirror it here.
//
// A fixed +5:30 offset applied to the epoch instant, read back with UTC
// getters — never setHours()/local time, which would pick up the HOST's
// timezone instead of IST.

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** "YYYY-MM-DD" for `now` in IST (Asia/Kolkata, UTC+5:30, no DST). */
export function istDayIso(now = new Date()) {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
