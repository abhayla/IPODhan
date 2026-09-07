// T-496 round 2: R2 says "no number = new = escalate this tick" — an untracked entry must
// escalate on EVERY run (NEW or SAME), never just its first appearance. These tests cover
// the pure state-transition helpers that failure-delta.mjs's CLI wraps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrackArg, resolveTrackedState, countUntracked, formatSshFailure } from '../ops/lib/failure-tick-state.mjs';

const ERROR_CLASSES = ['persist-insert-failed', 'unit-unparseable', 'spawn-timeout-hard', 'spawn-timeout-soft', 'anchor-deterministic-refusal', 'other'];

function entry(overrides) {
  return { ipoId: 'ipo-1', docType: 'PRICE_BAND_AD', errorClass: 'persist-insert-failed', company: 'Rentomojo Ltd.', firstSeen: '2026-09-07T16:16:31.384Z', ...overrides };
}

test('untracked-SAME: an entry present in both previous and current state with no issueNumber counts as untracked', () => {
  const current = new Map([['k1', entry()]]);
  const previous = { k1: { ...entry(), issueNumber: null } };
  resolveTrackedState(current, previous, []);
  assert.equal(countUntracked(current), 1, 'SAME entry with no issue number must still escalate, not read as known');
});

test('tracked-SAME: an entry carried forward with a previously-recorded issueNumber does not escalate', () => {
  const current = new Map([['k1', entry()]]);
  const previous = { k1: { ...entry(), issueNumber: 402 } };
  resolveTrackedState(current, previous, []);
  assert.equal(countUntracked(current), 0);
  assert.equal(current.get('k1').issueNumber, 402);
});

test('--track by ipoId records an issue number for a NEW (never-seen) entry', () => {
  const current = new Map([['k1', entry({ ipoId: 'b28d9d2a-cb24-4d84-8e1a-297ba828884a' })]]);
  const track = [parseTrackArg('b28d9d2a-cb24-4d84-8e1a-297ba828884a=402', ERROR_CLASSES)];
  resolveTrackedState(current, {}, track);
  assert.equal(current.get('k1').issueNumber, 402);
  assert.equal(countUntracked(current), 0);
});

test('--track by errorClass matches every entry of that class', () => {
  const current = new Map([
    ['k1', entry({ ipoId: 'a', errorClass: 'unit-unparseable' })],
    ['k2', entry({ ipoId: 'b', errorClass: 'unit-unparseable' })],
    ['k3', entry({ ipoId: 'c', errorClass: 'persist-insert-failed' })],
  ]);
  const track = [parseTrackArg('unit-unparseable=403', ERROR_CLASSES)];
  resolveTrackedState(current, {}, track);
  assert.equal(current.get('k1').issueNumber, 403);
  assert.equal(current.get('k2').issueNumber, 403);
  assert.equal(current.get('k3').issueNumber, null);
  assert.equal(countUntracked(current), 1);
});

test('T-502: a persisted classIssues entry tracks a NEW key of that class, first-seen this run', () => {
  const current = new Map([['k1', entry({ ipoId: 'never-seen-before', errorClass: 'unit-unparseable' })]]);
  // No previousFailures entry for k1 (it is genuinely NEW this run) and no --track rule
  // this run — only a class track persisted from an earlier run.
  resolveTrackedState(current, {}, [], { 'unit-unparseable': 403 });
  assert.equal(current.get('k1').issueNumber, 403);
  assert.equal(countUntracked(current), 0);
});

test('T-502: a per-key --track this run still wins over a persisted class track', () => {
  const current = new Map([['k1', entry({ ipoId: 'ipo-special', errorClass: 'unit-unparseable' })]]);
  const track = [parseTrackArg('ipo-special=999', ERROR_CLASSES)];
  resolveTrackedState(current, {}, track, { 'unit-unparseable': 403 });
  assert.equal(current.get('k1').issueNumber, 999, 'per-key track must override the class track');
});

test('T-502: a per-key issueNumber already carried forward from a previous run is not clobbered by a class track', () => {
  const current = new Map([['k1', entry({ ipoId: 'ipo-a', errorClass: 'unit-unparseable' })]]);
  const previous = { k1: { ...entry({ ipoId: 'ipo-a', errorClass: 'unit-unparseable' }), issueNumber: 111 } };
  resolveTrackedState(current, previous, [], { 'unit-unparseable': 403 });
  assert.equal(current.get('k1').issueNumber, 111);
});

test('parseTrackArg rejects malformed input', () => {
  assert.throws(() => parseTrackArg('no-equals-sign', ERROR_CLASSES));
  assert.throws(() => parseTrackArg('ipo-1=not-a-number', ERROR_CLASSES));
});

test('firstSeen is carried forward from the previous run, not overwritten by this run\'s value', () => {
  const current = new Map([['k1', entry({ firstSeen: '2026-09-08T09:00:00.000Z' })]]);
  const previous = { k1: { ...entry(), firstSeen: '2026-09-06T12:04:00.000Z', issueNumber: null } };
  resolveTrackedState(current, previous, []);
  assert.equal(current.get('k1').firstSeen, '2026-09-06T12:04:00.000Z');
});

test('firstSeen falls back to this run\'s value when there is no previous state (true NEW)', () => {
  const current = new Map([['k1', entry({ firstSeen: '2026-09-08T09:00:00.000Z' })]]);
  resolveTrackedState(current, {}, []);
  assert.equal(current.get('k1').firstSeen, '2026-09-08T09:00:00.000Z');
});

test('formatSshFailure prefers stderr, falls back to message, never includes a stack trace', () => {
  const withStderr = formatSshFailure({ stderr: Buffer.from('ssh: connect to host rfp-vps port 22: Connection timed out\n') });
  assert.equal(withStderr, 'failure-delta: ssh read failed: ssh: connect to host rfp-vps port 22: Connection timed out');

  const withMessageOnly = formatSshFailure({ message: 'spawnSync ssh ENOENT' });
  assert.equal(withMessageOnly, 'failure-delta: ssh read failed: spawnSync ssh ENOENT');

  const err = new Error('boom');
  const formatted = formatSshFailure(err);
  assert.ok(!formatted.includes('at '), 'must not include a stack trace frame');
  assert.equal(formatted, 'failure-delta: ssh read failed: boom');
});
