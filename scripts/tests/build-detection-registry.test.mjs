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

test('a notCoveredByThisManifest entry with no note derives one from retiredBy/retiredReason instead of writing null', () => {
  const dupPath = join(REPO_ROOT, 'docs', 'reviews', 'detection-checks', '__retired_no_note_test.json');
  const payload = JSON.stringify({
    id: '__retired_no_note_test',
    section: 'notCoveredByThisManifest',
    retiredBy: 'some_other_check',
    retiredReason: 'measured a population that can never move',
  }, null, 2) + String.fromCharCode(10);
  writeFileSync(dupPath, payload, 'utf8');
  try {
    execFileSync('node', [GENERATOR], { cwd: REPO_ROOT, encoding: 'utf8' });
    const aggregate = JSON.parse(readFileSync(AGGREGATE, 'utf8'));
    const note = aggregate.notCoveredByThisManifest.find(
      (n) => typeof n === 'string' && n.includes('some_other_check') && n.includes('measured a population that can never move')
    );
    assert.ok(note, `expected a derived non-null note mentioning retiredBy/retiredReason, got: ${JSON.stringify(aggregate.notCoveredByThisManifest)}`);
    assert.ok(!aggregate.notCoveredByThisManifest.includes(null), 'aggregate must never contain a null note');
  } finally {
    rmSync(dupPath);
    execFileSync('node', [GENERATOR], { cwd: REPO_ROOT, encoding: 'utf8' });
  }
});

test('a notCoveredByThisManifest entry with no derivable text makes the build throw naming the id', () => {
  const dupPath = join(REPO_ROOT, 'docs', 'reviews', 'detection-checks', '__no_note_no_fallback_test.json');
  const payload = JSON.stringify({ id: '__no_note_no_fallback_test_bare', section: 'notCoveredByThisManifest' }, null, 2) + String.fromCharCode(10);
  writeFileSync(dupPath, payload, 'utf8');
  try {
    let threw = null;
    try {
      execFileSync('node', [GENERATOR], { cwd: REPO_ROOT, encoding: 'utf8' });
    } catch (e) {
      threw = (e.stdout || '') + (e.stderr || '');
    }
    assert.ok(threw, 'expected the generator to throw, not silently write a null note');
    assert.match(threw, /__no_note_no_fallback_test_bare/);
  } finally {
    rmSync(dupPath);
    execFileSync('node', [GENERATOR], { cwd: REPO_ROOT, encoding: 'utf8' });
  }
});
