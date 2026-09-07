// T-499 — red-then-green tests for scripts/ops/morning-read-gate.mjs
// (SessionStart hook body). Run: node --test .claude/hooks/tests/morning-read-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  pickLatestTwo,
  computeFloorFiles,
  mergeFloorIssues,
} from '../../../scripts/ops/morning-read-gate.mjs';

test('pickLatestTwo returns the two latest dates in [older, newer] order', () => {
  assert.deepEqual(pickLatestTwo(['2026-09-05', '2026-09-07', '2026-09-06']), ['2026-09-06', '2026-09-07']);
});

test('pickLatestTwo dedupes and handles fewer than 2 dates', () => {
  assert.deepEqual(pickLatestTwo(['2026-09-07', '2026-09-07']), ['2026-09-07']);
  assert.deepEqual(pickLatestTwo([]), []);
});

test('computeFloorFiles prefers the VPS when it has 2+ nights, and caches locally', () => {
  const written = [];
  const runner = {
    listRemote: () => ['2026-09-06', '2026-09-07'],
    catRemote: (date) => `[FAIL] check-${date}  "entity"\n`,
    listLocal: () => {
      throw new Error('should not be called — remote had enough data');
    },
    readLocal: () => {
      throw new Error('should not be called');
    },
    writeLocal: (date, text) => written.push({ date, text }),
  };
  const result = computeFloorFiles(runner);
  assert.equal(result.source, 'vps');
  assert.equal(result.todayDate, '2026-09-07');
  assert.equal(result.yesterdayDate, '2026-09-06');
  assert.equal(written.length, 2);
});

test('computeFloorFiles falls back to the local cache when the VPS is unreachable', () => {
  const runner = {
    listRemote: () => {
      throw new Error('ssh: connect timed out');
    },
    catRemote: () => {
      throw new Error('should not be called');
    },
    listLocal: () => ['2026-09-05', '2026-09-06'],
    readLocal: (date) => `[PASS] check-${date}\n`,
    writeLocal: () => {},
  };
  const result = computeFloorFiles(runner);
  assert.equal(result.source, 'cache');
  assert.equal(result.todayDate, '2026-09-06');
  assert.equal(result.yesterdayDate, '2026-09-05');
});

test('computeFloorFiles reports "unavailable" with a reason when neither source has 2 nights', () => {
  const runner = {
    listRemote: () => {
      throw new Error('ssh: connection refused');
    },
    catRemote: () => {
      throw new Error('should not be called');
    },
    listLocal: () => ['2026-09-06'],
    readLocal: () => {
      throw new Error('should not be called');
    },
    writeLocal: () => {},
  };
  const result = computeFloorFiles(runner);
  assert.equal(result.source, 'unavailable');
  assert.match(result.reason, /fewer than 2 nights/);
});

test('computeFloorFiles falls back to cache when remote has fewer than 2 nights (not just on error)', () => {
  const runner = {
    listRemote: () => ['2026-09-07'],
    catRemote: () => {
      throw new Error('should not be called — only 1 remote night, caller must fall back');
    },
    listLocal: () => ['2026-09-05', '2026-09-06'],
    readLocal: (date) => `[PASS] check-${date}\n`,
    writeLocal: () => {},
  };
  const result = computeFloorFiles(runner);
  assert.equal(result.source, 'cache');
});

test('mergeFloorIssues creates the state file and records NEW ids with issue:null', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-'));
  const file = path.join(dir, 'floor-issues.json');
  try {
    const data = mergeFloorIssues(file, ['check-a', 'check-b'], '2026-09-07');
    assert.equal(data.entries.length, 2);
    assert.deepEqual(
      data.entries.map((e) => e.id).sort(),
      ['check-a', 'check-b'],
    );
    assert.ok(data.entries.every((e) => e.issue === null));
    assert.ok(existsSync(file));
    const onDisk = JSON.parse(readFileSync(file, 'utf-8'));
    assert.equal(onDisk.entries.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergeFloorIssues preserves an issue number already recorded for an id', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't499-'));
  const file = path.join(dir, 'floor-issues.json');
  try {
    mergeFloorIssues(file, ['check-a'], '2026-09-06');
    // owner files an issue for check-a between the two runs
    const midway = JSON.parse(readFileSync(file, 'utf-8'));
    midway.entries[0].issue = 410;
    writeFileSync(file, JSON.stringify(midway, null, 2));

    const data = mergeFloorIssues(file, ['check-a', 'check-c'], '2026-09-07');
    const a = data.entries.find((e) => e.id === 'check-a');
    const c = data.entries.find((e) => e.id === 'check-c');
    assert.equal(a.issue, 410, 'existing issue number must survive a re-merge');
    assert.equal(c.issue, null, 'a genuinely new id gets issue:null');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
