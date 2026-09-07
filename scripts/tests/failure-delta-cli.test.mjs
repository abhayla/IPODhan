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
