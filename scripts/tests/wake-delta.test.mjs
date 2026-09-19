// #793 M2 — tests for scripts/ops/wake-delta.mjs, the consumer for the scraper
// wake log (.claude/rules/signal-ownership.md R1/R3).
//
// The defect this guards: on 2026-09-19 eighteen `wake-failed ... exit=1` lines
// sat in /var/log/ipodhan-scraper-wake-staging.log while the staging scraper was
// dead for six hours, because NOTHING read that file. So the load-bearing
// assertions are: a failing log exits non-zero (a caller can act), every printed
// line carries identities and not a bare count (R1), a `wake-skipped` is NOT
// treated as a failure (the lock working as designed), and the diff is real —
// GONE fires when the failures stop.
//
// The CLI is spawned end to end via --from-file / --state-dir (the
// failure-delta-cli.test.mjs pattern) so these cover main()'s exit branches, not
// just the pure helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWakeLog, groupByClass, keyOf, diff } from '../ops/wake-delta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'ops', 'wake-delta.mjs');
const FAILING = path.join(__dirname, 'fixtures', 'wake-delta-failing.log');
const CLEAN = path.join(__dirname, 'fixtures', 'wake-delta-clean.log');

function run(args) {
  try {
    return { code: 0, stdout: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, stdout: err.stdout?.toString() ?? '' };
  }
}

function withStateDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wake-delta-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parses the real wake-failed line shape and ignores wake-skipped/wake-complete', () => {
  const raw = [
    '2026-09-19T02:33:51Z scraper-wake: wake-failed: the cycle exited non-zero on its own (NOT the ceiling - the ceiling exits 124). elapsed=6s exit=1',
    '2026-09-19T03:03:51Z scraper-wake: wake-complete: the cycle finished cleanly well inside the ceiling. elapsed=246s ceiling=7200s',
    '2026-09-19T03:33:51Z scraper-wake: wake-skipped: job=data - a cycle is already running and holds the lock. lock_key=k lock_ttl=1800',
  ].join('\n');
  const { failures } = parseWakeLog(raw);
  assert.equal(failures.length, 1, 'only the wake-failed line is a failure');
  assert.equal(failures[0].exitCode, 1);
  assert.equal(failures[0].timestamp, '2026-09-19T02:33:51Z');
  assert.equal(failures[0].elapsedSeconds, 6);
});

test('a ceiling trip (exit=124) is a distinct class from a self-exit failure', () => {
  const raw = [
    '2026-09-19T02:33:51Z scraper-wake: wake-failed: blah exit=1',
    '2026-09-19T04:33:51Z scraper-wake: ceiling-tripped: the 2-hour hung-process ceiling fired. elapsed=7200s ceiling=7200s exit=124',
  ].join('\n');
  const map = groupByClass(parseWakeLog(raw).failures);
  assert.equal(map.size, 2, 'a crash and a ceiling trip must not be collapsed into one class');
  assert.ok(map.has('wake-failed::exit=1'));
  assert.ok(map.has('ceiling-tripped::exit=124'));
});

test('repeat occurrences of one class collapse to one entry carrying the count and the window', () => {
  const { failures } = parseWakeLog(
    [
      '2026-09-19T02:33:51Z scraper-wake: wake-failed: a exit=1',
      '2026-09-19T02:45:01Z scraper-wake: wake-failed: b exit=1',
      '2026-09-19T03:45:06Z scraper-wake: wake-failed: c exit=1',
    ].join('\n')
  );
  const entry = groupByClass(failures).get(keyOf(failures[0]));
  assert.equal(entry.occurrences, 3);
  assert.equal(entry.firstSeen, '2026-09-19T02:33:51Z');
  assert.equal(entry.lastSeen, '2026-09-19T03:45:06Z');
});

test('diff reports GONE once a class leaves the window', () => {
  const previous = { 'wake-failed::exit=1': { kind: 'wake-failed', exitCode: 1, lastSeen: 'x' } };
  const { NEW, GONE, SAME } = diff(new Map(), previous);
  assert.deepEqual(NEW, []);
  assert.deepEqual(GONE, ['wake-failed::exit=1']);
  assert.deepEqual(SAME, []);
});

test('CLI: the #793 log (18 dead cycles in spirit) exits 3 UNTRACKED and prints identities, not a bare count', () => {
  withStateDir((stateDir) => {
    const r = run(['--slot', 'staging', '--from-file', FAILING, '--state-dir', stateDir]);
    assert.equal(r.code, 3, 'an untracked wake failure must exit non-zero so a caller can act');
    assert.match(r.stdout, /UNTRACKED/);
    // R1: the line resolves to identities — when it started, when it last
    // happened, how many, and the exit code — never just "3 failures".
    assert.match(r.stdout, /wake-failed \| exit=1 \| x3 \| first=2026-09-19T02:33:51Z \| last=2026-09-19T03:45:06Z/);
  });
});

test('CLI: a clean log exits 0 and says so', () => {
  withStateDir((stateDir) => {
    const r = run(['--slot', 'staging', '--from-file', CLEAN, '--state-dir', stateDir]);
    assert.equal(r.code, 0, 'a log with only wake-complete/wake-skipped is not a failure');
    assert.match(r.stdout, /NEW=0 GONE=0 SAME=0/);
    assert.match(r.stdout, /no wake failures/);
  });
});

test('CLI: --track clears the tick, and the number persists to the next run without repeating it', () => {
  withStateDir((stateDir) => {
    const first = run(['--slot', 'staging', '--from-file', FAILING, '--state-dir', stateDir, '--track', 'wake-failed::exit=1=793']);
    assert.equal(first.code, 0, 'a tracked class must not block the tick');
    assert.match(first.stdout, /TRACKED #793/);

    const second = run(['--slot', 'staging', '--from-file', FAILING, '--state-dir', stateDir]);
    assert.equal(second.code, 0, 'the issue number must carry forward in state');
    assert.match(second.stdout, /SAME\s+.*TRACKED #793/);
  });
});

test('CLI: state makes the second run a diff — the same failures report SAME, then GONE when they stop', () => {
  withStateDir((stateDir) => {
    run(['--slot', 'staging', '--from-file', FAILING, '--state-dir', stateDir, '--track', 'wake-failed::exit=1=793']);
    const gone = run(['--slot', 'staging', '--from-file', CLEAN, '--state-dir', stateDir]);
    assert.equal(gone.code, 0);
    assert.match(gone.stdout, /NEW=0 GONE=1 SAME=0/);
    assert.match(gone.stdout, /GONE\s+wake-failed \| exit=1/);
  });
});

test('CLI: a bad --slot exits 2 rather than reading nothing and reporting clean', () => {
  const r = run(['--slot', 'nosuchslot']);
  assert.equal(r.code, 2);
});
