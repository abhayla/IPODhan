#!/usr/bin/env node
// scripts/assert-repair-held.mjs — G-G (#192, T-466): a repair is not done
// until it survives a real scraper cycle. "Merged, deployed, row now
// correct" has repeatedly turned out false within minutes (T-281 price-band
// collapse regressed 11 min after deploy; T-282's guard was correct but
// CONSOLIDATION_PERCENTAGE=0 meant it never ran; T-277C merged duplicates
// were re-minted next cycle). This is the mandatory last step of every
// data-repair fix task (defect-fix-contract.md item 5) — the "real-data
// proof" tool, not a prose promise.
//
// Usage:
//   node scripts/assert-repair-held.mjs <invariant> [--cycles N] [--timeout-min M] [--allow-restarts]
//
// <invariant> is either:
//   - a path to a .mjs module (relative or absolute) exporting a default
//     async function(pool) => { count, details? } | number — run IN-PROCESS
//     against this script's own pool (preferred: no subprocess DB creds
//     plumbing). scripts/lib/repair-invariants/issue-size-t451.mjs is the
//     shipped worked example.
//   - any other string: run as a SHELL COMMAND (via `sh -c`); its stdout's
//     LAST non-empty line must be a bare integer = the violation count.
//     Accepts literally anything with that contract — `psql -tAc "..."`,
//     `node scripts/audit-ipo-coverage.mjs --gate | tail -1`, etc.
//
// Cycle detection (#698): a "cycle" is one COMPLETED scheduled data cycle, not
// a fixed sleep and not any write at all. Each `--source=all` run writes a
// `heartbeat` row to scraper_steps as its last step, and every scraper_steps
// row records what launched the run (scraper_steps.trigger, from the wake
// wrapper's SCRAPER_WAKE_TRIGGER): `schedule` for a cron wake, `deploy` for the
// deploy's pm2 start, `unknown`/NULL otherwise. Only `schedule` cycles count
// toward --cycles; every other cycle is still checked (a regression after it
// fails the run) and printed as `<trigger> (not counted)`. Before #698 the
// marker was the newest write to ipos / scraper_logs, so a deploy restart
// landing between scheduled wakes counted as a cycle, and nothing in the DB
// could tell the two apart. `--allow-restarts` counts every completed cycle
// again, explicitly. The default timeout is 90 min because two scheduled data
// wakes are 30 min apart and each cycle has to finish before it counts.
//
// Exit codes:
//   0 — held clean across N cycles.
//   1 — a violation reappeared (regression) — the repair did NOT hold.
//   2 — UNVERIFIABLE: the invariant itself failed to run, OR fewer than N
//       scheduled cycles completed within the timeout (deploy restarts do not
//       fill the gap) — this proves nothing either way, it is not a silent pass.
// Item 1 slice s14 -- FIRST import on purpose. ESM evaluates imported modules in
// source order, so this runs (and prints which checkout @ipodhan/shared resolves
// to) before any module below can read the wrong tree.
import './lib/alias-preflight-auto.mjs';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import { createUtcPool, installUtcTimestampParsing } from './lib/pg-utc.mjs';
import { resolveDiscreteDbParams } from './lib/pg-connection-params.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { invariant: null, cycles: 2, timeoutMin: 90, pollSec: 60, allowRestarts: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cycles') args.cycles = parseInt(argv[++i], 10);
    else if (a === '--timeout-min') args.timeoutMin = parseFloat(argv[++i]);
    else if (a === '--allow-restarts') args.allowRestarts = true;
    else if (a === '--poll-sec') args.pollSec = parseFloat(argv[++i]);
    else rest.push(a);
  }
  args.invariant = rest[0] ?? null;
  return args;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function buildPool() {
  return createUtcPool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          ...resolveDiscreteDbParams(),
          ssl: false,
          max: 3,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 3 }
  );
}

// Resolves <invariant> to a runnable async function() => number|{count,details}.
// Exported for the unit test (fake invariants, fake pools — no real DB).
export async function resolveInvariant(invariantArg, pool, { cwd = process.cwd() } = {}) {
  const looksLikeModule = /\.mjs$/i.test(invariantArg) && !/\s/.test(invariantArg);
  if (looksLikeModule) {
    const abs = isAbsolute(invariantArg) ? invariantArg : resolve(cwd, invariantArg);
    if (existsSync(abs)) {
      const mod = await import(pathToFileURL(abs).href);
      if (typeof mod.default !== 'function') {
        throw new Error(`module ${abs} has no default export function(pool)`);
      }
      return async () => {
        const r = await mod.default(pool);
        return typeof r === 'number' ? { count: r } : r;
      };
    }
  }
  // Shell-command form — parse the LAST non-empty stdout line as an integer.
  return async () => {
    let out;
    try {
      out = execSync(invariantArg, { encoding: 'utf8', shell: true });
    } catch (err) {
      throw new Error(`invariant command exited non-zero: ${err.message}`);
    }
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last || !/^\d+$/.test(last)) {
      throw new Error(`invariant command's last stdout line was not a bare integer: ${JSON.stringify(last)}`);
    }
    return { count: parseInt(last, 10) };
  };
}

// #698: the cycle marker. A cycle is one COMPLETED data cycle: the `heartbeat`
// row that `--source=all` writes as its last scraper_steps row (scraper/src/
// index.ts, after every step that can write to an IPO). Each row carries the
// wake trigger (`schedule` | `deploy` | `unknown`, NULL before migration 0064).
// Timestamps stay as the database's own text (`created_at::text`) and are bound
// back as text, so no JS Date conversion can shift them (ist-timezone.md).
export const CYCLE_BASELINE_SQL =
  `SELECT MAX(created_at)::text AS max_at FROM scraper_steps WHERE step = 'heartbeat'`;
export const CYCLES_SINCE_SQL =
  `SELECT cycle_id::text AS cycle_id, trigger, created_at::text AS at FROM scraper_steps ` +
  `WHERE step = 'heartbeat' AND ($1::text IS NULL OR created_at > $1::timestamp) ` +
  `ORDER BY created_at, cycle_id`;

export async function readCycleBaseline(pool) {
  const { rows } = await pool.query(CYCLE_BASELINE_SQL);
  return rows[0]?.max_at ?? null;
}

export async function readCyclesSince(pool, since) {
  const { rows } = await pool.query(CYCLES_SINCE_SQL, [since]);
  return rows.map((r) => ({ cycleId: r.cycle_id, trigger: r.trigger ?? 'unknown', at: r.at }));
}

// Only a scheduled wake is the cycle a repair has to survive. A deploy restart
// or an unlabelled run is checked and printed but never counted, unless the
// operator passes --allow-restarts (the pre-#698 counting, stated explicitly).
export function isCountedCycle(trigger, allowRestarts) {
  return allowRestarts ? true : trigger === 'schedule';
}

function istText(utcText) {
  const ms = Date.parse(`${String(utcText).replace(' ', 'T')}Z`);
  if (Number.isNaN(ms)) return `${utcText} UTC`;
  return `${new Date(ms + 330 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')} IST`;
}

export function formatCycleLine(c, cycles) {
  const head = c.counted ? `cycle ${c.index}/${cycles} ${c.trigger}` : `${c.trigger} (not counted)`;
  return `${head} cycle_id=${c.cycleId} at ${istText(c.at)}: count=${c.count}`;
}

/**
 * Poll until `cycles` counted scraper cycles have completed, re-running the
 * invariant after every observed cycle (counted or not: a regression after a
 * deploy restart is still a regression). Returns
 * { held, unverifiable, cyclesObserved, perCycle, reason? } where perCycle has
 * one entry per observed cycle: { index, cycleId, trigger, counted, count, at }.
 * `sleepFn` and `nowFn` are injectable for the unit test (no real timers/DB).
 */
export async function pollForCycles({
  runInvariant,
  readBaseline,
  readCyclesSince,
  cycles,
  timeoutMs,
  pollMs,
  allowRestarts = false,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  nowFn = () => Date.now(),
  log = () => {},
}) {
  const startedAt = nowFn();
  let since;
  try {
    since = await readBaseline();
  } catch (err) {
    return { held: false, unverifiable: true, cyclesObserved: 0, perCycle: [], reason: `cycle marker read failed: ${err.message}` };
  }
  const perCycle = [];
  let counted = 0;

  while (counted < cycles) {
    if (nowFn() - startedAt > timeoutMs) {
      return {
        held: false,
        unverifiable: true,
        cyclesObserved: counted,
        perCycle,
        reason: `timeout after ${Math.round((nowFn() - startedAt) / 60000)}min: observed ${counted} scheduled cycle(s) and ${perCycle.length - counted} not counted, needed ${cycles}`,
      };
    }
    await sleepFn(pollMs);
    let fresh;
    try {
      fresh = await readCyclesSince(since);
    } catch (err) {
      log(`marker read error, will retry: ${err.message}`);
      continue;
    }
    for (const row of fresh) {
      const cycle = { ...row, trigger: row.trigger ?? 'unknown' };
      since = cycle.at;
      let result;
      try {
        result = await runInvariant();
      } catch (err) {
        return { held: false, unverifiable: true, cyclesObserved: counted, perCycle, reason: `invariant crashed mid-poll: ${err.message}` };
      }
      const isCounted = isCountedCycle(cycle.trigger, allowRestarts);
      if (isCounted) counted += 1;
      const entry = { index: isCounted ? counted : null, cycleId: cycle.cycleId, trigger: cycle.trigger, counted: isCounted, count: result.count, at: cycle.at };
      perCycle.push(entry);
      log(formatCycleLine(entry, cycles));
      if (result.count > 0) {
        const which = `${cycle.trigger} cycle ${cycle.cycleId}${isCounted ? '' : ' (not counted)'}`;
        return { held: false, unverifiable: false, cyclesObserved: counted, perCycle, reason: `REGRESSION after ${which}: violation count ${result.count} > 0` };
      }
      if (counted >= cycles) break;
    }
  }
  return { held: true, unverifiable: false, cyclesObserved: counted, perCycle };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.invariant) {
    console.error('FATAL: usage: node scripts/assert-repair-held.mjs <invariant> [--cycles N] [--timeout-min M] [--poll-sec S] [--allow-restarts]');
    process.exit(2);
  }

  loadEnvFile(join(__dirname, '..', 'web', '.env.local'));
  if (!process.env.DATABASE_HOST && !process.env.DATABASE_URL) {
    console.error('FATAL: no DB connection configured — provide web/.env.local or DATABASE_* in the environment');
    process.exit(2);
  }
  installUtcTimestampParsing();
  const pool = buildPool();

  try {
    const runInvariant = await resolveInvariant(args.invariant, pool);

    console.log(`assert-repair-held: recording violation count now (invariant: ${args.invariant})`);
    let now;
    try {
      now = await runInvariant();
    } catch (err) {
      console.error(`FATAL: invariant failed to run: ${err.message}`);
      process.exit(2);
    }
    console.log(`  current violation count: ${now.count}`);
    if (now.count > 0) {
      console.error(`ABORT: violation count is ${now.count}, not 0 — this is not a repair that has landed yet. Fix it first, then re-run this tool.`);
      process.exit(1);
    }

    const counting = args.allowRestarts ? 'every completed cycle (--allow-restarts)' : "only trigger='schedule' cycles";
    console.log(`assert-repair-held: polling for ${args.cycles} completed scraper cycle(s), counting ${counting}, timeout ${args.timeoutMin}min, poll every ${args.pollSec}s`);
    console.log(`  baseline SQL: ${CYCLE_BASELINE_SQL}`);
    console.log(`  cycle SQL:    ${CYCLES_SINCE_SQL}`);
    const result = await pollForCycles({
      runInvariant,
      readBaseline: () => readCycleBaseline(pool),
      readCyclesSince: (since) => readCyclesSince(pool, since),
      cycles: args.cycles,
      timeoutMs: args.timeoutMin * 60 * 1000,
      pollMs: args.pollSec * 1000,
      allowRestarts: args.allowRestarts,
      log: (msg) => console.log(`  ${msg}`),
    });

    console.log('assert-repair-held: per-cycle results:');
    for (const c of result.perCycle) {
      console.log(`  ${formatCycleLine(c, args.cycles)}`);
    }

    if (result.unverifiable) {
      console.error(`UNVERIFIABLE: ${result.reason}`);
      process.exit(2);
    }
    if (!result.held) {
      console.error(`FAIL: ${result.reason}`);
      process.exit(1);
    }
    console.log(`HELD: violation count stayed 0 across ${result.cyclesObserved} counted scraper cycle(s) (${result.perCycle.length - result.cyclesObserved} more observed, not counted).`);
    process.exit(0);
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(`FATAL: unhandled error: ${err.stack || err.message}`);
    process.exit(2);
  });
}
