// Self-test for scripts/assert-repair-held.mjs (#192, T-466; #698). No real DB /
// timers: the cycle reads and `runInvariant` are fakes injected into
// pollForCycles directly (the same function the CLI calls), and `sleepFn`/
// `nowFn` are injected so the test runs in milliseconds, not minutes.
// Run: node scripts/tests/assert-repair-held.test.mjs
//
// #698: a "cycle" is one completed data cycle, i.e. one `heartbeat` row in
// scraper_steps, and only cycles whose trigger is `schedule` count toward
// --cycles. A deploy restart (trigger `deploy`) or an unlabelled run (`unknown`
// or NULL) is observed, checked and printed, but never counted.
import assert from 'node:assert/strict';
import {
  pollForCycles,
  readCycleBaseline,
  readCyclesSince,
  isCountedCycle,
  formatCycleLine,
  CYCLE_BASELINE_SQL,
  CYCLES_SINCE_SQL,
} from '../assert-repair-held.mjs';

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

// Fake clock: nowFn advances only when sleepFn is awaited.
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    nowFn: () => t,
    sleepFn: async (ms) => { t += ms; },
  };
}

// A scripted scraper: each poll releases the next batch of heartbeat rows.
// Rows carry `at` as the DB's own UTC text, the way the real query returns it.
function scriptedCycles(batches) {
  let poll = 0;
  let seq = 0;
  const calls = [];
  const released = [];
  return {
    calls,
    readBaseline: async () => '2026-09-26 06:00:00',
    readSince: async (since) => {
      calls.push(since);
      const batch = batches[poll++] ?? [];
      for (const trigger of batch) {
        seq += 1;
        const mm = String(seq).padStart(2, '0');
        released.push({ cycleId: `c${seq}`, trigger, at: `2026-09-26 06:${mm}:00` });
      }
      return released.filter((r) => since === null || r.at > since);
    },
  };
}

const base = { timeoutMs: 60 * 60 * 1000, pollMs: 60 * 1000 };

await test('held: 2 scheduled cycles -> held=true', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['schedule'], ['schedule']]);
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => ({ count: 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, true);
  assert.equal(r.unverifiable, false);
  assert.equal(r.cyclesObserved, 2);
  assert.deepEqual(r.perCycle.map((c) => [c.trigger, c.counted, c.count]), [['schedule', true, 0], ['schedule', true, 0]]);
});

// The #698 case itself: a deploy restart lands between scheduled wakes. Before
// this change it counted as the second cycle and the tool said HELD after one
// real scheduled cycle.
await test('#698: a deploy restart between scheduled wakes is NOT counted -> still waiting, UNVERIFIABLE at timeout', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['schedule'], ['deploy']]);
  const r = await pollForCycles({ ...base, timeoutMs: 10 * 60 * 1000, cycles: 2, runInvariant: async () => ({ count: 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, false);
  assert.equal(r.unverifiable, true);
  assert.equal(r.cyclesObserved, 1);
  assert.deepEqual(r.perCycle.map((c) => [c.trigger, c.counted]), [['schedule', true], ['deploy', false]]);
  assert.match(r.reason, /observed 1 scheduled cycle\(s\) and 1 not counted/);
});

await test('deploy restart in between, then a 2nd scheduled cycle -> held with 2 counted, 1 not counted', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['schedule'], ['deploy'], ['schedule']]);
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => ({ count: 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, true);
  assert.equal(r.cyclesObserved, 2);
  assert.deepEqual(r.perCycle.map((c) => [c.cycleId, c.trigger, c.counted]), [['c1', 'schedule', true], ['c2', 'deploy', false], ['c3', 'schedule', true]]);
});

await test('unknown and NULL triggers are never counted; NULL is reported as unknown', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['unknown', null], ['schedule'], ['schedule']]);
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => ({ count: 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, true);
  assert.deepEqual(r.perCycle.map((c) => [c.trigger, c.counted]), [['unknown', false], ['unknown', false], ['schedule', true], ['schedule', true]]);
});

await test('--allow-restarts counts deploy and unknown cycles (the old counting, explicitly)', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['schedule'], ['deploy']]);
  const r = await pollForCycles({ ...base, cycles: 2, allowRestarts: true, runInvariant: async () => ({ count: 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, true);
  assert.deepEqual(r.perCycle.map((c) => [c.trigger, c.counted]), [['schedule', true], ['deploy', true]]);
});

await test('isCountedCycle: only schedule, unless allowRestarts', () => {
  assert.equal(isCountedCycle('schedule', false), true);
  for (const t of ['deploy', 'unknown', null, undefined, '', 'Schedule']) assert.equal(isCountedCycle(t, false), false, String(t));
  for (const t of ['deploy', 'unknown', null]) assert.equal(isCountedCycle(t, true), true, String(t));
});

await test('regression on scheduled cycle 2 -> FAIL loudly with per-cycle counts', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['schedule'], ['schedule']]);
  let n = 0;
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => ({ count: ++n >= 2 ? 3 : 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, false);
  assert.equal(r.unverifiable, false);
  assert.deepEqual(r.perCycle.map((c) => c.count), [0, 3]);
  assert.match(r.reason, /REGRESSION after schedule cycle c2/);
});

await test('a regression after an UNCOUNTED deploy cycle still fails (the repair did not hold)', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['deploy']]);
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => ({ count: 1 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, false);
  assert.equal(r.unverifiable, false);
  assert.match(r.reason, /REGRESSION after deploy cycle c1 \(not counted\)/);
});

await test('no cycle ever completes -> UNVERIFIABLE, never a silent pass', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([]);
  const r = await pollForCycles({ ...base, timeoutMs: 5 * 60 * 1000, cycles: 2, runInvariant: async () => ({ count: 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.unverifiable, true);
  assert.equal(r.cyclesObserved, 0);
  assert.match(r.reason, /timeout/);
});

await test('the poll only asks for cycles AFTER the last one it saw (no double counting)', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['schedule'], [], ['schedule']]);
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => ({ count: 0 }), readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.held, true);
  assert.deepEqual(s.calls, ['2026-09-26 06:00:00', '2026-09-26 06:01:00', '2026-09-26 06:01:00']);
});

await test('invariant crash mid-poll -> UNVERIFIABLE', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const s = scriptedCycles([['schedule']]);
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => { throw new Error('DB connection reset'); }, readBaseline: s.readBaseline, readCyclesSince: s.readSince, sleepFn, nowFn });
  assert.equal(r.unverifiable, true);
  assert.match(r.reason, /invariant crashed mid-poll/);
});

await test('baseline read failure (e.g. trigger column not migrated) -> UNVERIFIABLE with the cause', async () => {
  const { nowFn, sleepFn } = fakeClock();
  const r = await pollForCycles({ ...base, cycles: 2, runInvariant: async () => ({ count: 0 }), readBaseline: async () => { throw new Error('column "trigger" does not exist'); }, readCyclesSince: async () => [], sleepFn, nowFn });
  assert.equal(r.unverifiable, true);
  assert.match(r.reason, /column "trigger" does not exist/);
});

await test('formatCycleLine names the trigger on every line, and says (not counted) for the rest', () => {
  const counted = formatCycleLine({ index: 1, cycleId: 'c1', trigger: 'schedule', counted: true, count: 0, at: '2026-09-26 07:30:05' }, 2);
  assert.match(counted, /^cycle 1\/2 schedule cycle_id=c1 at 2026-09-26 13:00:05 IST: count=0$/);
  const skipped = formatCycleLine({ index: null, cycleId: 'c2', trigger: 'deploy', counted: false, count: 0, at: '2026-09-26 07:45:00' }, 2);
  assert.match(skipped, /^deploy \(not counted\) cycle_id=c2 at 2026-09-26 13:15:00 IST: count=0$/);
  const unk = formatCycleLine({ index: null, cycleId: 'c3', trigger: 'unknown', counted: false, count: 0, at: '2026-09-26 07:50:00' }, 2);
  assert.match(unk, /^unknown \(not counted\) /);
});

// The SQL against a fake pool: heartbeat rows only (one per completed data
// cycle), timestamps kept as the DB's own text (bound back as text, so no JS
// Date conversion can shift them), NULL trigger surfaced as 'unknown'.
await test('readCyclesSince / readCycleBaseline: heartbeat-only SQL, text-bound marker, NULL -> unknown', async () => {
  const seen = [];
  const pool = {
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (sql === CYCLE_BASELINE_SQL) return { rows: [{ max_at: '2026-09-26 06:00:00.5' }] };
      return { rows: [
        { cycle_id: 'a', trigger: 'schedule', at: '2026-09-26 06:30:01' },
        { cycle_id: 'b', trigger: null, at: '2026-09-26 06:40:01' },
      ] };
    },
  };
  assert.equal(await readCycleBaseline(pool), '2026-09-26 06:00:00.5');
  const rows = await readCyclesSince(pool, '2026-09-26 06:00:00.5');
  assert.deepEqual(rows, [
    { cycleId: 'a', trigger: 'schedule', at: '2026-09-26 06:30:01' },
    { cycleId: 'b', trigger: 'unknown', at: '2026-09-26 06:40:01' },
  ]);
  assert.equal(seen[1].sql, CYCLES_SINCE_SQL);
  assert.deepEqual(seen[1].params, ['2026-09-26 06:00:00.5']);
  for (const sql of [CYCLE_BASELINE_SQL, CYCLES_SINCE_SQL]) {
    assert.match(sql, /FROM scraper_steps/);
    assert.match(sql, /step = 'heartbeat'/);
  }
  assert.match(CYCLES_SINCE_SQL, /created_at::text/);
  assert.match(CYCLES_SINCE_SQL, /\$1::text IS NULL OR created_at > \$1::timestamp/);
});

process.exit(FAILED);
