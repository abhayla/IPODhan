#!/usr/bin/env node
// Live gate for scraper/config/field-manifest.json (item 3 slice S0b). Fails the build when the
// committed manifest does not match `node scripts/generate-field-manifest.mjs`'s output — the
// generator is the only writer (OD-5 §7.6); this is what makes that a rule CI enforces, not a
// convention a hand edit can quietly break. Also prints the resolved-plan diff against the PR's
// base sha so a reviewer reads "these N fields now resolve differently", never a raw JSON diff.
//
// Run: node scripts/ci/check-field-manifest-current.mjs [--base <sha>]

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR = join(ROOT, 'scripts', 'generate-field-manifest.mjs');

function parseArgs(argv) {
  const args = { base: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i];
  }
  return args;
}

function main() {
  const { base } = parseArgs(process.argv.slice(2));

  const checkResult = runNode(['--check']);
  if (checkResult.status !== 0) {
    console.error('field-manifest drift check FAILED — the committed file does not match the generator.');
    console.error(checkResult.output);
    console.error(
      '\nFix: node scripts/generate-field-manifest.mjs --write, then commit scraper/config/field-manifest.json.'
    );
    if (base) {
      console.error('\nResolved-plan diff vs base:');
      console.error(runNode(['--diff', base]).output);
    }
    process.exitCode = 1;
    return;
  }

  console.log('field-manifest.json matches the generator (no drift).');
  if (base) {
    console.log('\nResolved-plan diff vs base:');
    console.log(runNode(['--diff', base]).output);
  }
}

function runNode(args) {
  try {
    const output = execFileSync(process.execPath, [GENERATOR, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (err) {
    return { status: err.status ?? 1, output: (err.stdout || '') + (err.stderr || '') };
  }
}

main();
