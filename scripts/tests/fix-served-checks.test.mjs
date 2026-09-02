// Mutation-proof self-tests for scripts/lib/fix-served-checks.mjs (T-425).
// Imports the ACTUAL predicates — not a re-implementation — so weakening the
// check turns its fixture RED. Run: node --test scripts/tests/fix-served-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFixMergedNotServed,
  buildDeployFailureStatusRow,
  clearDeployStatus,
  setDeployFailureStatus,
  FIX_NOT_SERVED_FAIL_HOURS,
} from '../lib/fix-served-checks.mjs';

const NOW = '2026-09-02T06:00:00Z';
const hoursAgo = (h) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

// --- FAIL: merged > 24h ago, served commit predates the merge --------------

test('FAILs when a merged fixes-live-bug PR is not served after 24h', () => {
  const result = checkFixMergedNotServed({
    mergedPRs: [{ number: 327, mergedAt: hoursAgo(30) }],
    servedSha: 'aaa111',
    servedCommitTime: hoursAgo(40), // served commit is OLDER than the merge
    now: NOW,
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.offenders.length, 1);
  assert.equal(result.offenders[0].number, 327);
  assert.match(result.reason, /#327/);
  assert.equal(FIX_NOT_SERVED_FAIL_HOURS, 24);
});

// --- WARN: merged < 24h ago, not yet served ---------------------------------

test('WARNs when a merged fixes-live-bug PR is not yet served, within the grace window', () => {
  const result = checkFixMergedNotServed({
    mergedPRs: [{ number: 400, mergedAt: hoursAgo(2) }],
    servedSha: 'bbb222',
    servedCommitTime: hoursAgo(10), // still older than the merge, but merge is recent
    now: NOW,
  });
  assert.equal(result.status, 'WARN');
  assert.equal(result.offenders.length, 1);
  assert.equal(result.offenders[0].number, 400);
});

// --- PASS: served commit is at/after the merge ------------------------------

test('PASSes when the served commit is at or after every merge', () => {
  const result = checkFixMergedNotServed({
    mergedPRs: [{ number: 327, mergedAt: hoursAgo(30) }, { number: 328, mergedAt: hoursAgo(5) }],
    servedSha: 'ccc333',
    servedCommitTime: hoursAgo(1), // newer than both merges
    now: NOW,
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.offenders.length, 0);
});

test('PASSes trivially when there are no merged fixes-live-bug PRs', () => {
  const result = checkFixMergedNotServed({ mergedPRs: [], servedSha: 'ccc333', servedCommitTime: hoursAgo(1), now: NOW });
  assert.equal(result.status, 'PASS');
  assert.match(result.reason, /no merged/);
});

test('the boundary: exactly at the fail threshold is FAIL, one minute under is WARN', () => {
  const atThreshold = checkFixMergedNotServed({
    mergedPRs: [{ number: 1, mergedAt: hoursAgo(FIX_NOT_SERVED_FAIL_HOURS + 0.01) }],
    servedSha: 's', servedCommitTime: hoursAgo(100), now: NOW,
  });
  assert.equal(atThreshold.status, 'FAIL');

  const underThreshold = checkFixMergedNotServed({
    mergedPRs: [{ number: 1, mergedAt: hoursAgo(FIX_NOT_SERVED_FAIL_HOURS - 0.01) }],
    servedSha: 's', servedCommitTime: hoursAgo(100), now: NOW,
  });
  assert.equal(underThreshold.status, 'WARN');
});

// --- UNVERIFIABLE: missing inputs, never a silent PASS ----------------------

test('UNVERIFIABLE when the served SHA could not be read', () => {
  const result = checkFixMergedNotServed({ mergedPRs: [{ number: 1, mergedAt: hoursAgo(30) }], servedSha: null, servedCommitTime: null, now: NOW });
  assert.equal(result.status, 'UNVERIFIABLE');
  assert.match(result.reason, /served SHA unavailable/);
});

test('UNVERIFIABLE when the served SHA has no known commit time', () => {
  const result = checkFixMergedNotServed({ mergedPRs: [{ number: 1, mergedAt: hoursAgo(30) }], servedSha: 'aaa', servedCommitTime: null, now: NOW });
  assert.equal(result.status, 'UNVERIFIABLE');
  assert.match(result.reason, /no locally-known commit time/);
});

test('UNVERIFIABLE when gh could not list merged PRs (null, not empty array)', () => {
  const result = checkFixMergedNotServed({ mergedPRs: null, servedSha: 'aaa', servedCommitTime: hoursAgo(1), now: NOW });
  assert.equal(result.status, 'UNVERIFIABLE');
  assert.match(result.reason, /gh unavailable/);
});

// --- deploy-failure STATUS row (set / clear) --------------------------------

test('buildDeployFailureStatusRow shapes a row with an ISO failedAt', () => {
  const row = buildDeployFailureStatusRow({ slot: 'prod', sha: 'abc123', runUrl: 'https://x/y', gateReason: 'FATAL: pm2 restart failed', failedAt: NOW });
  assert.equal(row.slot, 'prod');
  assert.equal(row.sha, 'abc123');
  assert.equal(row.failedAt, new Date(NOW).toISOString());
});

test('setDeployFailureStatus adds/refreshes only the given slot, leaving others untouched', () => {
  const row = buildDeployFailureStatusRow({ slot: 'staging', sha: 'x', runUrl: 'u', gateReason: 'g', failedAt: NOW });
  const map1 = setDeployFailureStatus({ prod: { sha: 'existing' } }, 'staging', row);
  assert.deepEqual(map1.prod, { sha: 'existing' });
  assert.equal(map1.staging.sha, 'x');
});

test('clearDeployStatus removes only the given slot on a successful deploy, leaving other open failures', () => {
  const map = { prod: { sha: 'p1' }, staging: { sha: 's1' } };
  const cleared = clearDeployStatus(map, 'prod');
  assert.equal(cleared.prod, undefined);
  assert.deepEqual(cleared.staging, { sha: 's1' });
});

test('clearDeployStatus on an already-clear slot is a no-op, not an error', () => {
  const cleared = clearDeployStatus({ staging: { sha: 's1' } }, 'prod');
  assert.deepEqual(cleared, { staging: { sha: 's1' } });
});

test('clearDeployStatus tolerates a null/undefined map (nothing has ever failed yet)', () => {
  assert.deepEqual(clearDeployStatus(null, 'prod'), {});
  assert.deepEqual(clearDeployStatus(undefined, 'prod'), {});
});
