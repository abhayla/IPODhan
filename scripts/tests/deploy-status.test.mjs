// Self-test for scripts/deploy-status.mjs (T-425) — the deploy-failure STATUS
// row that stays open on disk until a later deploy of the same slot succeeds.
// Exercises the real read/write functions against a throwaway file (never the
// shared state dir), so this never touches a real box's audit state.
// Run: node --test scripts/tests/deploy-status.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStatusMap, writeStatusMap } from '../deploy-status.mjs';
import { buildDeployFailureStatusRow, setDeployFailureStatus, clearDeployStatus } from '../lib/fix-served-checks.mjs';

const DEPLOY_STATUS_SCRIPT = fileURLToPath(new URL('../deploy-status.mjs', import.meta.url));

function withTempFile(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-status-test-'));
  const file = join(dir, 'deploy-failure-status.json');
  try { fn(file); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('reading a missing status file returns an empty map, not a crash', () => {
  withTempFile((file) => {
    assert.deepEqual(readStatusMap(file), {});
  });
});

test('set then read round-trips a deploy-failure row', () => {
  withTempFile((file) => {
    const row = buildDeployFailureStatusRow({ slot: 'prod', sha: 'abc123', runUrl: 'https://x/run/1', gateReason: 'FATAL: health probe failed', failedAt: '2026-09-02T00:00:00Z' });
    writeStatusMap(setDeployFailureStatus(readStatusMap(file), 'prod', row), file);
    const map = readStatusMap(file);
    assert.equal(map.prod.sha, 'abc123');
    assert.match(map.prod.gateReason, /health probe/);
  });
});

test('a later successful deploy CLEARS the row for that slot and leaves siblings open', () => {
  withTempFile((file) => {
    const prodRow = buildDeployFailureStatusRow({ slot: 'prod', sha: 'p1', runUrl: 'u', gateReason: 'g', failedAt: '2026-09-01T00:00:00Z' });
    const stagingRow = buildDeployFailureStatusRow({ slot: 'staging', sha: 's1', runUrl: 'u', gateReason: 'g', failedAt: '2026-09-01T00:00:00Z' });
    let map = setDeployFailureStatus(readStatusMap(file), 'prod', prodRow);
    map = setDeployFailureStatus(map, 'staging', stagingRow);
    writeStatusMap(map, file);

    // prod deploys successfully -> its row clears; staging's stays open.
    writeStatusMap(clearDeployStatus(readStatusMap(file), 'prod'), file);
    const after = readStatusMap(file);
    assert.equal(after.prod, undefined, 'prod failure must be cleared by its own successful deploy');
    assert.equal(after.staging.sha, 's1', 'staging failure must stay open — a different slot deployed, not staging');
  });
});

test('clearing a slot that was never open is a harmless no-op', () => {
  withTempFile((file) => {
    writeStatusMap(clearDeployStatus(readStatusMap(file), 'prod'), file);
    assert.deepEqual(readStatusMap(file), {});
  });
});

// --- fail-open on a write error (T-425 blocker) -----------------------------
// The workflow's "Clear deploy-failure STATUS" step must never fail a
// successful deploy just because this side-record couldn't be written. Force
// a real write error (mkdirSync fails because the "directory" segment is
// actually a file) and assert the CLI process itself still exits 0, with a
// stderr note — belt-and-braces alongside the `|| echo ... non-fatal` guard
// in deploy-linux.yml.
test('CLI exits 0 with a stderr WARNING when the status file cannot be written (unwritable dir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-status-unwritable-'));
  try {
    const blockerFile = join(dir, 'not-a-directory');
    writeFileSync(blockerFile, 'this is a file, not a directory');
    // The state "directory" path is itself a file, so mkdirSync(recursive) on
    // any path nested under it throws ENOTDIR - a real, reproducible write error.
    const unwritableStatusFile = join(blockerFile, 'nested', 'deploy-failure-status.json');

    const result = spawnSync(process.execPath, [
      DEPLOY_STATUS_SCRIPT, 'set',
      '--slot', 'prod', '--sha', 'abc123', '--run-url', 'https://x/run/1', '--reason', 'FATAL: test',
    ], {
      env: { ...process.env, DEPLOY_STATUS_FILE: unwritableStatusFile },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `expected exit 0 (fail-open), got ${result.status}. stderr: ${result.stderr}`);
    assert.match(result.stderr, /WARNING/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
