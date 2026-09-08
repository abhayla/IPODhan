#!/usr/bin/env node
// detection-check: fixture_provenance
/**
 * T-518 fixture provenance gate.
 *
 * RCA: PR #425 shipped
 * scraper/tests/fixtures/historical/vikran-engineering-cg-detail.html whose
 * own <title> read "Neochem Bio IPO..." — a captured page for a DIFFERENT
 * company than the filename claimed — and a test asserting
 * "Vikran Engineering -> Specialty Chemicals" against it PASSED. Nothing in
 * CI could catch it; a human caught it by opening the file.
 *
 * Class: every fixture data file under scraper/tests/fixtures/**,
 * scraper/tests/unit/pipeline-stages/fixtures/**, and
 * web/tests/unit/pipeline-stages/fixtures/**, existing and future, every
 * source site. See scripts/lib/fixture-provenance-checks.mjs for the full
 * class statement and the provenance convention, and
 * scraper/tests/fixtures/PROVENANCE.md for the human-readable doc.
 *
 * For each fixture data file:
 *   1. it must have a sibling `<file>.meta.json` with sourceUrl + capturedAt,
 *      and either "company" or "pageType": true;
 *   2. an HTML fixture that is not `pageType: true` and whose page has an
 *      extractable <title>/<h1> must have that page's own embedded company
 *      name MATCH BOTH meta.company (primary claim) and, when the filename
 *      itself claims a company, the filename (secondary claim) — round 2
 *      review, MAJOR 5: comparing only the filename let a WRONG meta.company
 *      pass silently.
 *
 * A file that fails either check is allowed to pass ONLY if it is listed in
 * the shrink-only backfill allowlist (config/fixture-provenance-baseline.json)
 * — the file-set diff model MIRRORS scripts/check-write-ratchet.mjs (T-316)
 * exactly (round 2 review, MAJOR 3): `--update` writes the CURRENT set of
 * still-failing files as the baseline; a plain run FAILS on any found
 * violation not already in the baseline (NEW), AND on any baseline entry that
 * no longer fails (STALE — the fixture was fixed but the entry was never
 * removed, which is exactly the "stale entry becomes cover for a bad file
 * re-added at the same path" hole check-write-ratchet's own header warns
 * about). Tested by scripts/tests/fixture-provenance-baseline-shrink.test.mjs.
 *
 * Any fixture that skips the identity check (pageType:true, no extractable
 * title/h1, or a fixture type the check does not cover at all) is COUNTED
 * and printed in the summary — round 2 review, MAJOR 4: `pageType: true`
 * must never be a silent, uncounted escape hatch from the check this gate
 * exists to run.
 *
 * Usage:
 *   node scripts/ci/require-fixture-provenance.mjs [--root <dir>]
 *   node scripts/ci/require-fixture-provenance.mjs --root <dir> --update
 *
 * Exit codes: 0 = every fixture has provenance (or is grandfathered by the
 * baseline) and the baseline itself has no stale entries; 1 = a NEW
 * violation, or a STALE baseline entry, exists.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findFixtureFiles, checkFixture } from '../lib/fixture-provenance-checks.mjs';
import { normalizeCompanyNameForMatching } from '../lib/normalize-company-name.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, '..', '..');
const BASELINE_PATH_REL = join('config', 'fixture-provenance-baseline.json');

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, update: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--update') args.update = true;
  }
  return args;
}

export function loadBaseline(root) {
  const p = join(root, BASELINE_PATH_REL);
  if (!existsSync(p)) return { files: [] };
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Same shape/contract as check-write-ratchet.mjs's diffAgainstBaseline():
 * newFiles = a violation found that the baseline does not list;
 * staleFiles = a baseline entry that no longer fails (fixed but never
 * removed from the shrink-only allowlist — must be committed as a shrink).
 */
export function diffAgainstBaseline(failingFiles, baselineFiles) {
  const failingSet = new Set(failingFiles);
  const baselineSet = new Set(baselineFiles);
  const newFiles = failingFiles.filter((f) => !baselineSet.has(f)).sort();
  const staleFiles = baselineFiles.filter((f) => !failingSet.has(f)).sort();
  return { newFiles, staleFiles };
}

export function writeBaseline(baselinePath, failingFiles) {
  const files = [...failingFiles].sort();
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        _comment:
          'Fixture-provenance backfill allowlist (T-518). Shrink-only, same model as ' +
          'config/write-ratchet-baseline.json (T-316): a fixture that gains a valid ' +
          '<file>.meta.json (and, for HTML, a matching identity) becomes STALE here and ' +
          'must be removed via `node scripts/ci/require-fixture-provenance.mjs --update` ' +
          '(the gate FAILS on a stale entry, forcing the shrink to be committed rather than ' +
          'silently going stale). NEVER hand-add a new entry — route a new fixture through ' +
          'scripts/create-fixture-from-capture.mjs instead.',
        generated_by: 'scripts/ci/require-fixture-provenance.mjs --update',
        count: files.length,
        files,
      },
      null,
      2
    ) + '\n'
  );
  return files.length;
}

function main() {
  const { root, update } = parseArgs(process.argv.slice(2));
  const baselinePath = join(root, BASELINE_PATH_REL);
  const baseline = loadBaseline(root);
  const baselineFiles = baseline.files || [];
  const baselineSet = new Set(baselineFiles);

  const fixtures = findFixtureFiles(root);
  const failing = [];
  const skipTally = new Map();
  let identityCheckedCount = 0;

  for (const f of fixtures) {
    const result = checkFixture(root, f, normalizeCompanyNameForMatching);
    if (result.status === 'fail') failing.push({ file: f, reasons: result.reasons });
    if (result.identityChecked) identityCheckedCount++;
    if (result.identitySkipReason) {
      skipTally.set(result.identitySkipReason, (skipTally.get(result.identitySkipReason) || 0) + 1);
    }
  }

  const failingFiles = failing.map((f) => f.file);

  if (update) {
    const count = writeBaseline(baselinePath, failingFiles);
    console.log(`Baseline regenerated: ${count} entries (was ${baselineFiles.length}).`);
    process.exit(0);
  }

  const { newFiles, staleFiles } = diffAgainstBaseline(failingFiles, baselineFiles);
  const grandfathered = failing.filter((f) => baselineSet.has(f.file));

  console.log(
    `Identity check: ${identityCheckedCount}/${fixtures.length} fixture(s) checked; ` +
      `${fixtures.length - identityCheckedCount} skipped:`
  );
  for (const [reason, count] of [...skipTally.entries()].sort()) {
    console.log(`  ${count}x — ${reason}`);
  }

  if (grandfathered.length > 0) {
    console.log(
      `\n${grandfathered.length} fixture(s) still lack provenance but are grandfathered by ${BASELINE_PATH_REL} (backfill owed, not blocking):`
    );
    for (const f of grandfathered) console.log(`  - ${f.file}`);
  }

  let hasFailure = false;

  if (newFiles.length > 0) {
    hasFailure = true;
    console.error(
      `\nFAIL: ${newFiles.length} fixture(s) violate the provenance gate and are NOT in the shrink-only baseline.\n` +
        `See scraper/tests/fixtures/PROVENANCE.md for the required <file>.meta.json shape,\n` +
        `or run scripts/create-fixture-from-capture.mjs to create a fixture WITH provenance in one step.\n`
    );
    for (const file of newFiles) {
      console.error(`  ${file}`);
      for (const r of failing.find((f) => f.file === file).reasons) console.error(`    - ${r}`);
    }
  }

  if (staleFiles.length > 0) {
    hasFailure = true;
    console.error(
      `\nFAIL: ${staleFiles.length} baseline entr${staleFiles.length === 1 ? 'y is' : 'ies are'} STALE ` +
        `(the fixture now passes but is still grandfathered — the ratchet only shrinks, and a shrink must be committed):`
    );
    for (const f of staleFiles) console.error(`  STALE: ${f}`);
    console.error(
      '\nRun `node scripts/ci/require-fixture-provenance.mjs --update` and commit the regenerated ' +
        `${BASELINE_PATH_REL}.`
    );
  }

  if (hasFailure) process.exit(1);

  console.log(`\nOK: ${fixtures.length} fixture(s) scanned, 0 new provenance violations, 0 stale baseline entries.`);
  process.exit(0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
