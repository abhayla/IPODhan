#!/usr/bin/env node
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
 * Class: every fixture data file under scraper/tests/fixtures/** and
 * scraper/tests/unit/pipeline-stages/fixtures/**, existing and future, every
 * source site. See scripts/lib/fixture-provenance-checks.mjs for the full
 * class statement and the provenance convention, and
 * scraper/tests/fixtures/PROVENANCE.md for the human-readable doc.
 *
 * For each fixture data file:
 *   1. it must have a sibling `<file>.meta.json` with sourceUrl + capturedAt,
 *      and either "company" or "pageType": true;
 *   2. an HTML fixture that claims a company (per the filename) and whose
 *      page has an extractable <title>/<h1> must have that page's own
 *      embedded company name MATCH the filename's claim.
 *
 * A file that fails either check is allowed to pass ONLY if it is listed in
 * the shrink-only backfill allowlist (config/fixture-provenance-baseline.json,
 * exactly like config/write-ratchet-baseline.json — T-316): an entry may be
 * REMOVED once the fixture gains provenance; a NEW entry can never be added
 * (checked by scripts/tests/fixture-provenance-baseline-shrink.test.mjs and
 * refused here with --update unless the candidate baseline is a subset of
 * the current one, or --update-force is passed for a deliberate widen with
 * owner sign-off recorded in the commit message).
 *
 * Usage:
 *   node scripts/ci/require-fixture-provenance.mjs [--root <dir>]
 *   node scripts/ci/require-fixture-provenance.mjs --root <dir> --update
 *
 * Exit codes: 0 = every fixture has provenance (or is grandfathered by the
 * baseline); 1 = a NEW violation exists that the baseline does not cover.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findFixtureFiles,
  checkFixture,
  baselineIsShrinkOnly,
} from '../lib/fixture-provenance-checks.mjs';
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

function loadBaseline(root) {
  const p = join(root, BASELINE_PATH_REL);
  if (!existsSync(p)) return { files: [] };
  return JSON.parse(readFileSync(p, 'utf8'));
}

function main() {
  const { root, update } = parseArgs(process.argv.slice(2));
  const baselinePath = join(root, BASELINE_PATH_REL);
  const baseline = loadBaseline(root);
  const baselineSet = new Set(baseline.files || []);

  const fixtures = findFixtureFiles(root);
  const failing = [];
  const nowClean = [];

  for (const f of fixtures) {
    const result = checkFixture(root, f, normalizeCompanyNameForMatching);
    if (result.status === 'fail') {
      failing.push({ file: f, reasons: result.reasons });
    } else if (baselineSet.has(f)) {
      nowClean.push(f);
    }
  }

  if (update) {
    const newFiles = failing.map((f) => f.file).sort();
    const baselineExisted = existsSync(baselinePath);
    // A fresh baseline (file does not exist yet) is the one-time day-1
    // backfill this gate exists to enable — not a "widen" of an existing
    // shrink-only allowlist. Every --update AFTER that first write is held
    // to baselineIsShrinkOnly against whatever is currently committed.
    const check = baselineExisted
      ? baselineIsShrinkOnly(baseline.files || [], newFiles)
      : { ok: true, added: [] };
    if (!check.ok) {
      console.error(
        `--update refused: this would ADD ${check.added.length} new baseline entr${check.added.length === 1 ? 'y' : 'ies'} ` +
          `(shrink-only — see scraper/tests/fixtures/PROVENANCE.md):\n  ${check.added.join('\n  ')}`
      );
      process.exit(1);
    }
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          _comment:
            'Fixture-provenance backfill allowlist (T-518). Shrink-only: an entry may be REMOVED once the fixture gains a valid <file>.meta.json (and, for HTML, a matching identity), but a NEW entry can NEVER be added — route a new fixture through scripts/create-fixture-from-capture.mjs instead of grandfathering it here. Regenerate with `node scripts/ci/require-fixture-provenance.mjs --update` only when REMOVING entries.',
          generated_by: 'scripts/ci/require-fixture-provenance.mjs --update',
          count: newFiles.length,
          files: newFiles,
        },
        null,
        2
      ) + '\n'
    );
    console.log(`Baseline updated: ${newFiles.length} entries (was ${(baseline.files || []).length}).`);
    if (nowClean.length > 0) {
      console.log(`Dropped (now have valid provenance): ${nowClean.join(', ')}`);
    }
    process.exit(0);
  }

  const newViolations = failing.filter((f) => !baselineSet.has(f.file));
  const grandfathered = failing.filter((f) => baselineSet.has(f.file));

  if (grandfathered.length > 0) {
    console.log(
      `${grandfathered.length} fixture(s) still lack provenance but are grandfathered by ${BASELINE_PATH_REL} (backfill owed, not blocking):`
    );
    for (const f of grandfathered) console.log(`  - ${f.file}`);
  }

  if (newViolations.length > 0) {
    console.error(
      `\nFAIL: ${newViolations.length} fixture(s) violate the provenance gate and are NOT in the shrink-only baseline.\n` +
        `See scraper/tests/fixtures/PROVENANCE.md for the required <file>.meta.json shape,\n` +
        `or run scripts/create-fixture-from-capture.mjs to create a fixture WITH provenance in one step.\n`
    );
    for (const f of newViolations) {
      console.error(`  ${f.file}`);
      for (const r of f.reasons) console.error(`    - ${r}`);
    }
    process.exit(1);
  }

  console.log(`OK: ${fixtures.length} fixture(s) scanned, 0 new provenance violations.`);
  process.exit(0);
}

main();
