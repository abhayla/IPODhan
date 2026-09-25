#!/usr/bin/env node
// Wake-delta tick script — #793 M2, .claude/rules/signal-ownership.md R1/R3.
//
// `scripts/scraper-wake.sh` writes one line per wake into
// /var/log/ipodhan-scraper-wake-<slot>.log. When a cycle dies on its own it
// writes `wake-failed: ... exit=N`; when the 2-hour ceiling fires it writes
// `ceiling-tripped: ... exit=124`. NOTHING HAS EVER READ THAT FILE. On
// 2026-09-19 eighteen `wake-failed` lines sat in the staging copy while the
// scraper was dead for six hours, and the outage was found only because a human
// happened to look (#793).
//
// Modelled on scripts/ops/failure-delta.mjs deliberately — same read-only ssh,
// same state-file convention under scripts/ops/state/, same NEW/GONE/SAME
// diffing, same exit codes — so there is one tick shape to learn, not two.
//
// signal-ownership R1: a bare count is never printed. Every failure resolves to
// an identity (timestamp, slot, job, exit code) before it is reported.
//
// Exit codes (same meaning as failure-delta.mjs):
//   0  nothing failing, or every failing class carries an issue number
//   2  bad arguments, or the ssh read failed (cause printed, never a stack)
//   3  at least one UNTRACKED failure class — no number = new = escalate
//
// Usage:
//   node scripts/ops/wake-delta.mjs --slot staging
//   node scripts/ops/wake-delta.mjs --slot prod --file-issues
//   node scripts/ops/wake-delta.mjs --slot staging --lines 4000
//   node scripts/ops/wake-delta.mjs --slot staging --track wake-failed:1=793
//   node scripts/ops/wake-delta.mjs --slot staging --from-file <path> --state-dir <dir>

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, 'state');

// Same env convention as failure-delta.mjs, with the same default host.
const SSH_HOST = process.env.FAILURE_DELTA_SSH_HOST || 'rfp-vps';

const LOG_FILE_BY_SLOT = {
  prod: '/var/log/ipodhan-scraper-wake-prod.log',
  staging: '/var/log/ipodhan-scraper-wake-staging.log',
};
const DEFAULT_LINES = 2000;

/**
 * The two ways scraper-wake.sh reports a cycle that did not finish cleanly.
 * `wake-skipped` is NOT here: a skip is the lock working as designed, not a
 * failure, and treating it as one would make this tick cry wolf every time two
 * cycles overlap.
 */
const FAILURE_KINDS = ['wake-failed', 'ceiling-tripped'];

/**
 * scraper-wake.sh's log() prints:
 *   2026-09-19T02:33:51Z scraper-wake: wake-failed: ... elapsed=5s exit=1
 * Parse the timestamp, the kind, and the exit code. A line whose shape does not
 * match is not silently dropped — see parseWakeLog's `unparsed` return.
 */
export const LINE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+scraper-wake:\s+([a-z-]+):\s*(.*)$/;

/**
 * #663: the newest timestamp among ALL wake lines (wake-starting,
 * wake-skipped, wake-complete, wake-failed, ceiling-tripped — every kind, not
 * only failures), for `audit-detection-floor.mjs`'s freshness check. Every
 * wake, successful or not, writes at least one line via `scraper-wake.sh`'s
 * `log()`, so the newest line's age IS "when did a wake last actually
 * happen" — `parseWakeLog`'s `failures` array only carries the two failure
 * kinds and would read a healthy, silent wake as "nothing here", the exact
 * silence #663 is about. Reuses LINE_RE rather than a second regex
 * (duplicated-check-implementations.md).
 */
export function newestWakeTimestamp(raw) {
  let newest = null;
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const ts = m[1];
    if (newest === null || ts > newest) newest = ts;
  }
  return newest;
}

export function parseWakeLog(raw) {
  const failures = [];
  let totalLines = 0;
  let wakeLines = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    totalLines++;
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    wakeLines++;
    const [, timestamp, kind, rest] = m;
    if (!FAILURE_KINDS.includes(kind)) continue;
    const exitMatch = /\bexit=(\d+)\b/.exec(rest);
    const jobMatch = /\bjob=([A-Za-z0-9_-]+)/.exec(rest);
    const elapsedMatch = /\belapsed=(\d+)s\b/.exec(rest);
    failures.push({
      timestamp,
      kind,
      exitCode: exitMatch ? Number(exitMatch[1]) : null,
      job: jobMatch ? jobMatch[1] : null,
      elapsedSeconds: elapsedMatch ? Number(elapsedMatch[1]) : null,
    });
  }
  return { failures, totalLines, wakeLines };
}

/**
 * The diff KEY is deliberately the class (kind + exit code), not the timestamp.
 * Keying on the timestamp would make every single wake a NEW identity forever,
 * so NEW would never mean anything and GONE would never fire — the signal would
 * be noise. Keyed by class, "GONE" means the real thing an operator cares about:
 * this kind of failure stopped happening.
 */
export function keyOf(f) {
  return `${f.kind}::exit=${f.exitCode ?? '-'}`;
}

/**
 * Collapse the parsed lines into one entry per class, carrying the identities
 * (R1): how many, when first, when last, which jobs, and a sample line's stamp.
 */
export function groupByClass(failures) {
  const map = new Map();
  for (const f of failures) {
    const key = keyOf(f);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        kind: f.kind,
        exitCode: f.exitCode,
        occurrences: 1,
        firstSeen: f.timestamp,
        lastSeen: f.timestamp,
        jobs: f.job ? [f.job] : [],
        issueNumber: null,
      });
      continue;
    }
    existing.occurrences++;
    if (f.timestamp < existing.firstSeen) existing.firstSeen = f.timestamp;
    if (f.timestamp > existing.lastSeen) existing.lastSeen = f.timestamp;
    if (f.job && !existing.jobs.includes(f.job)) existing.jobs.push(f.job);
  }
  return map;
}

export function diff(currentMap, previousFailures) {
  const currentKeys = new Set(currentMap.keys());
  const previousKeys = new Set(Object.keys(previousFailures ?? {}));
  return {
    NEW: [...currentKeys].filter((k) => !previousKeys.has(k)),
    GONE: [...previousKeys].filter((k) => !currentKeys.has(k)),
    SAME: [...currentKeys].filter((k) => previousKeys.has(k)),
  };
}

function parseArgs(argv) {
  const args = { slot: null, fileIssues: false, lines: DEFAULT_LINES, track: [], fromFile: null, stateDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slot') args.slot = argv[++i];
    else if (a === '--file-issues') args.fileIssues = true;
    else if (a === '--lines') args.lines = Number(argv[++i]);
    else if (a === '--from-file') args.fromFile = argv[++i];
    else if (a === '--state-dir') args.stateDir = argv[++i];
    else if (a === '--track') {
      const raw = argv[++i] ?? '';
      const m = /^(.+)=(\d+)$/.exec(raw);
      if (!m) {
        console.error(`error: --track expects <key>=<issue number>, got "${raw}"`);
        process.exit(2);
      }
      args.track.push({ key: m[1], issueNumber: Number(m[2]) });
    } else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usageAndExit(code) {
  console.log('Usage: node scripts/ops/wake-delta.mjs --slot prod|staging [--file-issues] [--lines N] [--track <kind::exit=N>=<#issue> ...] [--from-file <path>] [--state-dir <dir>]');
  process.exit(code);
}

function fetchLogTail(slot, lines) {
  const logFile = LOG_FILE_BY_SLOT[slot];
  // Read-only: tail over ssh, never a write on the VPS (owner rule: the VPS is
  // production). `2>/dev/null; true` so a missing file reads as empty rather
  // than as an ssh failure — an absent log is "no failures", not "tick broken".
  const cmd = `tail -n ${lines} ${logFile} 2>/dev/null; true`;
  return execFileSync('ssh', [SSH_HOST, cmd], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function fetchLogTailOrExit(slot, lines) {
  try {
    return fetchLogTail(slot, lines);
  } catch (err) {
    // signal-ownership R6: the failure carries its cause, in plain words.
    const cause = err?.stderr?.toString().trim() || err?.message || String(err);
    console.error(`exit 2: cannot read the wake log for slot "${slot}" over ssh (host=${SSH_HOST}): ${cause}`);
    process.exit(2);
  }
}

function loadState(slot, stateDir) {
  const file = path.join(stateDir, `wake-${slot}.json`);
  if (!existsSync(file)) return { failures: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { failures: parsed.failures ?? {} };
  } catch {
    return { failures: {} };
  }
}

function saveState(slot, state, stateDir) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, `wake-${slot}.json`), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function ensureLabel() {
  try {
    const out = execFileSync('gh', ['label', 'list', '--search', 'nightly-audit', '--json', 'name'], { encoding: 'utf8' });
    if (JSON.parse(out).some((l) => l.name === 'nightly-audit')) return;
  } catch {
    // fall through to create
  }
  try {
    execFileSync('gh', ['label', 'create', 'nightly-audit', '--color', 'B60205', '--description', 'Filed by failure-delta.mjs / floor-delta.mjs / wake-delta.mjs (signal-ownership)'], { encoding: 'utf8' });
  } catch {
    // label likely already exists (race) — non-fatal
  }
}

function fileIssueForClass(entry, slot) {
  const title = `scraper wake ${entry.kind} (exit=${entry.exitCode ?? '-'}) on ${slot}`;
  const body = [
    `Detected by \`node scripts/ops/wake-delta.mjs --slot ${slot} --file-issues\` (#793 M2).`,
    '',
    `- kind: ${entry.kind}`,
    `- exit code: ${entry.exitCode ?? '-'}`,
    `- occurrences in the log window: ${entry.occurrences}`,
    `- first seen: ${entry.firstSeen}`,
    `- last seen: ${entry.lastSeen}`,
    `- jobs: ${entry.jobs.length ? entry.jobs.join(', ') : '-'}`,
    '',
    `Log: \`${LOG_FILE_BY_SLOT[slot]}\` on the VPS.`,
  ].join('\n');

  const out = execFileSync('gh', ['issue', 'create', '--title', title, '--body', body, '--label', 'nightly-audit'], { encoding: 'utf8' });
  const match = out.trim().match(/\/issues\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usageAndExit(0);
  if (!args.slot || !LOG_FILE_BY_SLOT[args.slot]) {
    console.error(`error: --slot must be one of: ${Object.keys(LOG_FILE_BY_SLOT).join(', ')}`);
    usageAndExit(2);
  }
  const stateDir = args.stateDir ?? STATE_DIR;

  const raw = args.fromFile ? readFileSync(args.fromFile, 'utf8') : fetchLogTailOrExit(args.slot, args.lines);
  const { failures, totalLines, wakeLines } = parseWakeLog(raw);
  const currentMap = groupByClass(failures);

  const state = loadState(args.slot, stateDir);
  const { NEW, GONE, SAME } = diff(currentMap, state.failures);

  // Carry a previously-assigned issue number forward, then apply this run's
  // --track. An entry that has never been given a number stays UNTRACKED and
  // blocks the tick on EVERY run it appears in (R2) — a "known" with no number
  // is exactly the thing that let 18 wake-failed lines sit unread.
  for (const [key, entry] of currentMap) {
    const previous = state.failures[key];
    if (previous?.issueNumber) entry.issueNumber = previous.issueNumber;
    if (previous?.firstSeen && previous.firstSeen < entry.firstSeen) entry.firstSeen = previous.firstSeen;
  }
  for (const rule of args.track) {
    const entry = currentMap.get(rule.key);
    if (entry) entry.issueNumber = rule.issueNumber;
  }

  console.log(`wake-delta --slot ${args.slot} (last ${args.lines} log lines, ${totalLines} read, ${wakeLines} parsed as wake lines)`);
  console.log(`NEW=${NEW.length} GONE=${GONE.length} SAME=${SAME.length}`);
  console.log('');

  let filedCount = 0;
  if (args.fileIssues) {
    const untracked = [...currentMap.values()].filter((e) => !e.issueNumber);
    if (untracked.length > 0) ensureLabel();
    for (const entry of untracked) {
      entry.issueNumber = fileIssueForClass(entry, args.slot);
      filedCount++;
      console.log(`filed issue #${entry.issueNumber} for ${entry.kind} (exit=${entry.exitCode ?? '-'}, ${entry.occurrences} occurrence(s))`);
    }
    if (filedCount > 0) console.log('');
  }

  // R1: identities, never a bare count. Every line names when, how, how often.
  const describe = (e) =>
    `${e.kind} | exit=${e.exitCode ?? '-'} | x${e.occurrences} | first=${e.firstSeen} | last=${e.lastSeen} | jobs=${e.jobs.length ? e.jobs.join(',') : '-'}`;

  for (const key of NEW) {
    const e = currentMap.get(key);
    console.log(`NEW   ${describe(e)} | ${e.issueNumber ? `TRACKED #${e.issueNumber}` : 'UNTRACKED'}`);
  }
  for (const key of GONE) {
    const e = state.failures[key];
    console.log(`GONE  ${e.kind} | exit=${e.exitCode ?? '-'} | last seen ${e.lastSeen} — no longer in the log window`);
  }
  for (const key of SAME) {
    const e = currentMap.get(key);
    console.log(`SAME  ${describe(e)} | ${e.issueNumber ? `TRACKED #${e.issueNumber}` : 'UNTRACKED'}`);
  }
  if (currentMap.size === 0 && GONE.length === 0) {
    console.log(`no wake failures in the last ${args.lines} lines of ${LOG_FILE_BY_SLOT[args.slot]}`);
  }

  const nextFailures = {};
  for (const [key, e] of currentMap) {
    nextFailures[key] = {
      kind: e.kind,
      exitCode: e.exitCode,
      occurrences: e.occurrences,
      firstSeen: e.firstSeen,
      lastSeen: e.lastSeen,
      jobs: e.jobs,
      issueNumber: e.issueNumber ?? null,
    };
  }
  saveState(args.slot, { failures: nextFailures, updatedAt: new Date().toISOString() }, stateDir);

  const untrackedCount = [...currentMap.values()].filter((e) => !e.issueNumber).length;
  if (untrackedCount > 0) {
    console.log('');
    console.log(`exit 3: ${untrackedCount} UNTRACKED wake-failure class(es) with no issue number (R2: no number = new = escalate this tick). Use --file-issues or --track <kind::exit=N>=<#issue>.`);
    process.exit(3);
  }
}

// Importable for unit tests without running the CLI.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
