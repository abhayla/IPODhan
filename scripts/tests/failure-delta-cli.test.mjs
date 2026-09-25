// T-496 round 3: CLI-level regression guard. The unit tests on
// scripts/ops/lib/failure-tick-state.mjs cover the pure logic, but nothing previously
// went red if main()'s exit-3 branch in scripts/ops/failure-delta.mjs were deleted
// entirely — this spawns the real CLI end to end (no ssh, via --from-file) and asserts
// the actual process exit code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'ops', 'failure-delta.mjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'failure-delta-cli.log');
const FIXTURE_NEW_KEY = path.join(__dirname, 'fixtures', 'failure-delta-cli-newkey.log');
const FIXTURE_OLD_FAILURE = path.join(__dirname, 'fixtures', 'failure-delta-old-failure.log');
const FIXTURE_CLEAN_CYCLES_AFTER = path.join(__dirname, 'fixtures', 'failure-delta-clean-cycles-after.log');

function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout?.toString() ?? '' };
  }
}

test('CLI: an UNTRACKED failure exits 3, then --track on the same state dir exits 0 with TRACKED #402', () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'failure-delta-cli-'));
  try {
    const first = run(['--slot', 'staging', '--from-file', FIXTURE, '--state-dir', stateDir]);
    assert.equal(first.code, 3, 'first run must exit 3 (UNTRACKED failure present)');
    assert.match(first.stdout, /UNTRACKED/);

    const tracked = run(['--slot', 'staging', '--from-file', FIXTURE, '--state-dir', stateDir, '--track', 'persist-insert-failed=402']);
    assert.equal(tracked.code, 0, 'run with --track must exit 0 once the failure is tracked');
    assert.match(tracked.stdout, /TRACKED #402/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('T-502 (#413): a class --track on run 1 persists and covers a NEW key of that class on run 2, no --track repeated', () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'failure-delta-cli-'));
  try {
    const first = run(['--slot', 'staging', '--from-file', FIXTURE, '--state-dir', stateDir, '--track', 'persist-insert-failed=402']);
    assert.equal(first.code, 0, 'class-level --track must clear the tick');
    assert.match(first.stdout, /TRACKED #402/);

    // Run 2: a DIFFERENT ipoId, same errorClass, never seen before — no --track passed.
    const second = run(['--slot', 'staging', '--from-file', FIXTURE_NEW_KEY, '--state-dir', stateDir]);
    assert.equal(second.code, 0, 'the persisted class track must cover a key first seen on this run');
    assert.match(second.stdout, /NEW\s+.*TRACKED #402/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

// #429: failure-delta reported a failure as SAME long after it stopped
// because it scanned a fixed line window instead of bounding to the latest
// COMPLETE cycle. Run 1 establishes state with the old failure present (a
// single "Scraper execution completed" boundary — too few markers to bound,
// so the full window is used, matching a real first-ever tick). Run 2 reads
// a log with the SAME old failure line plus two MORE clean cycle boundaries
// after it — the failure must report GONE, not SAME.
test('CLI: a failure that does not recur in the latest complete cycle reports GONE, not SAME (#429)', () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'failure-delta-cli-'));
  try {
    const first = run(['--slot', 'staging', '--from-file', FIXTURE_OLD_FAILURE, '--state-dir', stateDir, '--track', 'persist-insert-failed=402']);
    assert.equal(first.code, 0, 'first run must exit 0 once tracked');
    assert.match(first.stdout, /NEW\s+.*persist-insert-failed.*TRACKED #402/);

    const second = run(['--slot', 'staging', '--from-file', FIXTURE_CLEAN_CYCLES_AFTER, '--state-dir', stateDir]);
    assert.equal(second.code, 0, 'second run must exit 0 — the failure is gone, nothing left untracked');
    assert.match(second.stdout, /GONE\s+.*persist-insert-failed/, 'must report GONE');
    assert.doesNotMatch(second.stdout, /SAME\s+.*persist-insert-failed/, 'must NOT report SAME — this is the #429 bug');
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
