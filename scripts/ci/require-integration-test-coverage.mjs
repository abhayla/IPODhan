#!/usr/bin/env node
/**
 * require-integration-test-coverage — every scraper integration test file is
 * either RUN by CI or EXPLICITLY excluded with a reason. Nothing may be silent.
 *
 * WHY THIS EXISTS (issue #507, recurring 2026-09-11).
 * `.github/workflows/pr-gate.yml`'s `scraper-document-integration` job names the
 * files it runs on ONE hand-maintained `run:` line. Nothing cross-checked that
 * line against the files on disk, so a new integration test could be added,
 * reviewed, merged and never execute once — a green pr-gate saying nothing at
 * all about it. That happened at least three times in a single evening (PR #556
 * added a seeded-database test that ran in no job; the s18 author, fixing that
 * same class, found their own file missing too). Each time it was fixed by
 * hand-editing the run line, which fixes the instance and nothing about the
 * class.
 *
 * This check closes the class: it enumerates the files, PARSES the workflow's
 * own run line (it does NOT keep a second copy of the list — that would be the
 * very drift it prevents), subtracts a committed exclusion file in which every
 * entry carries a reason a reader can check, and fails naming anything left
 * over.
 *
 * Exclusion kinds:
 *   "cannot-run-in-ci" — hits a live external site, needs the prod tunnel, or
 *                        needs a credential CI does not have. Reason required.
 *   "broken"           — cannot currently run ANYWHERE. Reason AND a GitHub
 *                        issue number required, so a broken test is tracked as
 *                        broken instead of hiding inside "excluded".
 *
 * Usage:  node scripts/ci/require-integration-test-coverage.mjs [--root <dir>]
 * Exit 0 = every file classified. Exit 1 = a file is in neither list, or the
 * exclusion file itself is malformed/stale.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const JOB_NAME = 'scraper-document-integration';
const TESTS_DIR = join('scraper', 'tests', 'integration');
const WORKFLOW = join('.github', 'workflows', 'pr-gate.yml');
const EXCLUSIONS = 'scripts/ci/integration-test-exclusions.json';
const MIN_REASON_LENGTH = 30;
const KINDS = new Set(['cannot-run-in-ci', 'broken']);

/**
 * Every `*.test.ts` under the integration tree — the real class, because
 * `vitest.integration.config.ts` includes `tests/integration/(**)/(*).test.ts`.
 * Keying on `*.integration.test.ts` alone would let a file slip through by
 * being named differently, and two files already are (oracle-parity.test.ts,
 * phase-1-e2e.test.ts).
 */
export function listIntegrationTests(root) {
  const base = join(root, TESTS_DIR);
  if (!existsSync(base)) throw new Error(`integration test directory not found: ${TESTS_DIR}`);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.test.ts')) {
        out.push(relative(join(root, 'scraper'), full).split(sep).join('/'));
      }
    }
  };
  walk(base);
  return out;
}

/**
 * The files the job actually runs, read out of the workflow itself.
 * Deliberately NOT a constant in this file: a second copy of the list is the
 * drift this check exists to prevent. Throws if the job or its vitest step
 * cannot be found, so renaming/removing either fails loudly instead of
 * silently declaring everything covered.
 */
export function parseWorkflowRunList(root, workflowPath = WORKFLOW) {
  const text = readFileSync(join(root, workflowPath), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === `  ${JOB_NAME}:`);
  if (start === -1) throw new Error(`job "${JOB_NAME}" not found in ${workflowPath}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // The command is a multi-line `run: >-` block (13 filenames on one line is
  // unreadable), so the whole block is collected, not just the line carrying
  // the vitest token: a `run:` line plus every following MORE-INDENTED line.
  // YAML comments are stripped first — a filename mentioned in a comment must
  // never read as "covered".
  const body = lines.slice(start, end).map((l) => l.replace(/(^|\s)#.*$/, '$1'));
  const indentOf = (l) => l.length - l.trimStart().length;
  const runLines = [];
  for (let i = 0; i < body.length; i++) {
    if (!/^\s*run:/.test(body[i])) continue;
    const block = [body[i]];
    const baseIndent = indentOf(body[i]);
    for (let j = i + 1; j < body.length; j++) {
      if (body[j].trim() === '') continue;
      if (indentOf(body[j]) <= baseIndent) break;
      block.push(body[j]);
    }
    if (block.some((l) => l.includes('vitest.integration.config.ts'))) runLines.push(...block);
  }
  if (runLines.length === 0) {
    throw new Error(`job "${JOB_NAME}" has no step running vitest.integration.config.ts`);
  }
  const files = new Set();
  for (const line of runLines) {
    for (const m of line.matchAll(/tests\/integration\/[A-Za-z0-9._/-]+\.test\.ts/g)) {
      files.add(m[0]);
    }
  }
  return [...files].sort();
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

/** Returns { problems, files, runList, exclusions, unclassified }; problems empty = pass. */
export function analyze({ root, workflowPath, exclusionsPath } = {}) {
  const files = listIntegrationTests(root);
  const runList = parseWorkflowRunList(root, workflowPath);
  const exclusions = readExclusions(root, exclusionsPath);
  const problems = [];
  const excludedFiles = new Set();

  for (const [i, e] of exclusions.entries()) {
    const where = `exclusion[${i}]${typeof e?.file === 'string' ? ` (${e.file})` : ''}`;
    if (typeof e?.file !== 'string' || !e.file.startsWith('tests/integration/')) {
      problems.push(`${where}: "file" must be a path under tests/integration/`);
      continue;
    }
    // No globs, no prefixes, no basenames: an exclusion names ONE file, exactly
    // as listIntegrationTests reports it. This is what stops an exclusion list
    // from quietly swallowing files it was never reviewed against.
    if (/[*?[\]]/.test(e.file)) {
      problems.push(`${where}: wildcards are not allowed — name each file exactly`);
      continue;
    }
    if (!files.includes(e.file)) {
      problems.push(`${where}: no such integration test file (stale entry — delete it)`);
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
    if (runList.includes(e.file)) {
      problems.push(`${where}: excluded AND in the job's run list — pick one`);
    }
    excludedFiles.add(e.file);
  }

  for (const f of runList) {
    if (!files.includes(f)) {
      problems.push(`the job's run list names "${f}", which does not exist on disk`);
    }
  }

  const unclassified = files.filter((f) => !runList.includes(f) && !excludedFiles.has(f));
  for (const f of unclassified) {
    problems.push(
      `${f} runs in NO CI job and is in no exclusion — add it to the ` +
        `${JOB_NAME} run list, or add an entry with a reason to ${EXCLUSIONS}`
    );
  }

  return { problems, files, runList, exclusions, unclassified };
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = rootFlag !== -1 ? resolve(argv[rootFlag + 1]) : resolve(here, '..', '..');
  let result;
  try {
    result = analyze({ root });
  } catch (err) {
    console.error(`integration-test coverage gate FAILED to run: ${err.message}`);
    return 1;
  }
  const { problems, files, runList, exclusions, unclassified } = result;

  console.log(`Integration test files found: ${files.length}`);
  console.log(`  run by ${JOB_NAME}: ${runList.length}`);
  for (const f of runList) console.log(`    + ${f}`);
  console.log(`  explicitly excluded:  ${exclusions.length}`);
  for (const e of exclusions) {
    console.log(`    - ${e.file} [${e.kind}${e.issue ? ' ' + e.issue : ''}] ${e.reason}`);
  }
  console.log(`  unclassified:         ${unclassified.length}`);
  for (const f of unclassified) console.log(`    ? ${f}`);

  if (problems.length > 0) {
    console.error('\nintegration-test coverage gate FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\nA test file nothing runs is worse than no test: it reads as coverage ' +
        'on the PR page and proves nothing (issue #507).'
    );
    return 1;
  }
  console.log('\nOK — every scraper integration test file is run by CI or excluded with a reason.');
  return 0;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
