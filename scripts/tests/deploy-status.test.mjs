// Self-test for scripts/deploy-status.mjs (T-425) — the deploy-failure STATUS
// row that stays open on disk until a later deploy of the same slot succeeds.
// Exercises the real read/write functions against a throwaway file (never the
// shared state dir), so this never touches a real box's audit state.
// Run: node --test scripts/tests/deploy-status.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStatusMap, writeStatusMap } from '../deploy-status.mjs';
import { buildDeployFailureStatusRow, setDeployFailureStatus, clearDeployStatus } from '../lib/fix-served-checks.mjs';

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
