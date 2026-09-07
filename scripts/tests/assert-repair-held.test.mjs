// Self-test for scripts/assert-repair-held.mjs (#192, T-466). No real DB /
// timers: `readMarker` and `runInvariant` are fakes injected into
// pollForCycles directly (the same function the CLI calls), and `sleepFn`/
// `nowFn` are injected so the test runs in milliseconds, not minutes.
// Run: node scripts/tests/assert-repair-held.test.mjs
import assert from 'node:assert/strict';
import { pollForCycles } from '../assert-repair-held.mjs';

let FAILED = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    FAILED = 1;
    console.log(`FAIL: ${name}`);
    console.log(`  ${err.message}`);
  }
}

// Fake clock: nowFn advances only when sleepFn is awaited, so "distinct
// cycles" is fully deterministic.
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    nowFn: () => t,
    sleepFn: async (ms) => { t += ms; },
  };
}

await test('held: 2 clean cycles -> held=true, exit-equivalent 0', async () => {
  const { nowFn, sleepFn } = fakeClock();
  // Marker advances by 5 min every poll (poll = 60s, cycleGap = 4min) so
  // every poll after the first counts as a new cycle.
  let markerMs = 0;
  const readMarker = async () => {
    markerMs += 5 * 60 * 1000;
    return { maxRowTs: new Date(markerMs), maxLogTs: null, hasScraperLogs: true };
  };
  const runInvariant = async () => ({ count: 0 });
  const result = await pollForCycles({
    runInvariant, readMarker, cycles: 2, timeoutMs: 60 * 60 * 1000,
    cycleGapMs: 4 * 60 * 1000, pollMs: 60 * 1000, sleepFn, nowFn,
  });
  assert.equal(result.held, true);
  assert.equal(result.unverifiable, false);
  assert.equal(result.cyclesObserved, 2);
  assert.deepEqual(result.perCycle.map((c) => c.count), [0, 0]);
});

// The exact fixture named in the #192 failing-test spec: violation count is
// 0 immediately after "repair" but rebounds to >0 on cycle 2 of 2.
await test('regression on cycle 2: count 0 is immediately after repair but rebounds -> FAIL loudly with per-cycle counts', async () => {
  const { nowFn, sleepFn } = fakeClock();
  let markerMs = 0;
  let cycle = 0;
  const readMarker = async () => {
    markerMs += 5 * 60 * 1000;
    return { maxRowTs: new Date(markerMs), maxLogTs: null, hasScraperLogs: true };
  };
  const runInvariant = async () => {
    cycle += 1;
    return { count: cycle >= 2 ? 3 : 0 }; // rebounds on the 2nd observed cycle
  };
  const result = await pollForCycles({
    runInvariant, readMarker, cycles: 2, timeoutMs: 60 * 60 * 1000,
    cycleGapMs: 4 * 60 * 1000, pollMs: 60 * 1000, sleepFn, nowFn,
  });
  assert.equal(result.held, false);
  assert.equal(result.unverifiable, false);
  assert.equal(result.cyclesObserved, 2);
  assert.deepEqual(result.perCycle.map((c) => c.count), [0, 3]);
  assert.match(result.reason, /REGRESSION on cycle 2/);
});

await test('marker never advances -> UNVERIFIABLE (exit 2), never a silent pass', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const readMarker = async () => ({ maxRowTs: new Date(0), maxLogTs: null, hasScraperLogs: true }); // frozen
  const runInvariant = async () => ({ count: 0 });
  const result = await pollForCycles({
    runInvariant, readMarker, cycles: 2, timeoutMs: 5 * 60 * 1000,
    cycleGapMs: 4 * 60 * 1000, pollMs: 60 * 1000, sleepFn, nowFn,
  });
  assert.equal(result.held, false);
  assert.equal(result.unverifiable, true);
  assert.equal(result.cyclesObserved, 0);
  assert.match(result.reason, /timeout/);
});

await test('invariant crash mid-poll -> UNVERIFIABLE, not a silent pass or a false FAIL', async () => {
  const { nowFn, sleepFn } = fakeClock();
  let markerMs = 0;
  const readMarker = async () => {
    markerMs += 5 * 60 * 1000;
    return { maxRowTs: new Date(markerMs), maxLogTs: null, hasScraperLogs: true };
  };
  const runInvariant = async () => { throw new Error('DB connection reset'); };
  const result = await pollForCycles({
    runInvariant, readMarker, cycles: 2, timeoutMs: 60 * 60 * 1000,
    cycleGapMs: 4 * 60 * 1000, pollMs: 60 * 1000, sleepFn, nowFn,
  });
  assert.equal(result.unverifiable, true);
  assert.match(result.reason, /invariant crashed mid-poll/);
});

await test('sub-gap marker noise (multiple writes in one wake) collapses into ONE cycle, not several', async () => {
  const { nowFn, sleepFn } = fakeClock();
  // Advances by 30s per poll (< 4min gap) for the first 6 polls (simulating
  // one wake's burst of writes), then jumps 5min (a real new cycle), then
  // another 30s-burst, then another 5min jump -> exactly 2 distinct cycles.
  const advances = [30, 30, 30, 30, 30, 30, 300, 30, 30, 300].map((s) => s * 1000);
  let markerMs = 0;
  let i = 0;
  const readMarker = async () => {
    markerMs += advances[Math.min(i++, advances.length - 1)];
    return { maxRowTs: new Date(markerMs), maxLogTs: null, hasScraperLogs: true };
  };
  const runInvariant = async () => ({ count: 0 });
  const result = await pollForCycles({
    runInvariant, readMarker, cycles: 2, timeoutMs: 60 * 60 * 1000,
    cycleGapMs: 4 * 60 * 1000, pollMs: 60 * 1000, sleepFn, nowFn,
  });
  assert.equal(result.held, true);
  assert.equal(result.cyclesObserved, 2);
});

process.exit(FAILED);
