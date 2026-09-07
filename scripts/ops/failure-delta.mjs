#!/usr/bin/env node
// Failure-delta tick script — T-496, docs/reviews/rca-2026-09-07-missed-live-defects.md,
// .claude/rules/signal-ownership.md (R1/R2/R3).
//
// Reads the last N lines of the prod or staging scraper pm2 log over ssh
// (read-only — never writes on the VPS), resolves every failure line to an
// identity (ipoId, docType, errorClass), keeps the previous set in a local
// state file, and prints NEW / GONE / SAME instead of a bare count.
//
// Round 2 (signal-ownership R2 — "no number = new = escalate this tick"):
// an entry WITHOUT an issue number is printed as UNTRACKED and blocks the
// tick (exit 3) on EVERY run it appears in, whether this is its first run
// (NEW) or a later one (SAME) — a bare "known" label with no number is
// itself the R2 violation this script exists to stop. Only an entry that
// carries an issue number (via --file-issues or --track) prints as
// TRACKED #NNN and exits 0.
//
// Usage:
//   node scripts/ops/failure-delta.mjs --slot prod
//   node scripts/ops/failure-delta.mjs --slot staging --file-issues
//   node scripts/ops/failure-delta.mjs --slot prod --lines 8000
//   node scripts/ops/failure-delta.mjs --slot staging --track b28d9d2a-cb24-4d84-8e1a-297ba828884a=402
//   node scripts/ops/failure-delta.mjs --slot staging --track persist-insert-failed=402
//   # ^ a class-level track (errorClass) persists to state.classIssues (T-502, #413) —
//   #   it covers every later key of that class automatically, no need to repeat --track;
//   #   a per-key (ipoId) --track always wins over a class track for that key.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogLines, extractFailures, ERROR_CLASSES } from './lib/failure-classifier.mjs';
import { parseTrackArg, resolveTrackedState, countUntracked, formatSshFailure } from './lib/failure-tick-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, 'state');

const SSH_HOST = process.env.FAILURE_DELTA_SSH_HOST || 'rfp-vps';
const LOG_FILE_BY_SLOT = {
  prod: '~/.pm2/logs/ipodhan-scraper-out.log',
  staging: '~/.pm2/logs/ipodhan-scraper-staging-out.log',
};
const DEFAULT_LINES = 5000;

function parseArgs(argv) {
  const args = { slot: null, fileIssues: false, lines: DEFAULT_LINES, track: [], fromFile: null, stateDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slot') args.slot = argv[++i];
    else if (a === '--file-issues') args.fileIssues = true;
    else if (a === '--lines') args.lines = Number(argv[++i]);
    else if (a === '--from-file') args.fromFile = argv[++i];
    else if (a === '--state-dir') args.stateDir = argv[++i];
    else if (a === '--track') {
      try {
        args.track.push(parseTrackArg(argv[++i] ?? '', ERROR_CLASSES));
      } catch (err) {
        console.error(`error: ${err.message}`);
        process.exit(2);
      }
    }
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usageAndExit(code) {
  console.log('Usage: node scripts/ops/failure-delta.mjs --slot prod|staging [--file-issues] [--lines N] [--track <ipoId>|<errorClass>=<#issue> ...] [--from-file <path>] [--state-dir <dir>]');
  process.exit(code);
}

function fetchLogTail(slot, lines) {
  const logFile = LOG_FILE_BY_SLOT[slot];
  // Read-only: tail over ssh. Never writes on the VPS (owner rule: VPS is production).
  // pm2-logrotate rotates at 00:00 IST, leaving the plain file empty right after midnight —
  // also tail today's dated rotation (-q suppresses per-file headers) so a tick run just
  // after rotation doesn't read 0 lines.
  const base = logFile.replace(/\.log$/, '');
  const cmd = `tail -q -n ${lines} ${logFile} ${base}__$(date +%Y-%m-%d)_00-00-00.log 2>/dev/null; true`;
  return execFileSync('ssh', [SSH_HOST, cmd], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * @param {string} slot
 * @param {number} lines
 * @returns {string} raw log text
 * Exits 2 with a plain reason (R6 — failures carry their cause), never a stack trace, on ssh failure.
 */
function fetchLogTailOrExit(slot, lines) {
  try {
    return fetchLogTail(slot, lines);
  } catch (err) {
    console.error(formatSshFailure(err));
    process.exit(2);
  }
}

function loadState(slot, stateDir = STATE_DIR) {
  const file = path.join(stateDir, `${slot}.json`);
  if (!existsSync(file)) return { failures: {}, classIssues: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    // Backward compatible: a state file written before T-502 has no classIssues.
    return { failures: parsed.failures ?? {}, classIssues: parsed.classIssues ?? {} };
  } catch {
    return { failures: {}, classIssues: {} };
  }
}

function saveState(slot, state, stateDir = STATE_DIR) {
  mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, `${slot}.json`);
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function keyOf(f) {
  return `${f.ipoId}::${f.docType ?? '-'}::${f.errorClass}`;
}

function diff(currentMap, previousFailures) {
  const currentKeys = new Set(currentMap.keys());
  const previousKeys = new Set(Object.keys(previousFailures));

  const NEW = [...currentKeys].filter((k) => !previousKeys.has(k));
  const GONE = [...previousKeys].filter((k) => !currentKeys.has(k));
  const SAME = [...currentKeys].filter((k) => previousKeys.has(k));
  return { NEW, GONE, SAME };
}

function ensureLabel() {
  try {
    const out = execFileSync('gh', ['label', 'list', '--search', 'nightly-audit', '--json', 'name'], { encoding: 'utf8' });
    const labels = JSON.parse(out);
    if (labels.some((l) => l.name === 'nightly-audit')) return;
  } catch {
    // fall through to create
  }
  try {
    execFileSync('gh', ['label', 'create', 'nightly-audit', '--color', 'B60205', '--description', 'Filed by failure-delta.mjs / floor-delta.mjs (signal-ownership)'], {
      encoding: 'utf8',
    });
  } catch {
    // label likely already exists (race) — non-fatal
  }
}

function fileIssueForClass(errorClass, entries, slot) {
  const first = entries[0];
  const title = `${errorClass}: ${first.company} (${slot})`;
  const bodyLines = entries.map(
    (f) => `- ${f.company} | ipoId=${f.ipoId} | docType=${f.docType ?? '-'} | firstSeen=${f.firstSeen ?? '-'}`
  );
  const body = [
    `Detected by \`scripts/ops/failure-delta.mjs --slot ${slot} --file-issues\` (T-496).`,
    '',
    `errorClass: ${errorClass}`,
    '',
    ...bodyLines,
  ].join('\n');

  const out = execFileSync(
    'gh',
    ['issue', 'create', '--title', title, '--body', body, '--label', 'nightly-audit'],
    { encoding: 'utf8' }
  );
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

  const raw = args.fromFile ? readFileSync(args.fromFile, 'utf8') : fetchLogTailOrExit(args.slot, args.lines);
  const parsed = parseLogLines(raw);
  const currentMap = extractFailures(parsed);

  const state = loadState(args.slot, args.stateDir ?? STATE_DIR);
  const { NEW, GONE, SAME } = diff(currentMap, state.failures);

  // A class-level --track this run persists into state.classIssues (in addition to
  // stamping this run's matching entries below), so a later run — including one that
  // sees a key of this errorClass for the first time — resolves it without repeating
  // --track (T-502, #413).
  const classIssues = { ...state.classIssues };
  for (const rule of args.track) {
    if (rule.matchType === 'errorClass') classIssues[rule.value] = rule.issueNumber;
  }

  // Carry forward tracked status (issueNumber) AND firstSeen from the previous run, apply
  // the persisted class-level track, then apply this run's --track overrides (a per-key
  // --track always wins over a class track since it targets only that ipoId).
  resolveTrackedState(currentMap, state.failures, args.track, classIssues);

  console.log(`failure-delta --slot ${args.slot} (last ${args.lines} log lines, ${parsed.length} parsed)`);
  console.log(`NEW=${NEW.length} GONE=${GONE.length} SAME=${SAME.length}`);
  console.log('');

  // --file-issues covers every UNTRACKED entry this run, not just NEW ones — R2 says an
  // entry with no issue number escalates on EVERY run, so a SAME-but-untracked class (one
  // that was NEW on a prior run and never got a number, e.g. --file-issues wasn't passed
  // that time) must still be filable now.
  const untrackedByClass = new Map();
  for (const f of currentMap.values()) {
    if (!f.issueNumber) {
      if (!untrackedByClass.has(f.errorClass)) untrackedByClass.set(f.errorClass, []);
      untrackedByClass.get(f.errorClass).push(f);
    }
  }

  let filedCount = 0;
  if (args.fileIssues && untrackedByClass.size > 0) {
    ensureLabel();
    for (const [errorClass, entries] of untrackedByClass) {
      const issueNumber = fileIssueForClass(errorClass, entries, args.slot);
      for (const f of entries) {
        currentMap.get(keyOf(f)).issueNumber = issueNumber;
      }
      filedCount++;
      console.log(`filed issue #${issueNumber} for ${errorClass} (${entries.length} identities)`);
    }
  }

  // Print AFTER --track / --file-issues so the label reflects this run's final status.
  // R2: "no number = new = escalate this tick" — an entry with no issue number is UNTRACKED
  // on every run it appears in (NEW or SAME), never printed as "known".
  for (const key of NEW) {
    const f = currentMap.get(key);
    const status = f.issueNumber ? `TRACKED #${f.issueNumber}` : 'UNTRACKED';
    console.log(`NEW   ${f.company} | ${f.docType ?? '-'} | ${f.errorClass} | ipoId=${f.ipoId} | ${status}`);
  }
  for (const key of GONE) {
    const f = state.failures[key];
    console.log(`GONE  ${f.company} | ${f.docType ?? '-'} | ${f.errorClass} | ipoId=${f.ipoId}`);
  }
  for (const key of SAME) {
    const f = currentMap.get(key);
    const status = f.issueNumber ? `TRACKED #${f.issueNumber}` : 'UNTRACKED';
    console.log(`SAME  ${f.company} | ${f.docType ?? '-'} | ${f.errorClass} | ipoId=${f.ipoId} | ${status}`);
  }

  const nextFailures = {};
  for (const [key, f] of currentMap) {
    nextFailures[key] = {
      ipoId: f.ipoId,
      docType: f.docType,
      errorClass: f.errorClass,
      hardFailure: f.hardFailure,
      company: f.company,
      firstSeen: f.firstSeen,
      issueNumber: f.issueNumber ?? null,
    };
  }
  saveState(args.slot, { failures: nextFailures, classIssues, updatedAt: new Date().toISOString() }, args.stateDir ?? STATE_DIR);

  const untrackedCount = countUntracked(currentMap);
  if (untrackedCount > 0) {
    console.log('');
    console.log(`exit 3: ${untrackedCount} UNTRACKED failure(s) with no issue number (R2: no number = new = escalate this tick). Use --file-issues or --track <ipoId>|<errorClass>=<#issue>.`);
    process.exit(3);
  }
}

main();
