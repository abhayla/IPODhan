// #461: `node --test <glob>` exits 0 silently when the glob matches nothing
// (measured, Node v22.20.0) — a hollow gate. This tests the REAL predicates
// from scripts/ci/check-node-test-no-globs.mjs against fixtures AND the
// live .github/workflows/*.yml, so weakening the glob-char set or adding an
// unguarded glob to a workflow turns a test red.
//
//   node --test scripts/ci/tests/check-node-test-no-globs.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractNodeTestArgs,
  findGlobViolations,
  checkWorkflowsDir,
} from '../check-node-test-no-globs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('extractNodeTestArgs finds a single literal invocation', () => {
  const yml = '        run: node --test scripts/tests/foo.test.mjs\n';
  assert.deepEqual(extractNodeTestArgs(yml), ['scripts/tests/foo.test.mjs']);
});

test('extractNodeTestArgs finds multiple invocations across a multi-line `run: |` block', () => {
  const yml = [
    '        run: |',
    '          node --test scripts/tests/a.test.mjs',
    '          node --test scripts/tests/b.test.mjs',
  ].join('\n');
  assert.deepEqual(extractNodeTestArgs(yml), [
    'scripts/tests/a.test.mjs',
    'scripts/tests/b.test.mjs',
  ]);
});

test('extractNodeTestArgs returns [] when there is no node --test invocation', () => {
  assert.deepEqual(extractNodeTestArgs('run: npm run lint\n'), []);
});

// ---- The exact class #461 measured: a glob argument must be flagged ----

test('findGlobViolations flags a glob argument (the exact shape #461 warns about)', () => {
  const yml = '        run: node --test scripts/ci/tests/*.test.mjs\n';
  const violations = findGlobViolations(yml, 'fixture.yml');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].arg, 'scripts/ci/tests/*.test.mjs');
  assert.equal(violations[0].file, 'fixture.yml');
});

test('findGlobViolations flags brace and bracket globs too', () => {
  const yml = [
    'run: node --test scripts/tests/{a,b}.test.mjs',
    'run: node --test scripts/tests/[ab].test.mjs',
  ].join('\n');
  const violations = findGlobViolations(yml, 'fixture.yml');
  assert.equal(violations.length, 2);
});

test('findGlobViolations passes a literal path clean', () => {
  const yml = '        run: node --test scripts/tests/check-write-ratchet.test.mjs\n';
  assert.deepEqual(findGlobViolations(yml, 'fixture.yml'), []);
});

// ---- checkWorkflowsDir: red on a fixture dir with a glob, green without ----

test('checkWorkflowsDir returns a violation for a fixture workflow with a glob', () => {
  const dir = mkdtempSync(join(tmpdir(), 'node-test-glob-fixture-'));
  try {
    writeFileSync(join(dir, 'bad.yml'), 'run: node --test scripts/ci/tests/*.test.mjs\n');
    const violations = checkWorkflowsDir(dir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, 'bad.yml');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkWorkflowsDir returns no violations for a fixture workflow with only literal paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'node-test-glob-fixture-'));
  try {
    writeFileSync(join(dir, 'good.yml'), 'run: node --test scripts/tests/check-write-ratchet.test.mjs\n');
    assert.deepEqual(checkWorkflowsDir(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkWorkflowsDir returns [] for a missing directory (never throws)', () => {
  assert.deepEqual(checkWorkflowsDir(join(ROOT, 'no-such-dir-at-all')), []);
});

// ---- Live gate: the real .github/workflows must have zero glob-shaped node --test args ----

test('LIVE: every `node --test` argument in .github/workflows is a literal path', () => {
  const violations = checkWorkflowsDir(join(ROOT, '.github', 'workflows'));
  assert.deepEqual(
    violations,
    [],
    'a glob-shaped `node --test` argument in a real workflow can silently pass forever once it ' +
      'matches nothing (#461) — use a literal path or list literal paths explicitly'
  );
});
