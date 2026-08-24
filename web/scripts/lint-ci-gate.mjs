#!/usr/bin/env node
/**
 * CI lint gate (issue #208).
 *
 * `web/package.json`'s `lint` script used to be bare `eslint` (no path), which
 * under ESLint's flat config matches ZERO files and exits 0 — the "Lint" step
 * in every CI workflow (ci.yml / pr-gate.yml / test.yml) had been reporting a
 * green pass that never linted a single file, silently disabling the
 * `no-restricted-imports` architectural guard (web-data-access.md) too.
 *
 * Fixing the script to `eslint .` alone would surface ~730 pre-existing errors
 * (mostly in UI components) and instantly red every future PR for unrelated
 * work — an overreaction for a P2 batch fix that is explicitly scoped away
 * from touching UI code. Instead this gate:
 *
 *   1. Fails LOUDLY if ESLint inspects 0 files (the actual #208 bug) — this
 *      can never silently regress again, regardless of the baseline below.
 *   2. Ratchets the pre-existing error count against a committed baseline
 *      (`.eslint-baseline-error-count.txt`), the same pattern this repo
 *      already uses for coverage (testing.md "Coverage Regression
 *      Prevention"): NEW errors beyond the baseline fail the gate; the
 *      baseline can only be lowered (never silently raised) as debt is paid
 *      down. Existing rules are NOT weakened or disabled anywhere.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const baselinePath = path.join(webRoot, '.eslint-baseline-error-count.txt');

function runEslintJson() {
  try {
    const out = execFileSync('npx', ['eslint', '.', '--format', 'json'], {
      cwd: webRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
    });
    return JSON.parse(out);
  } catch (err) {
    // ESLint exits 1 when it finds lint errors — that is expected here; the
    // JSON report is still on stdout. Only a missing stdout is a real failure.
    const stdout = err.stdout ? String(err.stdout) : '';
    if (!stdout.trim()) {
      console.error('FATAL: eslint produced no JSON output (crashed before reporting).');
      console.error(err.stderr ? String(err.stderr) : err.message);
      process.exit(1);
    }
    return JSON.parse(stdout);
  }
}

const results = runEslintJson();

if (!Array.isArray(results) || results.length === 0) {
  console.error(
    'FATAL: lint gate inspected 0 files (issue #208 regression) — this means ' +
      'ESLint is not matching any files under web/ and every rule, including ' +
      'the no-restricted-imports architectural guard, is silently disabled.'
  );
  process.exit(1);
}

const totalErrors = results.reduce((sum, f) => sum + f.errorCount, 0);
const totalWarnings = results.reduce((sum, f) => sum + f.warningCount, 0);

let baseline;
try {
  baseline = parseInt(readFileSync(baselinePath, 'utf8').trim(), 10);
  if (!Number.isFinite(baseline)) throw new Error('not a number');
} catch (err) {
  console.error(`FATAL: could not read/parse baseline file ${baselinePath}: ${err.message}`);
  process.exit(1);
}

console.log(
  `Lint gate: inspected ${results.length} files, ${totalErrors} errors / ${totalWarnings} warnings ` +
    `(baseline: ${baseline} errors).`
);

if (totalErrors > baseline) {
  console.error(
    `FAIL: ${totalErrors} lint errors exceed the baseline of ${baseline} — this PR introduced ` +
      `${totalErrors - baseline} new lint error(s). Fix them, or if the baseline itself was wrong, ` +
      `update ${path.relative(webRoot, baselinePath)} deliberately (never to silence a real new error).`
  );
  for (const f of results) {
    if (f.errorCount === 0) continue;
    console.error(`  ${path.relative(webRoot, f.filePath)}: ${f.errorCount} error(s)`);
  }
  process.exit(1);
}

if (totalErrors < baseline) {
  console.log(
    `NOTE: current error count (${totalErrors}) is BELOW the baseline (${baseline}) — ` +
      `consider lowering ${path.relative(webRoot, baselinePath)} to lock in the improvement.`
  );
}

console.log('Lint gate PASSED.');
