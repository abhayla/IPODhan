#!/usr/bin/env node
// scripts/audit-alert-channel.mjs — #195 J1, "signal:noise, weekly".
//
// WHY THIS EXISTS: T-285 found 378 owner alerts of which 346 (92%) were one
// type and 298 of those (86%) compared a source against itself
// (`NSE="788" vs NSE="750"`, literally the top and bottom of one price
// band). 97% were tagged P1. That is not noisy monitoring, it is monitoring
// switched off by its own output: the genuine `heartbeat-miss` P1 for a dead
// freshness watchdog fired correctly and went unactioned for 23 hours,
// buried under 346 false ones. This script is the standing measurement that
// would have caught that BEFORE the burial, run weekly against the real
// Notifier delivery log (never a re-implementation of it).
//
// WHAT IT READS: the Notifier's own append-only JSONL audit trail
// (`src/delivery-log.ts` on the Notifier box — one JSON object per line,
// `{event:{project,severity,type,...}, routed, suppressed, ..., at}`), the
// SAME file the Notifier itself writes on every dispatch (including
// suppressions). This script never re-derives delivery state from anywhere
// else.
//
// WHAT IT ASSERTS, over the trailing 7 days, for project `ipodhan` (prod;
// exact match — `ipodhan-staging` is a different project and is not part of
// the owner's alert channel):
//   - no single alert TYPE exceeds 60% of total volume
//   - P1 alerts are at most 20% of total volume
//   - zero alerts where source1 == source2 (the T-285 self-comparison shape,
//     detected from the `(SRC1="..." vs SRC2="...")` body suffix the
//     cross-source-disagreement alert type writes)
// The histogram (by type, by severity) is ALWAYS printed, pass or fail, so
// the trend is visible before any threshold breaches (#195's own wording).
//
// Usage:
//   node scripts/audit-alert-channel.mjs                                  -> report, exit 0 always
//   node scripts/audit-alert-channel.mjs --gate                           -> report + gate
//   DELIVERY_LOG_PATH=/root/notifier/state/delivery-log.jsonl node scripts/audit-alert-channel.mjs --gate
//
// EXIT CODES (--gate mode; report mode always exits 0):
//   0  every assertion held (or the log had zero rows in the window — an
//      empty week is not a violation).
//   1  at least one assertion failed.
//   3  the delivery log could not be read at all — UNVERIFIABLE, never a
//      silent pass.
//   2  the audit itself crashed.
//
// Read-only: this script never writes to the delivery log or to the
// Notifier's config. Non-fatal in the nightly/weekly audit for now (see the
// PR body) — a brand-new check on real production data must prove itself
// before it can turn the audit red.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_LOG_PATH = '/root/notifier/state/delivery-log.jsonl';
const PROJECT = 'ipodhan';
const WINDOW_DAYS = 7;
const MAX_TYPE_SHARE = 0.6;
const MAX_P1_SHARE = 0.2;

const GATE = process.argv.includes('--gate');

/** Parse one JSONL line into an event, or null if it is not a usable delivery record. */
export function parseDeliveryLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!record || typeof record !== 'object' || !record.event || !record.at) return null;
  return record;
}

/**
 * Extract the two compared source labels from a cross-source-disagreement
 * body, e.g. `... (CHITTORGARH="2026-09-23" vs BSE="2026-09-25")` ->
 * ['CHITTORGARH', 'BSE']. Returns null when the body does not carry the
 * `(SRC1="..." vs SRC2="...")` suffix at all (most alert types never do).
 */
export function extractComparedSources(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/\(([A-Z_]+)="[^"]*"\s+vs\s+([A-Z_]+)="[^"]*"\)/);
  if (!match) return null;
  return [match[1], match[2]];
}

/**
 * Pure of process.exit and of the filesystem — takes already-parsed records
 * (the caller reads the file) and returns a summary. Testable on fixtures
 * with no real log on disk.
 */
export function summarizeAlertChannel(records, { project = PROJECT, now = new Date(), windowDays = WINDOW_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const inWindow = records.filter((r) => {
    if (r.event.project !== project) return false;
    const at = new Date(r.at);
    return !Number.isNaN(at.getTime()) && at >= cutoff && at <= now;
  });

  const byType = new Map();
  const bySeverity = new Map();
  const selfComparisons = [];

  for (const r of inWindow) {
    const type = r.event.type ?? '(untyped)';
    const severity = r.event.severity ?? '(no-severity)';
    byType.set(type, (byType.get(type) ?? 0) + 1);
    bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);

    const sources = extractComparedSources(r.event.body);
    if (sources && sources[0] === sources[1]) {
      selfComparisons.push({ dedupeKey: r.event.dedupeKey, at: r.at, source: sources[0] });
    }
  }

  const total = inWindow.length;
  const typeHistogram = [...byType.entries()]
    .map(([type, count]) => ({ type, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
  const severityHistogram = [...bySeverity.entries()]
    .map(([severity, count]) => ({ severity, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);

  const dominantType = typeHistogram[0] ?? null;
  const p1 = bySeverity.get('P1') ?? 0;
  const p1Share = total ? p1 / total : 0;

  const violations = [];
  if (dominantType && dominantType.share > MAX_TYPE_SHARE) {
    violations.push(
      `single type "${dominantType.type}" is ${(dominantType.share * 100).toFixed(1)}% of volume (max ${MAX_TYPE_SHARE * 100}%)`
    );
  }
  if (p1Share > MAX_P1_SHARE) {
    violations.push(`P1 alerts are ${(p1Share * 100).toFixed(1)}% of volume (max ${MAX_P1_SHARE * 100}%)`);
  }
  if (selfComparisons.length > 0) {
    violations.push(`${selfComparisons.length} self-comparison alert(s) (source1 == source2, the T-285 shape)`);
  }

  return {
    project,
    windowDays,
    total,
    typeHistogram,
    severityHistogram,
    selfComparisons,
    violations,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
  };
}

function printReport(summary) {
  console.log(`=== alert-channel audit: project=${summary.project}, trailing ${summary.windowDays}d ===`);
  console.log(`total alerts: ${summary.total}`);
  console.log('by type:');
  for (const { type, count, share } of summary.typeHistogram) {
    console.log(`  ${count.toString().padStart(5)}  ${(share * 100).toFixed(1).padStart(5)}%  ${type}`);
  }
  console.log('by severity:');
  for (const { severity, count, share } of summary.severityHistogram) {
    console.log(`  ${count.toString().padStart(5)}  ${(share * 100).toFixed(1).padStart(5)}%  ${severity}`);
  }
  if (summary.selfComparisons.length > 0) {
    console.log(`self-comparisons: ${summary.selfComparisons.length}`);
    for (const sc of summary.selfComparisons.slice(0, 10)) {
      console.log(`  ${sc.at}  ${sc.source}==${sc.source}  ${sc.dedupeKey}`);
    }
  } else {
    console.log('self-comparisons: 0');
  }
  if (summary.violations.length > 0) {
    console.log(`[FAIL] ${summary.violations.length} violation(s):`);
    for (const v of summary.violations) console.log(`  - ${v}`);
  } else {
    console.log('[PASS] no violations');
  }
}

async function main() {
  const logPath = process.env.DELIVERY_LOG_PATH || DEFAULT_LOG_PATH;
  let raw;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch (err) {
    console.log(`=== alert-channel audit: project=${PROJECT}, trailing ${WINDOW_DAYS}d ===`);
    console.log(`UNVERIFIABLE: could not read delivery log at ${logPath}: ${err.message}`);
    process.exit(GATE ? 3 : 0);
    return;
  }

  const records = raw
    .split('\n')
    .map(parseDeliveryLine)
    .filter((r) => r !== null);

  const summary = summarizeAlertChannel(records, { project: PROJECT, windowDays: WINDOW_DAYS });
  printReport(summary);

  if (!GATE) {
    process.exit(0);
    return;
  }
  process.exit(summary.status === 'PASS' ? 0 : 1);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error('CRASHED:', err);
    process.exit(2);
  });
}
