// Mutation-proof self-tests for scripts/lib/fix-served-checks.mjs (T-425).
// Imports the ACTUAL predicates — not a re-implementation — so weakening the
// check turns its fixture RED. Run: node --test scripts/tests/fix-served-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFixMergedNotServed,
  checkDeployFailureOpen,
  buildDeployFailureStatusRow,
  clearDeployStatus,
  setDeployFailureStatus,
  FIX_NOT_SERVED_FAIL_HOURS,
  DEPLOY_FAILURE_OPEN_FAIL_HOURS,
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

test('the boundary: 0.01h over the fail threshold is FAIL, 0.01h under is WARN, exactly AT it is WARN (threshold is strictly-greater-than)', () => {
  const overThreshold = checkFixMergedNotServed({
    mergedPRs: [{ number: 1, mergedAt: hoursAgo(FIX_NOT_SERVED_FAIL_HOURS + 0.01) }],
    servedSha: 's', servedCommitTime: hoursAgo(100), now: NOW,
  });
  assert.equal(overThreshold.status, 'FAIL');

  const underThreshold = checkFixMergedNotServed({
    mergedPRs: [{ number: 1, mergedAt: hoursAgo(FIX_NOT_SERVED_FAIL_HOURS - 0.01) }],
    servedSha: 's', servedCommitTime: hoursAgo(100), now: NOW,
  });
  assert.equal(underThreshold.status, 'WARN');

  const atThreshold = checkFixMergedNotServed({
    mergedPRs: [{ number: 1, mergedAt: hoursAgo(FIX_NOT_SERVED_FAIL_HOURS) }],
    servedSha: 's', servedCommitTime: hoursAgo(100), now: NOW,
  });
  assert.equal(atThreshold.status, 'WARN', 'the check uses ageHours > FAIL_HOURS, so exactly 24.000h is still WARN, not FAIL');
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

// --- T-425 m2: git-ancestry ground truth over the time-compare fallback ----

test('isAncestor(true) wins even when the time compare would say NOT served (e.g. a re-authored commit)', () => {
  const result = checkFixMergedNotServed({
    mergedPRs: [{ number: 500, mergedAt: hoursAgo(30), mergeSha: 'merge500' }],
    servedSha: 'served-sha',
    servedCommitTime: hoursAgo(40), // time compare alone would say NOT served
    now: NOW,
    isAncestor: (mergeSha, servedSha) => mergeSha === 'merge500' && servedSha === 'served-sha',
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.offenders.length, 0);
});

test('isAncestor(false) wins even when the time compare would say served', () => {
  const result = checkFixMergedNotServed({
    mergedPRs: [{ number: 501, mergedAt: hoursAgo(30), mergeSha: 'merge501' }],
    servedSha: 'served-sha',
    servedCommitTime: hoursAgo(1), // time compare alone would say served
    now: NOW,
    isAncestor: () => false,
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.offenders[0].number, 501);
});

test('isAncestor returning null (not both SHAs local) falls back to the time compare', () => {
  const result = checkFixMergedNotServed({
    mergedPRs: [{ number: 502, mergedAt: hoursAgo(30), mergeSha: 'merge502' }],
    servedSha: 'served-sha',
    servedCommitTime: hoursAgo(1), // time compare says served
    now: NOW,
    isAncestor: () => null,
  });
  assert.equal(result.status, 'PASS');
});

test('no isAncestor function, or no mergeSha on the PR, falls back to the time compare (back-compat)', () => {
  const noFnResult = checkFixMergedNotServed({
    mergedPRs: [{ number: 503, mergedAt: hoursAgo(30) }],
    servedSha: 's', servedCommitTime: hoursAgo(1), now: NOW,
  });
  assert.equal(noFnResult.status, 'PASS');

  const noMergeShaResult = checkFixMergedNotServed({
    mergedPRs: [{ number: 504, mergedAt: hoursAgo(30) }], // no mergeSha field
    servedSha: 's', servedCommitTime: hoursAgo(1), now: NOW,
    isAncestor: () => { throw new Error('must not be called without a mergeSha'); },
  });
  assert.equal(noMergeShaResult.status, 'PASS');
});

// --- T-425 m_deploy_failure_open: the STATUS row read back ------------------

test('m_deploy_failure_open FAILs when a slot has been open for more than 24h', () => {
  const result = checkDeployFailureOpen({
    statusMap: { prod: { sha: 'p1', failedAt: hoursAgo(DEPLOY_FAILURE_OPEN_FAIL_HOURS + 1) } },
    now: NOW,
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.offenders.length, 1);
  assert.equal(result.offenders[0].slot, 'prod');
  assert.match(result.reason, /prod/);
});

test('m_deploy_failure_open WARNs when a slot is open but under 24h', () => {
  const result = checkDeployFailureOpen({
    statusMap: { staging: { sha: 's1', failedAt: hoursAgo(2) } },
    now: NOW,
  });
  assert.equal(result.status, 'WARN');
  assert.equal(result.offenders[0].slot, 'staging');
});

test('m_deploy_failure_open PASSes when no slot has an open row', () => {
  const result = checkDeployFailureOpen({ statusMap: {}, now: NOW });
  assert.equal(result.status, 'PASS');
  assert.equal(result.offenders.length, 0);
});

test('m_deploy_failure_open is UNVERIFIABLE when the status file could not be read/parsed (null, not {})', () => {
  const result = checkDeployFailureOpen({ statusMap: null, now: NOW });
  assert.equal(result.status, 'UNVERIFIABLE');
  assert.match(result.reason, /could not be read/);
});
