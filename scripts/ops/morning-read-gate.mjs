#!/usr/bin/env node
// scripts/ops/morning-read-gate.mjs — T-499, .claude/rules/signal-ownership.md
//
// SessionStart consumer for the two nightly/ops signals this repo already
// produces but nobody was reading first thing: floor-delta (T-497) and
// merged-not-deployed (T-498). RCA: docs/reviews/rca-2026-09-07-missed-live-defects.md
// — signals existed, nobody consumed them. This script IS the consumer,
// wired into a SessionStart hook (.claude/hooks/morning-read-gate.sh) so it
// runs at the start of every session, not only when someone remembers.
//
// Floor data: reads the last two nights' [FAIL]/[PASS] output from the VPS
// over `ssh rfp-vps` (read-only `cat` of a file the nightly cron already
// wrote — not an ad-hoc run, per .claude/rules — production-vps-not-a-test-bench
// intent). Caches a local copy under scripts/ops/state/floor/<date>.txt
// (gitignored laptop state) and falls back to the cached copies when the VPS
// is unreachable. When fewer than two nights of data exist anywhere, prints
// "floor delta: unavailable (<reason>)" and continues — this hook NEVER
// blocks a session on VPS reachability (fail-open, signal-ownership.md R3's
// consumer must actually run, not become another thing that silently dies).
//
// After a successful delta it merges any NEW failing check id into
// scripts/ops/state/floor-issues.json (creating it if absent, preserving any
// `issue` number already recorded for an id) — this is the state file the
// PreToolUse wave-dispatch gate (wave-dispatch-gate.mjs) reads to refuse a
// build/wave dispatch while a NEW finding has no tracking issue.
//
// Also prints `node scripts/ops/merged-not-deployed.mjs --brief` (T-498) so
// a stale "fixed on main, not on prod" gap is visible on every session open.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFloorOutput, diffFloor, formatReport } from './floor-delta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, 'scripts', 'ops', 'state', 'floor');
const ISSUES_FILE = path.join(REPO_ROOT, 'scripts', 'ops', 'state', 'floor-issues.json');
const MERGED_NOT_DEPLOYED_SCRIPT = path.join(REPO_ROOT, 'scripts', 'ops', 'merged-not-deployed.mjs');
const REMOTE_DIR = '/root/data-audit-ipodhan/state/floor';
const SSH_HOST = process.env.MORNING_READ_SSH_HOST || 'rfp-vps';
const SSH_TIMEOUT_SEC = 6;

/** Pure. dateStrings like "2026-09-07" (from "<date>.txt" filenames) sort
 * lexicographically; returns the latest two as [olderDate, newerDate]. */
export function pickLatestTwo(dateStrings) {
  const sorted = [...new Set(dateStrings)].sort();
  return sorted.slice(-2);
}

/**
 * Resolve which two nights' floor text to diff, trying `runner.listRemote()`
 * first and falling back to `runner.listLocal()` on any remote error or
 * insufficient remote data. Pure with respect to its `runner` — no direct
 * ssh/fs calls here, so this is unit-testable with a fake runner.
 *
 * runner: {
 *   listRemote(): string[] dates,
 *   catRemote(date): string,
 *   listLocal(): string[] dates,
 *   readLocal(date): string,
 *   writeLocal(date, text): void,
 * }
 */
export function computeFloorFiles(runner) {
  try {
    const remoteDates = runner.listRemote();
    if (remoteDates.length >= 2) {
      const [yDate, tDate] = pickLatestTwo(remoteDates);
      const todayText = runner.catRemote(tDate);
      const yesterdayText = runner.catRemote(yDate);
      runner.writeLocal(tDate, todayText);
      runner.writeLocal(yDate, yesterdayText);
      return { source: 'vps', todayDate: tDate, yesterdayDate: yDate, todayText, yesterdayText };
    }
  } catch {
    // fall through to local cache — fail open on any ssh/network error
  }

  try {
    const localDates = runner.listLocal();
    if (localDates.length >= 2) {
      const [yDate, tDate] = pickLatestTwo(localDates);
      return {
        source: 'cache',
        todayDate: tDate,
        yesterdayDate: yDate,
        todayText: runner.readLocal(tDate),
        yesterdayText: runner.readLocal(yDate),
      };
    }
    return {
      source: 'unavailable',
      reason: `fewer than 2 nights of floor data reachable (VPS unreachable/short, ${localDates.length} cached locally)`,
    };
  } catch (err) {
    return { source: 'unavailable', reason: `local cache read failed: ${err.message}` };
  }
}

/** Merge NEW failing check ids into the floor-issues.json state file,
 * preserving any `issue` already recorded for an id. Pure w.r.t. the file
 * path passed in, so tests point it at a temp file. */
export function mergeFloorIssues(issuesFilePath, newIds, todayDate) {
  let data = { updated: todayDate, entries: [] };
  if (existsSync(issuesFilePath)) {
    try {
      const parsed = JSON.parse(readFileSync(issuesFilePath, 'utf-8'));
      if (parsed && Array.isArray(parsed.entries)) data = parsed;
    } catch {
      // corrupt state file — start fresh rather than fail the hook
    }
  }
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  for (const id of newIds) {
    if (!byId.has(id)) byId.set(id, { id, issue: null, firstSeen: todayDate });
  }
  data.entries = [...byId.values()];
  data.updated = todayDate;
  mkdirSync(path.dirname(issuesFilePath), { recursive: true });
  writeFileSync(issuesFilePath, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function realRunner() {
  const sshBase = ['-o', `ConnectTimeout=${SSH_TIMEOUT_SEC}`, '-o', 'BatchMode=yes', SSH_HOST];
  const sshTimeoutMs = (SSH_TIMEOUT_SEC + 3) * 1000;
  return {
    listRemote() {
      const out = execFileSync('ssh', [...sshBase, `ls -1 ${REMOTE_DIR} 2>/dev/null`], {
        encoding: 'utf-8',
        timeout: sshTimeoutMs,
      });
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('.txt'))
        .map((f) => f.replace(/\.txt$/, ''));
    },
    catRemote(date) {
      return execFileSync('ssh', [...sshBase, `cat ${REMOTE_DIR}/${date}.txt`], {
        encoding: 'utf-8',
        timeout: sshTimeoutMs,
      });
    },
    listLocal() {
      if (!existsSync(CACHE_DIR)) return [];
      return readdirSync(CACHE_DIR)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => f.replace(/\.txt$/, ''));
    },
    readLocal(date) {
      return readFileSync(path.join(CACHE_DIR, `${date}.txt`), 'utf-8');
    },
    writeLocal(date, text) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(path.join(CACHE_DIR, `${date}.txt`), text);
    },
  };
}

function printMergedNotDeployedBrief() {
  try {
    const brief = execFileSync('node', [MERGED_NOT_DEPLOYED_SCRIPT, '--brief'], {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: REPO_ROOT,
    });
    console.log(brief.trim());
  } catch (err) {
    console.log(`merged-not-deployed: unavailable (${err.message})`);
  }
}

export function main() {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const result = computeFloorFiles(realRunner());
    if (result.source === 'unavailable') {
      console.log(`floor delta: unavailable (${result.reason})`);
    } else {
      const today = parseFloorOutput(result.todayText);
      const yesterday = parseFloorOutput(result.yesterdayText);
      const delta = diffFloor(today, yesterday);
      console.log(formatReport(delta, { todayPath: result.todayDate, yesterdayPath: result.yesterdayDate }));
      console.log(`(source: ${result.source})`);
      mergeFloorIssues(ISSUES_FILE, delta.newIds, result.todayDate);
    }
  } catch (err) {
    console.log(`floor delta: unavailable (unexpected error: ${err.message})`);
  }

  printMergedNotDeployedBrief();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
