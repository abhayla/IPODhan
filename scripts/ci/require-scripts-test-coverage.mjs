#!/usr/bin/env node
/**
 * require-scripts-test-coverage — every scripts/tests/ (and scripts/ci/tests/)
 * test file is either RUN by some CI workflow or EXPLICITLY excluded with a
 * reason. Nothing may be silent.
 *
 * WHY THIS EXISTS (issues #616, #681, #1158).
 * `.github/workflows/pr-gate.yml` (and docs-gate.yml, secret-scan.yml) name
 * `scripts/tests/*.test.mjs|ts|sh` files ONE HAND-WRITTEN LINE AT A TIME —
 * unlike the scraper integration suite, these are not batched into one job's
 * run list; they are scattered one-or-two-per-step across dozens of jobs.
 * Nothing cross-checked those lines against the files on disk, so a new test
 * file could be written, pass locally, be merged, and never run once — a
 * green pr-gate saying nothing at all about it. #616 measured 28 of 51 such
 * files unwired; #681 found 23 more after a partial fix; #1158 found the
 * unwired `field-plan-slot.test.mjs` had gone red on `main` for an unrelated
 * PR and nothing noticed because nothing ran it.
 *
 * This closes the class: it enumerates every `*.test.{mjs,ts,sh}` file
 * directly under `scripts/tests/` and `scripts/ci/tests/`, PARSES every
 * `run:` step of every workflow under `.github/workflows/` for a reference to
 * that file (it does NOT keep a second copy of the list — that would be the
 * very drift it prevents), subtracts a committed exclusion file in which
 * every entry carries a checkable reason, and fails naming anything left.
 *
 * Exclusion kinds:
 *   "cannot-run-in-ci" — needs a database, the VPS, a live external site, or a
 *                        credential CI does not have. Reason required.
 *   "broken"           — cannot currently run/pass anywhere. Reason AND a
 *                        GitHub issue number required, so a broken test is
 *                        tracked as broken instead of hiding inside "excluded".
 *
 * Deliberately builtins-only import (T-570 registry class): this file is
 * imported by a pre-`npm ci` step, before node_modules exists.
 *
 * Usage:  node scripts/ci/require-scripts-test-coverage.mjs [--root <dir>]
 * Exit 0 = every file classified. Exit 1 = a file is in neither list, or the
 * exclusion file itself is malformed/stale.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIRS = ['scripts/tests', 'scripts/ci/tests'];
const WORKFLOWS_DIR = join('.github', 'workflows');
const EXCLUSIONS = 'scripts/ci/scripts-test-exclusions.json';
const MIN_REASON_LENGTH = 30;
const KINDS = new Set(['cannot-run-in-ci', 'broken']);
const TEST_FILE_RE = /\.test\.(mjs|ts|sh)$/;
// Anchored both ends so a reference names ONE file exactly: without the
// lookbehind `myscripts/tests/x.test.mjs` or `.scripts/tests/...` would count,
// and without the lookahead `foo.test.mjs.bak` / `foo.test.mjsx` would satisfy
// `foo.test.mjs` (round-1 review finding, #616). A trailing sentence period is
// still allowed; `.` followed by a word character is not.
export const REF_RE = /(?<![\w.])scripts\/(?:tests|ci\/tests)\/[A-Za-z0-9._/-]+?\.test\.(?:mjs|ts|sh)(?!\w|\.\w)/g;

/**
 * Every `*.test.{mjs,ts,sh}` file directly under scripts/tests/ or
 * scripts/ci/tests/ — NOT recursive (fixtures/ and other subdirectories hold
 * fixture data, not test files this gate should classify).
 */
export function listScriptsTests(root, dirs = TEST_DIRS) {
  const out = [];
  for (const dir of dirs) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort()) {
      const full = join(base, entry);
      if (statSync(full).isDirectory()) continue;
      if (TEST_FILE_RE.test(entry)) {
        out.push(`${dir}/${entry}`);
      }
    }
  }
  return out;
}

export function listWorkflowFiles(root) {
  const base = join(root, WORKFLOWS_DIR);
  if (!existsSync(base)) throw new Error(`workflows directory not found: ${WORKFLOWS_DIR}`);
  return readdirSync(base)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => `${WORKFLOWS_DIR}/${f}`.split(sep).join('/'));
}

/**
 * The files actually referenced inside a `run:` step body across every
 * workflow file — comments stripped first, so a filename mentioned only in a
 * `#` comment never counts as covered. A `run:` step's body is every line
 * from the `run:` line itself through the next line indented no deeper than
 * it (same block-collection approach as require-integration-test-coverage.mjs,
 * generalized to every step in every job, not one named job).
 */
export function parseWiredFiles(root, workflowPaths) {
  const wired = new Set();
  for (const wfPath of workflowPaths) {
    const text = readFileSync(join(root, wfPath), 'utf8');
    const lines = text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1'));
    const indentOf = (l) => l.length - l.trimStart().length;
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*run:/.test(lines[i])) continue;
      const block = [lines[i]];
      const baseIndent = indentOf(lines[i]);
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        if (indentOf(lines[j]) <= baseIndent) break;
        block.push(lines[j]);
      }
      for (const l of block) {
        for (const m of l.matchAll(REF_RE)) wired.add(m[0]);
      }
    }
  }
  return wired;
}

export function readExclusions(root, exclusionsPath = EXCLUSIONS) {
  const full = join(root, exclusionsPath);
  if (!existsSync(full)) throw new Error(`exclusion file not found: ${exclusionsPath}`);
  const parsed = JSON.parse(readFileSync(full, 'utf8'));
  if (!Array.isArray(parsed?.exclusions)) {
    throw new Error(`${exclusionsPath} must contain an "exclusions" array`);
  }
  return parsed.exclusions;
}

/** Returns { problems, files, wired, exclusions, unclassified }; problems empty = pass. */
export function analyze({ root, exclusionsPath } = {}) {
  const files = listScriptsTests(root);
  const workflowPaths = listWorkflowFiles(root);
  const wired = parseWiredFiles(root, workflowPaths);
  const exclusions = readExclusions(root, exclusionsPath);
  const problems = [];
  const excludedFiles = new Set();

  for (const [i, e] of exclusions.entries()) {
    const where = `exclusion[${i}]${typeof e?.file === 'string' ? ` (${e.file})` : ''}`;
    const underKnownDir = typeof e?.file === 'string' && TEST_DIRS.some((d) => e.file.startsWith(`${d}/`));
    if (!underKnownDir) {
      problems.push(`${where}: "file" must be a path under scripts/tests/ or scripts/ci/tests/`);
      continue;
    }
    // No globs, no prefixes, no basenames: an exclusion names ONE file, exactly
    // as listScriptsTests reports it. This is what stops an exclusion list
    // from quietly swallowing files it was never reviewed against.
    if (/[*?[\]]/.test(e.file)) {
      problems.push(`${where}: wildcards are not allowed — name each file exactly`);
      continue;
    }
    if (!files.includes(e.file)) {
      problems.push(`${where}: no such test file (stale entry — delete it)`);
      continue;
    }
    if (excludedFiles.has(e.file)) problems.push(`${where}: listed twice`);
    if (!KINDS.has(e.kind)) {
      problems.push(`${where}: "kind" must be one of ${[...KINDS].join(' | ')}`);
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < MIN_REASON_LENGTH) {
      problems.push(
        `${where}: "reason" must be at least ${MIN_REASON_LENGTH} characters a reader can check`
      );
    }
    if (e.kind === 'broken' && !/^#\d+$/.test(String(e.issue ?? ''))) {
      problems.push(`${where}: kind "broken" requires a tracking issue like "#512"`);
    }
    if (wired.has(e.file)) {
      problems.push(`${where}: excluded AND wired into a workflow — pick one`);
    }
    excludedFiles.add(e.file);
  }

  const unclassified = files.filter((f) => !wired.has(f) && !excludedFiles.has(f));
  for (const f of unclassified) {
    problems.push(
      `${f} runs in NO CI workflow and is in no exclusion — add a \`run:\` step in ` +
        `.github/workflows/, or add an entry with a reason to ${EXCLUSIONS}`
    );
  }

  return { problems, files, wired: [...wired].sort(), exclusions, unclassified };
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = rootFlag !== -1 ? resolve(argv[rootFlag + 1]) : resolve(here, '..', '..');
  let result;
  try {
    result = analyze({ root });
  } catch (err) {
    console.error(`scripts-test coverage gate FAILED to run: ${err.message}`);
    return 1;
  }
  const { problems, files, wired, exclusions, unclassified } = result;

  console.log(`scripts/tests + scripts/ci/tests test files found: ${files.length}`);
  console.log(`  wired into a workflow: ${wired.length}`);
  console.log(`  explicitly excluded:   ${exclusions.length}`);
  for (const e of exclusions) {
    console.log(`    - ${e.file} [${e.kind}${e.issue ? ' ' + e.issue : ''}] ${e.reason}`);
  }
  console.log(`  unclassified:          ${unclassified.length}`);
  for (const f of unclassified) console.log(`    ? ${f}`);

  if (problems.length > 0) {
    console.error('\nscripts-test coverage gate FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\nA test file nothing runs is worse than no test: it reads as coverage ' +
        'on the PR page and proves nothing (issues #616, #681, #1158).'
    );
    return 1;
  }
  console.log('\nOK — every scripts/tests (+ scripts/ci/tests) file is run by CI or excluded with a reason.');
  return 0;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
