// T-487: the committed docs/reviews/detection-checks.json and the generated
// table in docs/reviews/failure-classes.md are build products of the
// per-entry files under docs/reviews/detection-checks/ and
// docs/reviews/failure-classes/. This test drives the real generator's
// `--check` mode as a subprocess (mutation-proof: a generator bug that
// silently drops or reorders an entry turns this red, not a re-implementation
// of the generator's own logic), and proves --check actually fails on real
// drift by introducing a temporary mismatch and restoring it afterward.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const GENERATOR = join(REPO_ROOT, 'scripts', 'build-detection-registry.mjs');
const AGGREGATE = join(REPO_ROOT, 'docs', 'reviews', 'detection-checks.json');

function runCheck() {
  try {
    const out = execFileSync('node', [GENERATOR, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('build-detection-registry --check passes against the committed aggregates', () => {
  const result = runCheck();
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PASS/);
});

test('build-detection-registry --check fails when the committed aggregate drifts from source files', () => {
  const original = readFileSync(AGGREGATE, 'utf8');
  try {
    writeFileSync(AGGREGATE, original.replace('"checks": [', '"checks": [\n  ], "drift-proof-marker": ['), 'utf8');
    const result = runCheck();
    assert.equal(result.code, 1, 'expected --check to fail on a drifted aggregate');
    assert.match(result.out, /FAIL/);
  } finally {
    writeFileSync(AGGREGATE, original, 'utf8');
  }
});

test('build-detection-registry rejects a duplicate id across sections/files', () => {
  const dupPath = join(REPO_ROOT, 'docs', 'reviews', 'detection-checks', '__dup_test.json');
  writeFileSync(
    dupPath,
    JSON.stringify({ id: 'a_b_live_conflict', section: 'notCoveredByThisManifest', note: 'duplicate id test' }, null, 2) + '\n',
    'utf8'
  );
  try {
    const result = runCheck();
    assert.notEqual(result.code, 0, 'expected the generator to fail on a duplicate id');
    assert.match(result.out, /duplicate/i);
  } finally {
    rmSync(dupPath);
  }
});
