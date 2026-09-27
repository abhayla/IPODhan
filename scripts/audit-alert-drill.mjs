#!/usr/bin/env node
// scripts/audit-alert-drill.mjs — #195 J2, "prove the notify path end to end".
//
// WHY THIS EXISTS: T-294C's shape is a dead notify block — the caller code
// "ran fine" while the alert it thought it sent could never actually fire
// (a wrong key, a mis-typed project, a route with no destination). J1
// (scripts/audit-alert-channel.mjs) measures whether the ALERTS THAT DID
// FIRE are noisy. It cannot tell you the path is alive at all, because a
// notify path that never posts anything produces an empty, "clean" log —
// the same shape as a healthy, quiet week. J2 closes that gap: once a week
// it POSTS a real, synthetic event through the exact same Notifier
// `/notify` route the rest of the codebase uses (scraper/src/services/
// owner-notify.ts), as a dedicated project (`ipodhan-alert-drill`) that
// routes to NO human destination (docs/ops/prod-ops-recipes.md #17 —
// "a channel the owner does not see", #195's own wording), then reads the
// SAME delivery log J1 reads and asserts the drill event actually landed.
//
// WHAT IT PROVES: POST -> 2xx -> the event appears in
// state/delivery-log.jsonl with this run's dedupeKey. That is the whole
// notify path (auth, routing, logging) exercised on every run, without
// ever paging a person.
//
// RESULT SEMANTICS (the class this fixes, defect-fix-contract.md):
//   - UNVERIFIABLE, never FAIL, when NOTIFIER_URL or
//     NOTIFIER_KEY_IPODHAN_ALERT_DRILL is absent from this process's env —
//     that is an ops step owed to the box (see the PR body / prod-ops-
//     recipes.md #17), not evidence the path is broken.
//   - FAIL when the POST itself is rejected (non-2xx, network error) — the
//     path could not even be exercised.
//   - FAIL when the POST succeeded but the event never appears in the
//     delivery log — the path accepted the request and then silently lost
//     it (the T-294C shape, caught for real this time).
//   - PASS only when the POST succeeded AND the drill event is found in the
//     log under this run's own dedupeKey.
//
// Usage:
//   node scripts/audit-alert-drill.mjs                 -> report, exit reflects status
//   DELIVERY_LOG_PATH=/root/notifier/state/delivery-log.jsonl \
//   NOTIFIER_URL=http://127.0.0.1:3300 \
//   NOTIFIER_KEY_IPODHAN_ALERT_DRILL=... \
//     node scripts/audit-alert-drill.mjs
//
// EXIT CODES:
//   0  PASS — drill event posted and confirmed in the delivery log.
//   1  FAIL — POST rejected, or posted but not found in the log.
//   3  UNVERIFIABLE — NOTIFIER_URL/NOTIFIER_KEY_IPODHAN_ALERT_DRILL absent,
//      or the delivery log could not be read after a successful POST.
//   2  the audit itself crashed.
//
// Read path: this script never writes to the delivery log directly — it
// only reads the Notifier's own append-only JSONL (same file J1 reads) to
// confirm what the Notifier itself recorded.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseDeliveryLine } from './audit-alert-channel.mjs';
import { istDayIso } from './lib/ist-day.mjs';

const DEFAULT_LOG_PATH = '/root/notifier/state/delivery-log.jsonl';
export const DRILL_PROJECT = 'ipodhan-alert-drill';
export const DRILL_TYPE = 'alert-drill';

/**
 * Week-scoped dedupeKey. J2 runs once a week (one weekday, IST — see
 * vps-data-audit-cron.sh); the IST calendar day of that single weekly run
 * is therefore already week-scoped in practice, and reusing istDayIso keeps
 * this file free of a second, hand-rolled ISO-week implementation (the
 * "two definitions of the same concept" class, one-concept-several-
 * definitions.md).
 */
export function buildDrillDedupeKey(now = new Date()) {
  return `${DRILL_TYPE}-${istDayIso(now)}`;
}

export function buildDrillEvent(now = new Date()) {
  const dedupeKey = buildDrillDedupeKey(now);
  return {
    project: DRILL_PROJECT,
    severity: 'info',
    type: DRILL_TYPE,
    title: 'IPODhan alert-drill (synthetic, routes to no destination)',
    body: `Weekly proof that the Notifier notify path is alive (#195 J2). dedupeKey=${dedupeKey}`,
    dedupeKey,
  };
}

/**
 * POST the drill event. Pure of process.env — the caller reads url/key so
 * this function is trivially unit-testable with a mocked fetchImpl.
 * Never throws; the outcome says what happened.
 */
export async function postDrillEvent({ fetchImpl, url, key, event, timeoutMs = 5000 }) {
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { posted: false, reason: `Notifier returned HTTP ${res.status}` };
    return { posted: true, status: res.status };
  } catch (err) {
    return { posted: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Find the just-posted drill event in already-parsed delivery-log records.
 * Matches on project + dedupeKey, the same two fields the Notifier itself
 * uses to identify a delivery record (per audit-alert-channel.mjs's own
 * record shape).
 */
export function findDrillInLog(records, { project = DRILL_PROJECT, dedupeKey }) {
  return records.find((r) => r.event?.project === project && r.event?.dedupeKey === dedupeKey) ?? null;
}

/**
 * The whole drill, as a pure-ish orchestration function taking every
 * external effect as a parameter (fetchImpl, readFileImpl, env) so it is
 * unit-testable end to end with no real network or filesystem. Returns a
 * summary object; never calls process.exit.
 */
export async function runDrill({
  notifierUrl,
  notifierKey,
  deliveryLogPath,
  fetchImpl = fetch,
  readFileImpl = readFileSync,
  now = new Date(),
} = {}) {
  if (!notifierUrl || !notifierKey) {
    return {
      status: 'UNVERIFIABLE',
      reason:
        'NOTIFIER_URL / NOTIFIER_KEY_IPODHAN_ALERT_DRILL not set in this process env (ops step — see docs/ops/prod-ops-recipes.md #17)',
    };
  }

  const event = buildDrillEvent(now);
  const postResult = await postDrillEvent({ fetchImpl, url: notifierUrl, key: notifierKey, event });
  if (!postResult.posted) {
    return { status: 'FAIL', reason: `POST rejected: ${postResult.reason}`, event };
  }

  let raw;
  try {
    raw = readFileImpl(deliveryLogPath, 'utf8');
  } catch (err) {
    return {
      status: 'UNVERIFIABLE',
      reason: `drill event was posted (HTTP ${postResult.status}) but the delivery log could not be read at ${deliveryLogPath}: ${err.message}`,
      event,
    };
  }

  const records = raw.split('\n').map(parseDeliveryLine).filter((r) => r !== null);
  const found = findDrillInLog(records, { dedupeKey: event.dedupeKey });
  if (!found) {
    return {
      status: 'FAIL',
      reason: `drill event posted (HTTP ${postResult.status}, dedupeKey=${event.dedupeKey}) but never appeared in the delivery log — the notify path accepted it and then lost it`,
      event,
    };
  }

  return { status: 'PASS', reason: `drill event posted and confirmed in the delivery log (dedupeKey=${event.dedupeKey})`, event, record: found };
}

function printReport(summary) {
  console.log('=== alert-drill audit: #195 J2 ===');
  console.log(`project: ${DRILL_PROJECT}  type: ${DRILL_TYPE}`);
  if (summary.event) console.log(`dedupeKey: ${summary.event.dedupeKey}`);
  console.log(`[${summary.status}] ${summary.reason}`);
}

async function main() {
  const notifierUrl = process.env.NOTIFIER_URL;
  const notifierKey = process.env.NOTIFIER_KEY_IPODHAN_ALERT_DRILL;
  const deliveryLogPath = process.env.DELIVERY_LOG_PATH || DEFAULT_LOG_PATH;

  const summary = await runDrill({ notifierUrl, notifierKey, deliveryLogPath });
  printReport(summary);

  const exitCodes = { PASS: 0, FAIL: 1, UNVERIFIABLE: 3 };
  process.exit(exitCodes[summary.status] ?? 2);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error('CRASHED:', err);
    process.exit(2);
  });
}
