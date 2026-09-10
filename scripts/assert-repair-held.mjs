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
//   node scripts/assert-repair-held.mjs <invariant> [--cycles N] [--timeout-min M]
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
// Cycle detection: a "cycle" is scraper activity that could plausibly have
// re-touched the affected rows, not a fixed sleep. The marker is
// GREATEST(MAX(ipos.last_scraped_at), MAX(ipos.updated_at)) across the WHOLE
// table (not just the repaired rows — those may not be due every wake, so
// using only their own timestamps would under-count real cycles) combined
// with MAX(scraper_logs.created_at) when that table exists, per the #192
// spec ("record max(last_scraped_at) over live rows, plus the latest
// scraper_logs cycle id if that table exists"). Because a single wake can
// write several scraper_logs rows / row updates within seconds of each
// other, an advance is only counted as a NEW cycle once the marker has moved
// forward by at least CYCLE_GAP_MS (default 4 min) from the last counted
// value — production wakes are ~30 min apart (due-step-cycle.ts), so a 4 min
// floor safely collapses one wake's burst of writes into one cycle without
// requiring a hardcoded 30-min wait. **Assumption:** if this floor is ever
// wrong for a given deployment cadence, override with --cycle-gap-min.
//
// Exit codes:
//   0 — held clean across N cycles.
//   1 — a violation reappeared (regression) — the repair did NOT hold.
//   2 — UNVERIFIABLE: the invariant itself failed to run, OR the cycle
//       marker never advanced within the timeout (scraper never touched
//       live data in the window, so N cycles were never observed — this
//       proves nothing either way, it is not a silent pass).
// Item 1 slice s14 -- FIRST import on purpose. ESM evaluates imported modules in
// source order, so this runs (and prints which checkout @ipodhan/shared resolves
// to) before any module below can read the wrong tree.
import './lib/alias-preflight-auto.mjs';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import { createUtcPool, installUtcTimestampParsing } from './lib/pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { invariant: null, cycles: 2, timeoutMin: 40, cycleGapMin: 4, pollSec: 60 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cycles') args.cycles = parseInt(argv[++i], 10);
    else if (a === '--timeout-min') args.timeoutMin = parseFloat(argv[++i]);
    else if (a === '--cycle-gap-min') args.cycleGapMin = parseFloat(argv[++i]);
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
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
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

// Reads the cycle marker: { maxRowTs: Date|null, maxLogTs: Date|null, hasScraperLogs: boolean }.
// Exported for the unit test via a fake pool.
export async function readCycleMarker(pool) {
  const { rows } = await pool.query(
    `SELECT GREATEST(MAX(last_scraped_at), MAX(updated_at)) AS max_ts FROM ipos`
  );
  const maxRowTs = rows[0]?.max_ts ?? null;
  let maxLogTs = null;
  let hasScraperLogs = true;
  try {
    const { rows: logRows } = await pool.query(`SELECT MAX(created_at) AS max_ts FROM scraper_logs`);
    maxLogTs = logRows[0]?.max_ts ?? null;
  } catch {
    hasScraperLogs = false; // table absent — fall back to ipos-only marker
  }
  return { maxRowTs, maxLogTs, hasScraperLogs };
}

function markerValue(marker) {
  const t1 = marker.maxRowTs ? new Date(marker.maxRowTs).getTime() : 0;
  const t2 = marker.maxLogTs ? new Date(marker.maxLogTs).getTime() : 0;
  return Math.max(t1, t2);
}

/**
 * Poll until `cycles` distinct scraper cycles have completed (marker advanced
 * by >= cycleGapMin each time), re-running the invariant after each. Returns
 * { held: boolean, cyclesObserved: number, perCycle: Array<{cycle, count, at}>,
 *   unverifiable: boolean, reason?: string }.
 * `sleepFn` and `nowFn` are injectable for the unit test (no real timers/DB).
 */
export async function pollForCycles({
  runInvariant,
  readMarker,
  cycles,
  timeoutMs,
  cycleGapMs,
  pollMs,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  nowFn = () => Date.now(),
  log = () => {},
}) {
  const startedAt = nowFn();
  let baseline;
  try {
    baseline = await readMarker();
  } catch (err) {
    return { held: false, unverifiable: true, cyclesObserved: 0, perCycle: [], reason: `cycle marker read failed: ${err.message}` };
  }
  let lastCountedValue = markerValue(baseline);
  const perCycle = [];

  while (perCycle.length < cycles) {
    if (nowFn() - startedAt > timeoutMs) {
      return {
        held: false,
        unverifiable: true,
        cyclesObserved: perCycle.length,
        perCycle,
        reason: `timeout after ${Math.round((nowFn() - startedAt) / 60000)}min — cycle marker never advanced enough for ${cycles} distinct cycles (observed ${perCycle.length})`,
      };
    }
    await sleepFn(pollMs);
    let marker;
    try {
      marker = await readMarker();
    } catch (err) {
      log(`marker read error, will retry: ${err.message}`);
      continue;
    }
    const value = markerValue(marker);
    if (value - lastCountedValue >= cycleGapMs) {
      lastCountedValue = value;
      let result;
      try {
        result = await runInvariant();
      } catch (err) {
        return { held: false, unverifiable: true, cyclesObserved: perCycle.length, perCycle, reason: `invariant crashed mid-poll: ${err.message}` };
      }
      const cycleNum = perCycle.length + 1;
      perCycle.push({ cycle: cycleNum, count: result.count, at: new Date(nowFn()).toISOString() });
      log(`cycle ${cycleNum}/${cycles} observed (marker=${new Date(value).toISOString()}): violation count = ${result.count}`);
      if (result.count > 0) {
        return { held: false, unverifiable: false, cyclesObserved: cycleNum, perCycle, reason: `REGRESSION on cycle ${cycleNum}: violation count ${result.count} > 0` };
      }
    }
  }
  return { held: true, unverifiable: false, cyclesObserved: perCycle.length, perCycle };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.invariant) {
    console.error('FATAL: usage: node scripts/assert-repair-held.mjs <invariant> [--cycles N] [--timeout-min M] [--cycle-gap-min G] [--poll-sec S]');
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

    console.log(`assert-repair-held: polling for ${args.cycles} distinct scraper cycle(s), timeout ${args.timeoutMin}min, poll every ${args.pollSec}s...`);
    const result = await pollForCycles({
      runInvariant,
      readMarker: () => readCycleMarker(pool),
      cycles: args.cycles,
      timeoutMs: args.timeoutMin * 60 * 1000,
      cycleGapMs: args.cycleGapMin * 60 * 1000,
      pollMs: args.pollSec * 1000,
      log: (msg) => console.log(`  ${msg}`),
    });

    console.log('assert-repair-held: per-cycle results:');
    for (const c of result.perCycle) {
      console.log(`  cycle ${c.cycle}: count=${c.count} at ${c.at}`);
    }

    if (result.unverifiable) {
      console.error(`UNVERIFIABLE: ${result.reason}`);
      process.exit(2);
    }
    if (!result.held) {
      console.error(`FAIL: ${result.reason}`);
      process.exit(1);
    }
    console.log(`HELD: violation count stayed 0 across ${result.cyclesObserved} distinct scraper cycle(s).`);
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
