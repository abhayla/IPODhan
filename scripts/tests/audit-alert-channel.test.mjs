// #195 J1: self-test for the alert-channel signal:noise audit. Failing-test-
// first per the defect-fix contract — these assert on the REAL function
// (summarizeAlertChannel / extractComparedSources / parseDeliveryLine), never
// a re-implementation, against a fixture copied (redacted) from the real
// Notifier delivery-log.jsonl shape captured 2026-09-26 on the Hostinger VPS
// (project ipodhan / ipodhan-staging, `{event:{project,severity,type,...},
// routed, suppressed, results, at}`). No network, no filesystem beyond the
// fixture: deterministic in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseDeliveryLine,
  extractComparedSources,
  summarizeAlertChannel,
} from '../audit-alert-channel.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'notifier-delivery-log-fixture.jsonl');
const FIXTURE_LINES = readFileSync(FIXTURE_PATH, 'utf8').split('\n');
const FIXTURE_RECORDS = FIXTURE_LINES.map(parseDeliveryLine).filter((r) => r !== null);

test('parseDeliveryLine parses a real-shaped record and skips blank/garbage lines', () => {
  assert.equal(FIXTURE_RECORDS.length, 7, 'fixture has 7 well-formed delivery records');
  assert.equal(parseDeliveryLine(''), null);
  assert.equal(parseDeliveryLine('   '), null);
  assert.equal(parseDeliveryLine('not json'), null);
  assert.equal(parseDeliveryLine('{"no_event_field": true}'), null);
  const rec = parseDeliveryLine(FIXTURE_LINES[0]);
  assert.equal(rec.event.project, 'ipodhan');
  assert.equal(rec.event.type, 'detection-floor');
});

test('extractComparedSources finds the (SRC1="..." vs SRC2="...") suffix, self and cross', () => {
  assert.deepEqual(
    extractComparedSources('HELD (NSE="788" vs NSE="750")'),
    ['NSE', 'NSE']
  );
  assert.deepEqual(
    extractComparedSources('HELD (CHITTORGARH="2026-09-23" vs BSE="2026-09-25")'),
    ['CHITTORGARH', 'BSE']
  );
  assert.equal(extractComparedSources('no comparison here'), null);
  assert.equal(extractComparedSources(undefined), null);
  assert.equal(extractComparedSources(123), null);
});

// Fixed "now" so the 7-day window is deterministic regardless of when the
// suite runs. Window = [2026-09-20T00:00:00Z .. 2026-09-27T00:00:00Z]; the
// 2026-08-10 fixture row is deliberately OUTSIDE it (proves the window
// filter excludes stale rows, not just includes fresh ones).
const FIXED_NOW = new Date('2026-09-27T00:00:00.000Z');

test('summarizeAlertChannel: real-shaped fixture reproduces the T-285 self-comparison + P1-inflation shape', () => {
  const summary = summarizeAlertChannel(FIXTURE_RECORDS, { project: 'ipodhan', now: FIXED_NOW });

  // project filter: excludes ipodhan-staging and the out-of-window row.
  assert.equal(summary.total, 5, 'only in-window, project=ipodhan rows are counted');

  // T-285 shape: the self-comparison (NSE="788" vs NSE="750") is caught.
  assert.equal(summary.selfComparisons.length, 1);
  assert.equal(summary.selfComparisons[0].source, 'NSE');

  // P1 inflation: heartbeat-miss + cross-source-disagreement + deploy-drift
  // are all P1 = 3 of 5 = 60%, over the 20% cap.
  const p1Row = summary.severityHistogram.find((s) => s.severity === 'P1');
  assert.equal(p1Row.count, 3);
  assert.ok(p1Row.share > 0.2);

  assert.equal(summary.status, 'FAIL');
  assert.ok(summary.violations.some((v) => v.includes('P1 alerts')));
  assert.ok(summary.violations.some((v) => v.includes('self-comparison')));
});

test('summarizeAlertChannel: healthy volume passes all three assertions (discriminates, not always-red)', () => {
  const now = new Date('2026-01-08T00:00:00.000Z');
  const makeRow = (type, severity, dayOffset, body = 'no comparison here') => ({
    event: { project: 'ipodhan', severity, type, body, dedupeKey: `${type}-${dayOffset}` },
    at: new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000).toISOString(),
  });
  // 10 alerts: 4 types spread out (max share 40% < 60%), 1 P1 (10% < 20%),
  // zero self-comparisons.
  const records = [
    makeRow('detection-floor', 'P2', 1),
    makeRow('detection-floor', 'P2', 1),
    makeRow('detection-floor', 'P2', 2),
    makeRow('detection-floor', 'P2', 2),
    makeRow('document-discovery-blocked', 'P2', 1),
    makeRow('document-discovery-blocked', 'P2', 2),
    makeRow('deploy-drift', 'P2', 3),
    makeRow('freshness-breach', 'P1', 4),
    makeRow('freshness-breach', 'P2', 4),
    makeRow('data-audit', 'info', 5),
  ];
  const summary = summarizeAlertChannel(records, { project: 'ipodhan', now });
  assert.equal(summary.total, 10);
  assert.equal(summary.selfComparisons.length, 0);
  assert.equal(summary.status, 'PASS', JSON.stringify(summary.violations));
});

test('summarizeAlertChannel: dominant-type-over-60% is flagged even with healthy P1 share', () => {
  const now = new Date('2026-01-08T00:00:00.000Z');
  const makeRow = (type, severity, i) => ({
    event: { project: 'ipodhan', severity, type, body: 'no comparison here', dedupeKey: `${type}-${i}` },
    at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const records = [
    ...Array.from({ length: 8 }, (_, i) => makeRow('document-discovery-blocked', 'P2', i)),
    makeRow('freshness-breach', 'P2', 8),
    makeRow('deploy-drift', 'P2', 9),
  ];
  const summary = summarizeAlertChannel(records, { project: 'ipodhan', now });
  assert.equal(summary.total, 10);
  assert.equal(summary.status, 'FAIL');
  assert.ok(summary.violations.some((v) => v.includes('single type')));
  assert.equal(summary.violations.length, 1, 'only the dominant-type assertion should fail here');
});

test('summarizeAlertChannel: zero rows in window is PASS, not a violation', () => {
  const summary = summarizeAlertChannel([], { project: 'ipodhan', now: FIXED_NOW });
  assert.equal(summary.total, 0);
  assert.equal(summary.status, 'PASS');
});
