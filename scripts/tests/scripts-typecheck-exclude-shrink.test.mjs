// Fix round 3, MEDIUM-1 (issue #434): scraper/tsconfig.scripts.json's `exclude`
// array was a plain, unguarded list — nothing stopped a new broken script
// from being silently added to it, hiding it from `npm run type-check:scripts`
// forever. This mirrors the shrink-only model of config/write-ratchet-baseline.json
// (T-316) and scripts/tests/fixture-provenance-baseline-shrink.test.mjs (T-518):
// the committed baseline (config/scripts-typecheck-exclude-baseline.json) is the
// only legitimate source of exclusions, and it can only shrink.
//
// Two failure modes are guarded, both exercised with synthetic data first so a
// weakened guard turns this red before it can silently stop enforcing anything:
//   1. tsconfig excludes a scripts/*.ts path not present in the baseline
//      (a hand-added exclusion smuggled past the baseline).
//   2. the live exclude count exceeds the committed baseline count
//      (checkExcludeCountRatchet, same shape as require-fixture-provenance.mjs's
//      checkSkipRatchet: ok = current <= recorded).
//
// A trailing integration test reads the real files and asserts the repo is
// currently clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TSCONFIG_PATH = join(ROOT, 'scraper', 'tsconfig.scripts.json');
const BASELINE_PATH = join(ROOT, 'config', 'scripts-typecheck-exclude-baseline.json');

// Non-script exclude entries that are legitimate structural exclusions, not
// per-script escape hatches, and therefore never checked against the baseline.
const STRUCTURAL_EXCLUDES = new Set(['node_modules', 'dist', 'tests']);

/** @returns {string[]} the scripts/*.ts entries in tsconfig's exclude array */
export function extractScriptExcludes(tsconfigExclude) {
  return tsconfigExclude
    .filter((entry) => entry.startsWith('scripts/'))
    .sort();
}

/**
 * @returns {{ newFiles: string[] }} tsconfig exclude entries not present in
 *   the committed baseline — a new exclusion smuggled in without --update.
 */
export function checkExcludeSubset(currentExcludes, baselineFiles) {
  const baselineSet = new Set(baselineFiles);
  const newFiles = currentExcludes.filter((f) => !baselineSet.has(f)).sort();
  return { ok: newFiles.length === 0, newFiles };
}

/** Same shape as require-fixture-provenance.mjs's checkSkipRatchet. */
export function checkExcludeCountRatchet(recorded, current) {
  return { ok: current <= recorded, recorded, current };
}

test('checkExcludeSubset: every current entry present in baseline passes', () => {
  const result = checkExcludeSubset(['scripts/a.ts', 'scripts/b.ts'], ['scripts/a.ts', 'scripts/b.ts', 'scripts/c.ts']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.newFiles, []);
});

test('checkExcludeSubset: a NEW tsconfig exclude not in the baseline FAILs, named', () => {
  const result = checkExcludeSubset(['scripts/a.ts', 'scripts/smuggled.ts'], ['scripts/a.ts']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.newFiles, ['scripts/smuggled.ts']);
});

test('checkExcludeCountRatchet: same or shrunk count passes', () => {
  assert.equal(checkExcludeCountRatchet(23, 23).ok, true);
  assert.equal(checkExcludeCountRatchet(23, 20).ok, true);
});

test('checkExcludeCountRatchet: a grown count FAILs, naming both numbers', () => {
  const result = checkExcludeCountRatchet(23, 24);
  assert.equal(result.ok, false);
  assert.equal(result.recorded, 23);
  assert.equal(result.current, 24);
});

test('integration: the real tsconfig.scripts.json exclude list matches the committed baseline exactly', () => {
  const tsconfig = JSON.parse(readFileSync(TSCONFIG_PATH, 'utf8'));
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

  const nonStructural = tsconfig.exclude.filter((e) => !STRUCTURAL_EXCLUDES.has(e));
  const currentScriptExcludes = extractScriptExcludes(nonStructural);

  const subset = checkExcludeSubset(currentScriptExcludes, baseline.files);
  assert.equal(
    subset.ok,
    true,
    `New exclusion(s) not in ${BASELINE_PATH} baseline: ${subset.newFiles.join(', ')}. ` +
      'Fix the script or add it via a deliberate --update to the baseline, not a hand-edit of tsconfig.scripts.json.'
  );

  const ratchet = checkExcludeCountRatchet(baseline.count, currentScriptExcludes.length);
  assert.equal(
    ratchet.ok,
    true,
    `Exclude count grew (${ratchet.current} > committed ${ratchet.recorded}) without a baseline --update.`
  );

  assert.equal(baseline.files.length, baseline.count, 'baseline.count drifted from baseline.files.length');
});
