#!/usr/bin/env node
// scripts/ops/floor-delta.mjs — T-497, recurrence loop mechanism 2
// (.claude/rules/signal-ownership.md R3: "every nightly signal has a consumer
// that diffs it against the previous night. Output nobody reads counts as no
// detection.").
//
// WHY: docs/reviews/rca-2026-09-07-missed-live-defects.md — the nightly
// detection-floor (scripts/audit-detection-floor.mjs, run from
// scripts/vps-data-audit-cron.sh) already produces ~20 [FAIL]/[PASS] lines a
// night on the VPS. Nobody diffed one night against the next, so a genuinely
// NEW failure (a new check going red, or a new company entering an
// already-red check) sat inside a wall of standing red for hours to days
// (RC1/RC3 in the RCA). This script IS the consumer: it reads two nights'
// floor output, resolves every [FAIL] line to a check id + (where the line
// carries quoted entities) the set of named entities, and reports NEW / GONE
// / SAME so a NEW failure is visible the same morning instead of buried.
//
// Usage:
//   node scripts/ops/floor-delta.mjs <today.txt> <yesterday.txt> [--notify]
//
// Exit codes: 0 nothing NEW, 3 at least one NEW check id or NEW entity
// (mirrors audit-detection-floor.mjs's own exit-3-on-blind convention: a
// non-zero exit means "do not treat this run as quiet"), 2 usage/read error.
//
// --notify POSTs a summary to the shared Notifier gateway (GLOBAL.md §2):
// POST {NOTIFIER_URL}/notify with header X-Api-Key: {NOTIFIER_KEY}. Both are
// read from the environment (NOTIFIER_URL / NOTIFIER_KEY, or the
// project-scoped NOTIFIER_KEY_IPODHAN used elsewhere in this repo's cron
// scripts) — when neither is set, --notify prints one line and skips
// cleanly; it NEVER throws, so a missing credential can never turn a clean
// delta run into a crashed one.

import { readFileSync } from 'node:fs';

const FAIL_LINE = /^\[FAIL\]\s+(\S+)\s+(.*)$/;
const PASS_LINE = /^\[PASS\]\s+(\S+)\s+(.*)$/;
const QUOTED_ENTITY = /"([^"]+)"/g;

/**
 * Parse one night's floor-audit text output into a map of
 * checkId -> { status, detail, entities: Set<string> }.
 * Pure function — no I/O — so tests can feed it fixture strings directly.
 */
export function parseFloorOutput(text) {
  const checks = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const failMatch = line.match(FAIL_LINE);
    const passMatch = !failMatch && line.match(PASS_LINE);
    const match = failMatch || passMatch;
    if (!match) continue;
    const [, checkId, detail] = match;
    const entities = new Set();
    for (const m of detail.matchAll(QUOTED_ENTITY)) entities.add(m[1]);
    checks.set(checkId, {
      status: failMatch ? 'FAIL' : 'PASS',
      detail,
      entities,
    });
  }
  return checks;
}

/**
 * Diff two parsed nights (today vs yesterday). Pure function.
 * Returns { newIds, goneIds, sameIds, newEntitiesByCheck } where
 * newEntitiesByCheck is a Map<checkId, string[]> — only for checks present
 * (as FAIL) in BOTH nights, listing entities that are in today but not
 * yesterday.
 */
export function diffFloor(todayChecks, yesterdayChecks) {
  const todayFail = new Set([...todayChecks].filter(([, v]) => v.status === 'FAIL').map(([id]) => id));
  const yesterdayFail = new Set([...yesterdayChecks].filter(([, v]) => v.status === 'FAIL').map(([id]) => id));

  const newIds = [...todayFail].filter((id) => !yesterdayFail.has(id)).sort();
  const goneIds = [...yesterdayFail].filter((id) => !todayFail.has(id)).sort();
  const sameIds = [...todayFail].filter((id) => yesterdayFail.has(id)).sort();

  const newEntitiesByCheck = new Map();
  for (const id of sameIds) {
    const todayEntities = todayChecks.get(id).entities;
    const yesterdayEntities = yesterdayChecks.get(id).entities;
    const newEntities = [...todayEntities].filter((e) => !yesterdayEntities.has(e)).sort();
    if (newEntities.length > 0) newEntitiesByCheck.set(id, newEntities);
  }

  return { newIds, goneIds, sameIds, newEntitiesByCheck };
}

export function formatReport({ newIds, goneIds, sameIds, newEntitiesByCheck }, { todayPath, yesterdayPath } = {}) {
  const lines = [];
  lines.push(`=== FLOOR DELTA${todayPath ? `: ${yesterdayPath} -> ${todayPath}` : ''} ===`);
  lines.push(`NEW (${newIds.length}): ${newIds.length ? newIds.join(', ') : '(none)'}`);
  lines.push(`GONE (${goneIds.length}): ${goneIds.length ? goneIds.join(', ') : '(none)'}`);
  lines.push(`SAME (${sameIds.length}): ${sameIds.length ? sameIds.join(', ') : '(none)'}`);
  if (newEntitiesByCheck.size > 0) {
    lines.push(`NEW ENTITIES (${newEntitiesByCheck.size} check(s)):`);
    for (const [id, entities] of newEntitiesByCheck) {
      lines.push(`  ${id}: ${entities.map((e) => `"${e}"`).join(', ')}`);
    }
  } else {
    lines.push('NEW ENTITIES: (none)');
  }
  const hasNew = newIds.length > 0 || newEntitiesByCheck.size > 0;
  lines.push(`=== VERDICT: ${hasNew ? 'NEW FINDINGS — escalate before queued work (signal-ownership.md R4)' : 'no new findings'} ===`);
  return lines.join('\n');
}

// Gateway accepts only P0|P1|P2|info (GLOBAL.md §2) — 'high'/'low' are
// rejected with 400. This script's finding is never P0/P1 (no outage, no
// live-data corruption by itself — it's a detection signal), so it maps to
// P2 on a NEW finding and info otherwise.
export function buildNotifyPayload(summary, { newIds, newEntitiesByCheck }) {
  const hasNew = newIds.length > 0 || newEntitiesByCheck.size > 0;
  return {
    project: 'ipodhan',
    severity: hasNew ? 'P2' : 'info',
    title: hasNew ? 'nightly floor: NEW finding(s)' : 'nightly floor: no new findings',
    body: summary.slice(0, 3500),
    type: 'floor-delta',
    dedupeKey: `floor-delta-${new Date().toISOString().slice(0, 10)}`,
  };
}

export async function postToNotifier(summary, delta) {
  const url = process.env.NOTIFIER_URL;
  const key = process.env.NOTIFIER_KEY || process.env.NOTIFIER_KEY_IPODHAN;
  if (!url || !key) {
    console.log('NOTIFY-SKIP: NOTIFIER_URL/NOTIFIER_KEY (or NOTIFIER_KEY_IPODHAN) not set');
    return false;
  }
  const payload = buildNotifyPayload(summary, delta);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 200 && res.status < 300) {
      console.log(`NOTIFY-OK ${res.status}`);
      return true;
    }
    let body = '';
    try {
      body = (await res.text()).slice(0, 200);
    } catch {
      // best-effort body read only
    }
    console.log(`NOTIFY-FAIL ${res.status} ${body}`);
    return false;
  } catch (err) {
    console.log(`NOTIFY-ERROR: ${err.message} (never fatal to this script)`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--notify');
  const notify = process.argv.includes('--notify');
  const [todayPath, yesterdayPath] = args;

  if (!todayPath || !yesterdayPath) {
    console.error('Usage: node scripts/ops/floor-delta.mjs <today.txt> <yesterday.txt> [--notify]');
    process.exit(2);
  }

  let todayText, yesterdayText;
  try {
    todayText = readFileSync(todayPath, 'utf-8');
    yesterdayText = readFileSync(yesterdayPath, 'utf-8');
  } catch (err) {
    console.error(`FATAL: could not read input file(s): ${err.message}`);
    process.exit(2);
  }

  const todayChecks = parseFloorOutput(todayText);
  const yesterdayChecks = parseFloorOutput(yesterdayText);
  const delta = diffFloor(todayChecks, yesterdayChecks);
  const report = formatReport(delta, { todayPath, yesterdayPath });
  console.log(report);

  if (notify) await postToNotifier(report, delta);

  const hasNew = delta.newIds.length > 0 || delta.newEntitiesByCheck.size > 0;
  process.exit(hasNew ? 3 : 0);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain || process.argv[1]?.endsWith('floor-delta.mjs')) {
  main();
}
