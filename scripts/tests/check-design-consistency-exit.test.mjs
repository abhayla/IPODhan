// #659: docs/design/check-design-consistency.mjs used to exit 0 on a FAIL unless called
// with --gate. docs-gate.yml calls it with no flag, so a design inconsistency printed
// [FAIL] while the workflow step reported SUCCESS — a docs-only PR could ship a
// contradicted design undetected. This test drives the REAL script as a subprocess
// against the real design doc (mutation-proof: a re-implementation of the exit logic
// would not catch a regression in the actual file), injecting one guaranteed-FAIL
// mutation (a PROVISIONAL marker naming a fork row that does not exist, tripping check
// D14) and restoring the doc afterward.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'docs', 'design', 'check-design-consistency.mjs');
const DESIGN_DOC = join(REPO_ROOT, 'docs', 'design', 'data-sourcing-pull-model.md');

const DANGLING_MARKER = '\n\nPROVISIONAL on O-999 (test-injected dangling marker — scripts/tests/check-design-consistency-exit.test.mjs).\n';

function run(args) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function withInjectedFail(fn) {
  const original = readFileSync(DESIGN_DOC, 'utf8');
  try {
    writeFileSync(DESIGN_DOC, original + DANGLING_MARKER, 'utf8');
    fn();
  } finally {
    writeFileSync(DESIGN_DOC, original, 'utf8');
  }
}

test('positive control: the real design doc is consistent with no flag (exit 0)', () => {
  const result = run([]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /consistent\.$/m);
});

test('#659 red case: a real FAIL with NO flag must exit non-zero (fails today\'s pre-fix behaviour)', () => {
  withInjectedFail(() => {
    const result = run([]);
    assert.match(result.out, /\[FAIL\] D14/, 'expected the injected dangling marker to trip D14');
    assert.equal(result.code, 1, 'no-flag run on a real FAIL must exit non-zero (this is the #659 defect: it used to exit 0)');
  });
});

test('#659: --gate on a FAIL exits 1 (unchanged contract, pr-gate.yml relies on this)', () => {
  withInjectedFail(() => {
    const result = run(['--gate']);
    assert.match(result.out, /\[FAIL\] D14/);
    assert.equal(result.code, 1);
  });
});

test('#659: --report-only on a FAIL exits 0 and still prints the [FAIL] line', () => {
  withInjectedFail(() => {
    const result = run(['--report-only']);
    assert.match(result.out, /\[FAIL\] D14/);
    assert.equal(result.code, 0);
  });
});
