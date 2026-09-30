#!/usr/bin/env node
// Measure the live state of every "Road to Production" row that names a PR or
// an issue, and write it back into docs/design/board/road-to-production.json
// with the moment it was read.
//
// WHY THIS EXISTS
//   The separate tracker artifact was typed by hand and drifted. A row that
//   names a PR or an issue has a status that GitHub owns; this script is the
//   only writer of that status (owner-status-artifact.md R2: derived, or
//   labelled unknown). Rows with no pr/issue keep their typed status.
//
// MAPPING (read-only `gh` calls; nothing is invented)
//   pr    MERGED                          -> done
//         CLOSED without merge            -> failed
//         OPEN + mergeable CONFLICTING    -> failed   (GitHub runs no CI on a dirty PR)
//         OPEN + any failing check        -> failed
//         OPEN + draft                    -> the row's declared_status (a draft is not running)
//         OPEN otherwise                  -> running
//   issue CLOSED                          -> done
//         OPEN                            -> the row's declared_status (unmeasured if none)
//   gh failed / unparseable               -> unmeasured, with the cause in measured_error
//   A row with both pr and issue is read from the pr.
//   declared_status is the typed baseline, set once from the first status seen.
//
// USAGE
//   node scripts/ops/collect-road-status.mjs             # write the JSON
//   node scripts/ops/collect-road-status.mjs --stdout    # print, write nothing
//   Then: node scripts/ops/render-board.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROAD_PATH = join(__dirname, '..', '..', 'docs/design/board/road-to-production.json');

const FAILING = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);

/** Pure: gh `pr view --json` output + the row's declared status -> { status, from }. */
export function statusFromPr(pr, declared) {
  const n = pr.number ?? '';
  if (pr.state === 'MERGED') return { status: 'done', from: `PR #${n} merged` };
  if (pr.state === 'CLOSED') return { status: 'failed', from: `PR #${n} closed without merge` };
  if (pr.state !== 'OPEN') return { status: 'unmeasured', error: `PR state "${pr.state}" not understood` };
  if (pr.mergeable === 'CONFLICTING') return { status: 'failed', from: `PR #${n} open, CONFLICTING (needs a rebase)` };
  const failing = (pr.statusCheckRollup || []).filter((c) => FAILING.has(c.conclusion) || FAILING.has(c.state));
  if (failing.length) return { status: 'failed', from: `PR #${n} open, ${failing.length} check(s) failing` };
  if (pr.isDraft) return declared ? { status: declared, from: `PR #${n} open, draft` } : { status: 'unmeasured', error: `PR #${n} is a draft and the row has no declared status` };
  return { status: 'running', from: `PR #${n} open, checks not failing` };
}

/** Pure: gh `issue view --json` output + the row's declared status -> { status, from }. */
export function statusFromIssue(issue, declared) {
  const n = issue.number ?? '';
  if (issue.state === 'CLOSED') return { status: 'done', from: `issue #${n} closed` };
  if (issue.state === 'OPEN') return declared ? { status: declared, from: `issue #${n} open` } : { status: 'unmeasured', error: `issue #${n} is open and the row has no declared status` };
  return { status: 'unmeasured', error: `issue state "${issue.state}" not understood` };
}

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }));

/** Apply one measurement to a row in place. `read` is injectable for tests. */
export function measureItem(item, nowIso, read = gh) {
  if (item.pr === undefined && item.issue === undefined) return item;
  if (item.declared_status === undefined && item.status !== undefined && item.status !== 'unmeasured') item.declared_status = item.status;
  let r;
  try {
    r = item.pr !== undefined
      ? statusFromPr({ number: item.pr, ...read(['pr', 'view', String(item.pr), '--json', 'state,isDraft,mergeable,statusCheckRollup']) }, item.declared_status)
      : statusFromIssue({ number: item.issue, ...read(['issue', 'view', String(item.issue), '--json', 'state']) }, item.declared_status);
  } catch (e) {
    r = { status: 'unmeasured', error: `gh failed: ${String(e.stderr || e.message).trim().split('\n')[0]}` };
  }
  item.status = r.status;
  item.measured_at = nowIso;
  if (r.error) { item.measured_error = r.error; delete item.measured_from; }
  else { item.measured_from = r.from; delete item.measured_error; }
  return item;
}

export function collect(doc, nowIso, read = gh) {
  for (const s of doc.streams) for (const i of s.items) measureItem(i, nowIso, read);
  return doc;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const doc = JSON.parse(readFileSync(ROAD_PATH, 'utf8').split('\r\n').join('\n'));
  collect(doc, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const text = JSON.stringify(doc, null, 2) + '\n';
  const all = doc.streams.flatMap((s) => s.items).filter((i) => i.measured_at);
  const by = {};
  for (const i of all) by[i.status] = (by[i.status] || 0) + 1;
  if (process.argv.includes('--stdout')) process.stdout.write(text);
  else writeFileSync(ROAD_PATH, text);
  console.log(`collect-road-status: measured ${all.length} rows ${JSON.stringify(by)}`);
}
