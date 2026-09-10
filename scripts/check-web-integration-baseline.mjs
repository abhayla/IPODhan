#!/usr/bin/env node
/**
 * Web integration-suite shrink-only baseline gate (item 1 slice s3d).
 *
 * Owner decision 2026-09-10 (lane A session): baseline the currently-failing
 * web integration test FILES by name, gate web-touching slices on no NEW
 * failure, schedule the fixes as lane A slices by error class, and the
 * release cut requires the baseline empty.
 *
 * Same shrink-only model as config/write-ratchet-baseline.json (T-316) and
 * config/scripts-typecheck-exclude-baseline.json (#434):
 *   - a failing file NOT in the baseline -> FAIL (exit 1), named. This is a
 *     NEW regression and must block the merge, never be silently absorbed.
 *   - a baseline entry that is NOT failing anymore -> FAIL (exit 1) until the
 *     baseline is regenerated with --update and the shrink is committed. A
 *     stale entry is worse than no entry: it is unused cover that could hide
 *     a DIFFERENT new failure in the same file (the write-ratchet's per-file
 *     pattern-set lesson applies here at the per-file granularity).
 *
 * The input is a vitest `--reporter=json` report (Jest-compatible shape:
 * `{ testResults: [{ name: <absolute path>, status: 'passed'|'failed', ... }] }`),
 * NEVER console/log text — vitest's default reporter output has no reliable
 * per-file FAIL/PASS marker in `gh run view --log-failed` (every mentioned
 * file, passing or failing, is prefixed `❯`), so a grep-based derivation
 * would silently baseline passing files as allowed-to-fail.
 *
 * Usage:
 *   node scripts/check-web-integration-baseline.mjs --report=<path-to-json>
 *   node scripts/check-web-integration-baseline.mjs --report=<path-to-json> --update
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative, sep } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(__dirname, '..');
export const BASELINE_PATH = join(ROOT, 'config', 'web-integration-baseline.json');

function toPosix(p) {
  return p.split(sep).join('/');
}

/**
 * Normalizes a vitest JSON report's `testResults[].name` (an absolute path,
 * typically under `web/tests/integration/`) to a repo-root-relative POSIX
 * path, matching the convention of config/write-ratchet-baseline.json and
 * config/scripts-typecheck-exclude-baseline.json (both store repo-relative
 * paths, not paths relative to a subpackage).
 * @param {string} absOrMixedPath
 * @param {string} root repo root to relativize against
 * @returns {string}
 */
export function normalizeFileName(absOrMixedPath, root = ROOT) {
  const posixPath = toPosix(absOrMixedPath);
  const posixRoot = toPosix(root);
  if (posixPath.startsWith(posixRoot)) {
    return toPosix(relative(root, absOrMixedPath)).replace(/^\/+/, '');
  }
  // Report generated on a different machine/runner (e.g. CI's $GITHUB_WORKSPACE)
  // — fall back to slicing at the first recognizable repo-relative anchor.
  const anchorIdx = posixPath.indexOf('web/tests/integration/');
  if (anchorIdx !== -1) return posixPath.slice(anchorIdx);
  return posixPath;
}

/**
 * Extracts the set of failing test-file paths (repo-root-relative, POSIX)
 * from a parsed vitest/Jest-compatible JSON report.
 * @param {object} report parsed JSON report
 * @param {string} root repo root to relativize against
 * @returns {string[]} sorted, de-duplicated failing file paths
 */
export function extractFailingFiles(report, root = ROOT) {
  if (!report || !Array.isArray(report.testResults)) {
    throw new Error(
      'Malformed vitest JSON report: expected a top-level "testResults" array. ' +
        'Was this generated with --reporter=json?'
    );
  }
  const failing = new Set();
  for (const suite of report.testResults) {
    const isFailed =
      suite.status === 'failed' ||
      (typeof suite.numFailingTests === 'number' && suite.numFailingTests > 0);
    if (isFailed && suite.name) {
      failing.add(normalizeFileName(suite.name, root));
    }
  }
  return [...failing].sort();
}

function loadBaseline(baselinePath) {
  if (!existsSync(baselinePath)) {
    return { count: 0, files: [] };
  }
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

function writeBaseline(baselinePath, failingFiles, provenanceNote) {
  const existing = existsSync(baselinePath) ? loadBaseline(baselinePath) : {};
  const baseline = {
    _comment: existing._comment ?? '(see prior committed baseline for the full shrink-only rule)',
    generated_from: provenanceNote,
    count: failingFiles.length,
    files: [...failingFiles].sort(),
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  return baseline;
}

/**
 * Compares the live failing-file set against the baseline.
 * @param {string[]} failingFiles sorted, de-duplicated
 * @param {string[]} baselineFiles
 * @returns {{ newFailures: string[], staleEntries: string[] }}
 */
export function diffAgainstBaseline(failingFiles, baselineFiles) {
  const failingSet = new Set(failingFiles);
  const baselineSet = new Set(baselineFiles);
  const newFailures = [...failingSet].filter((f) => !baselineSet.has(f)).sort();
  const staleEntries = [...baselineSet].filter((f) => !failingSet.has(f)).sort();
  return { newFailures, staleEntries };
}

function parseArgs(argv) {
  const args = { update: false, report: null, baseline: BASELINE_PATH };
  for (const arg of argv) {
    if (arg === '--update') args.update = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--report=')) args.report = arg.slice('--report='.length);
    else if (arg.startsWith('--baseline=')) args.baseline = arg.slice('--baseline='.length);
  }
  return args;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/check-web-integration-baseline.mjs --report=<vitest-json-report> [--update] [--baseline=<path>]',
      '',
      '  --report=<path>   Path to a vitest `--reporter=json --outputFile=<path>` report.',
      '  --update          Regenerate the baseline from the report.',
      '                    Only ever run when REMOVING entries (a file no longer fails).',
      '  --baseline=<path> Override the baseline file path (default: config/web-integration-baseline.json).',
      '                    Test-only escape hatch — CI and local use always use the default.',
      '  --help            Show this message.',
      '',
      'Exit codes: 0 = baseline matches (or was updated); 1 = new failure or stale entry.',
    ].join('\n')
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  if (!args.report) {
    console.error('[web-integration-baseline] FAIL — missing required --report=<path> argument.');
    printHelp();
    return 1;
  }

  if (!existsSync(args.report)) {
    console.error(`[web-integration-baseline] FAIL — report file not found: ${args.report}`);
    return 1;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(args.report, 'utf8'));
  } catch (err) {
    console.error(`[web-integration-baseline] FAIL — could not parse report JSON: ${err.message}`);
    return 1;
  }

  const failingFiles = extractFailingFiles(report);

  if (args.update) {
    const baseline = writeBaseline(
      args.baseline,
      failingFiles,
      `scripts/check-web-integration-baseline.mjs --update against ${args.report}`
    );
    console.log(
      `[web-integration-baseline] baseline regenerated: ${baseline.count} failing file(s).`
    );
    return 0;
  }

  const baseline = loadBaseline(args.baseline);
  const { newFailures, staleEntries } = diffAgainstBaseline(failingFiles, baseline.files ?? []);

  if (newFailures.length === 0 && staleEntries.length === 0) {
    console.log(
      `[web-integration-baseline] PASS — ${failingFiles.length} failing file(s) match the ` +
        'committed baseline exactly.'
    );
    return 0;
  }

  if (newFailures.length > 0) {
    console.error(
      '[web-integration-baseline] FAIL — file(s) failing that are NOT in the baseline (a new regression):'
    );
    for (const f of newFailures) console.error(`  NEW: ${f}`);
    console.error(
      '\nFix the failure, or if genuinely a newly-discovered pre-existing failure, add it to ' +
        'config/web-integration-baseline.json with a named CI run as provenance — never to hide ' +
        'a regression this change introduced.'
    );
  }

  if (staleEntries.length > 0) {
    console.error(
      '[web-integration-baseline] FAIL — baseline entry no longer failing (the baseline only ' +
        'shrinks, and a shrink must be committed deliberately):'
    );
    for (const f of staleEntries) console.error(`  STALE: ${f}`);
    console.error(
      '\nRun `node scripts/check-web-integration-baseline.mjs --report=<path> --update` and ' +
        'commit the regenerated config/web-integration-baseline.json.'
    );
  }

  return 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  process.exit(main());
}
