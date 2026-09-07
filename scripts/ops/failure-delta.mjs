#!/usr/bin/env node
// Failure-delta tick script — T-496, docs/reviews/rca-2026-09-07-missed-live-defects.md,
// .claude/rules/signal-ownership.md (R1/R2/R3).
//
// Reads the last N lines of the prod or staging scraper pm2 log over ssh
// (read-only — never writes on the VPS), resolves every failure line to an
// identity (ipoId, docType, errorClass), keeps the previous set in a local
// state file, and prints NEW / GONE / SAME instead of a bare count. A NEW
// failure blocks the tick (exit 3) unless --file-issues opens a GitHub
// issue for it and records the issue number, so the same class reads as
// SAME (known, with a number) on the next tick.
//
// Usage:
//   node scripts/ops/failure-delta.mjs --slot prod
//   node scripts/ops/failure-delta.mjs --slot staging --file-issues
//   node scripts/ops/failure-delta.mjs --slot prod --lines 8000

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogLines, extractFailures } from './lib/failure-classifier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, 'state');

const SSH_HOST = process.env.FAILURE_DELTA_SSH_HOST || 'rfp-vps';
const LOG_FILE_BY_SLOT = {
  prod: '~/.pm2/logs/ipodhan-scraper-out.log',
  staging: '~/.pm2/logs/ipodhan-scraper-staging-out.log',
};
const DEFAULT_LINES = 5000;

function parseArgs(argv) {
  const args = { slot: null, fileIssues: false, lines: DEFAULT_LINES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slot') args.slot = argv[++i];
    else if (a === '--file-issues') args.fileIssues = true;
    else if (a === '--lines') args.lines = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usageAndExit(code) {
  console.log('Usage: node scripts/ops/failure-delta.mjs --slot prod|staging [--file-issues] [--lines N]');
  process.exit(code);
}

function fetchLogTail(slot, lines) {
  const logFile = LOG_FILE_BY_SLOT[slot];
  // Read-only: tail over ssh. Never writes on the VPS (owner rule: VPS is production).
  const out = execFileSync('ssh', [SSH_HOST, `tail -n ${lines} ${logFile} 2>/dev/null`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out;
}

function loadState(slot) {
  const file = path.join(STATE_DIR, `${slot}.json`);
  if (!existsSync(file)) return { failures: {} };
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { failures: {} };
  }
}

function saveState(slot, state) {
  mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${slot}.json`);
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

  const raw = fetchLogTail(args.slot, args.lines);
  const parsed = parseLogLines(raw);
  const currentMap = extractFailures(parsed);

  const state = loadState(args.slot);
  const { NEW, GONE, SAME } = diff(currentMap, state.failures);

  console.log(`failure-delta --slot ${args.slot} (last ${args.lines} log lines, ${parsed.length} parsed)`);
  console.log(`NEW=${NEW.length} GONE=${GONE.length} SAME=${SAME.length}`);
  console.log('');

  const newByClass = new Map();
  for (const key of NEW) {
    const f = currentMap.get(key);
    console.log(`NEW   ${f.company} | ${f.docType ?? '-'} | ${f.errorClass} | ipoId=${f.ipoId}`);
    if (!newByClass.has(f.errorClass)) newByClass.set(f.errorClass, []);
    newByClass.get(f.errorClass).push(f);
  }
  for (const key of GONE) {
    const f = state.failures[key];
    console.log(`GONE  ${f.company} | ${f.docType ?? '-'} | ${f.errorClass} | ipoId=${f.ipoId}`);
  }
  for (const key of SAME) {
    const f = currentMap.get(key);
    const prev = state.failures[key];
    const known = prev.issueNumber ? `known (#${prev.issueNumber})` : 'known (no issue number — R2 violation)';
    console.log(`SAME  ${f.company} | ${f.docType ?? '-'} | ${f.errorClass} | ipoId=${f.ipoId} | ${known}`);
  }

  let filedCount = 0;
  if (args.fileIssues && newByClass.size > 0) {
    ensureLabel();
    for (const [errorClass, entries] of newByClass) {
      const issueNumber = fileIssueForClass(errorClass, entries, args.slot);
      for (const f of entries) {
        currentMap.get(keyOf(f)).issueNumber = issueNumber;
      }
      filedCount++;
      console.log(`filed issue #${issueNumber} for ${errorClass} (${entries.length} identities)`);
    }
  }

  const nextFailures = {};
  for (const [key, f] of currentMap) {
    const prevIssueNumber = state.failures[key]?.issueNumber ?? null;
    nextFailures[key] = {
      ipoId: f.ipoId,
      docType: f.docType,
      errorClass: f.errorClass,
      hardFailure: f.hardFailure,
      company: f.company,
      firstSeen: f.firstSeen,
      issueNumber: f.issueNumber ?? prevIssueNumber,
    };
  }
  saveState(args.slot, { failures: nextFailures, updatedAt: new Date().toISOString() });

  if (NEW.length > 0 && !args.fileIssues) {
    console.log('');
    console.log(`exit 3: ${NEW.length} NEW failure(s) with no issue number. Re-run with --file-issues, or file manually and re-run.`);
    process.exit(3);
  }
  if (NEW.length > 0 && args.fileIssues && filedCount === 0) {
    // Should not happen, but never silently pass NEW without a filed issue.
    process.exit(3);
  }
}

main();
