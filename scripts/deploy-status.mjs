#!/usr/bin/env node
// T-425 — deploy-failure STATUS row (registry class
// `merged-fix-never-deployed-while-bug-live`, see #265).
//
// T-324's "Alert owner on deploy failure" step in .github/workflows/deploy-linux.yml
// pages ONCE, on failure, and never again. A fix landing hours later leaves no
// record on disk that a deploy is still broken — the only trace is a Notifier
// message that scrolled off. This script gives that failure a STATUS row that
// STAYS OPEN on disk until a later deploy of the SAME slot succeeds.
//
// Written to the SAME state directory scripts/audit-detection-floor.mjs
// already uses for its own run-state (`/root/data-audit-ipodhan/state` on the
// box, falling back to the OS temp dir off-box) — this repo has no separate
// fleet-style "STATUS surface"; that directory is the nightly-audit-readable
// surface this repo actually has, so it is the one this mechanism reuses
// rather than inventing a second one.
//
// Usage (called from deploy-linux.yml):
//   node scripts/deploy-status.mjs set   --slot prod --sha <sha> --run-url <url> --reason "<text>"
//   node scripts/deploy-status.mjs clear --slot prod
//   node scripts/deploy-status.mjs list                      -> prints the JSON map
//
// Exit codes: 0 = wrote/read successfully. 2 = bad usage.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildDeployFailureStatusRow,
  setDeployFailureStatus,
  clearDeployStatus,
} from './lib/fix-served-checks.mjs';

export const STATE_DIR = process.env.DETECTION_FLOOR_STATE_DIR
  || (existsSync('/root/data-audit-ipodhan/state') ? '/root/data-audit-ipodhan/state' : tmpdir());
export const DEPLOY_STATUS_FILE = process.env.DEPLOY_STATUS_FILE || join(STATE_DIR, 'deploy-failure-status.json');

export function readStatusMap(path = DEPLOY_STATUS_FILE) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

export function writeStatusMap(map, path = DEPLOY_STATUS_FILE) {
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(map, null, 2));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key) out[key] = argv[i + 1];
  }
  return out;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'set') {
    if (!args.slot) { console.error('usage: deploy-status.mjs set --slot <slot> --sha <sha> --run-url <url> --reason "<text>"'); process.exit(2); }
    const row = buildDeployFailureStatusRow({ slot: args.slot, sha: args.sha || 'unknown', runUrl: args['run-url'] || '', gateReason: args.reason || '' });
    const next = setDeployFailureStatus(readStatusMap(), args.slot, row);
    writeStatusMap(next);
    console.log(`[STATUS-SET] ${args.slot}: ${JSON.stringify(row)}`);
    return;
  }
  if (cmd === 'clear') {
    if (!args.slot) { console.error('usage: deploy-status.mjs clear --slot <slot>'); process.exit(2); }
    const next = clearDeployStatus(readStatusMap(), args.slot);
    writeStatusMap(next);
    console.log(`[STATUS-CLEAR] ${args.slot} cleared (was ${next[args.slot] ? 'still present — bug' : 'removed'})`);
    return;
  }
  if (cmd === 'list') {
    console.log(JSON.stringify(readStatusMap(), null, 2));
    return;
  }
  console.error('usage: deploy-status.mjs <set|clear|list> ...');
  process.exit(2);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  // Fail-open (T-425 blocker): a write error here (unwritable state dir, full
  // disk, permission issue) must NEVER fail the calling workflow step - this
  // script is a best-effort side record, not the deploy gate. `main()`'s own
  // explicit usage checks still exit(2) directly (process.exit terminates
  // before this catch runs); only unexpected thrown errors land here.
  try {
    main();
  } catch (e) {
    console.error(`WARNING: deploy-status.mjs failed non-fatally: ${e.message}`);
    process.exit(0);
  }
}
