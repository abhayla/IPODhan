#!/usr/bin/env node
/**
 * Mutation-guard sweep (#196, G-K).
 *
 * A green test suite is not evidence a guard is load-bearing — T-285 found
 * three shipped guards (deploy-linux.sh's served-sha probe, and two
 * assert-env-keys.sh checks) that could be neutralised to `if false` with
 * every existing test still passing. This script is the standing,
 * registry-driven version of that manual sweep: for each registered guard it
 * (1) hashes the file, (2) applies the mutation, asserting the pattern
 * matched EXACTLY ONCE, (3) runs the guard's own suite, (4) restores the
 * file from its exact prior bytes in a `finally` (so an interrupted sweep
 * never leaves a neutered guard in the tree — issue #196 step 4), and
 * (5) verifies the restore is byte-identical via sha256.
 *
 * CAUGHT = the suite went red under the mutation (the guard is load-bearing).
 * GAP    = the suite stayed green (the guard could be deleted undetected) —
 *          this is a real finding: it must be reported and issued, never
 *          silently fixed by this script.
 *
 * Usage:
 *   node scripts/tests/mutation-guard-sweep.mjs [--registry <path>] [--only <id>] [--self-test]
 *
 * Exit code: 1 if any GAP is found or any entry errors, 0 otherwise.
 * Refuses to run on a dirty git tree (a mutation sweep must start clean so a
 * failed restore is unambiguous, and so restoring via `git stash`/checkout
 * as a last-resort recovery never discards real uncommitted work).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function parseArgs(argv) {
  const out = { registry: path.join(__dirname, 'mutation-guard-registry.json'), only: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--registry') out.registry = path.resolve(argv[++i]);
    else if (a === '--only') out.only = argv[++i];
    else if (a === '--self-test') out.selfTest = true;
  }
  return out;
}

function assertCleanTree() {
  let status;
  try {
    status = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (err) {
    console.error(`FATAL: could not read git status — ${err.message}`);
    process.exit(1);
  }
  if (status.trim() !== '') {
    console.error('FATAL: mutation-guard-sweep refuses to run on a dirty tree.');
    console.error('Commit or stash first — an interrupted sweep restores byte-identical files,');
    console.error('but it must be able to tell "restored" from "already had local changes".');
    console.error(status);
    process.exit(1);
  }
}

function countOccurrences(haystack, needle) {
  if (needle === '') return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** Mutates one guard, runs its suite, restores the file, returns a result row. */
function runOneGuard(entry, { verbose = true } = {}) {
  const filePath = path.resolve(REPO_ROOT, entry.file);
  if (!existsSync(filePath)) {
    return { id: entry.id, issue: entry.issue, verdict: 'ERROR', detail: `file not found: ${entry.file}` };
  }

  const originalBuf = readFileSync(filePath);
  const originalText = originalBuf.toString('utf8');
  const originalHash = sha256(originalBuf);

  const matchCount = countOccurrences(originalText, entry.pattern);
  if (matchCount !== 1) {
    return {
      id: entry.id,
      issue: entry.issue,
      verdict: 'ERROR',
      detail: `pattern matched ${matchCount} time(s) in ${entry.file}, expected exactly 1 — registry entry is stale`,
    };
  }

  let suiteExitCode = null;
  let suiteOutputTail = '';
  try {
    const mutatedText = originalText.replace(entry.pattern, entry.mutation);
    if (mutatedText === originalText) {
      return { id: entry.id, issue: entry.issue, verdict: 'ERROR', detail: 'mutation produced no change' };
    }
    writeFileSync(filePath, mutatedText, 'utf8');

    if (verbose) console.log(`  mutated ${entry.file} — running: ${entry.suite}`);
    try {
      const out = execFileSync('bash', ['-c', entry.suite], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      });
      suiteExitCode = 0;
      suiteOutputTail = out.split('\n').slice(-15).join('\n');
    } catch (err) {
      suiteExitCode = typeof err.status === 'number' ? err.status : 1;
      const combined = `${err.stdout || ''}\n${err.stderr || ''}`;
      suiteOutputTail = combined.split('\n').filter(Boolean).slice(-15).join('\n');
    }
  } finally {
    // Restore no matter what happened above — issue #196 step 4 is not optional.
    writeFileSync(filePath, originalBuf);
    const restoredHash = sha256(readFileSync(filePath));
    if (restoredHash !== originalHash) {
      console.error(`FATAL: restore of ${entry.file} is NOT byte-identical (before=${originalHash} after=${restoredHash}).`);
      console.error('Refusing to continue — inspect the file by hand before re-running the sweep.');
      process.exit(2);
    }
  }

  const verdict = suiteExitCode === 0 ? 'GAP' : 'CAUGHT';
  return {
    id: entry.id,
    issue: entry.issue,
    verdict,
    detail: verdict === 'GAP'
      ? `suite exited 0 under mutation — guard is NOT enforced (${entry.description})`
      : `suite exited ${suiteExitCode} under mutation, as expected`,
    suiteOutputTail,
  };
}

function printTable(results) {
  const rows = results.map(r => ({
    Guard: r.id,
    Issue: r.issue ? `#${r.issue}` : '-',
    Verdict: r.verdict,
    Detail: r.detail,
  }));
  const cols = ['Guard', 'Issue', 'Verdict', 'Detail'];
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c]).length)));
  const line = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join(' | ');
  console.log(line(cols));
  console.log(widths.map(w => '-'.repeat(w)).join('-|-'));
  for (const r of rows) console.log(line(cols.map(c => r[c])));
}

function runSelfTest() {
  // A tiny, throwaway fixture guard + suite so CI can prove the SWEEP MECHANICS
  // themselves (mutate → run → detect → restore byte-identical) without
  // touching any real guard or running a slow real suite. Runs fast enough
  // for pr-gate.
  const os = process;
  const fixtureDir = path.join(REPO_ROOT, 'scripts', 'tests', '.mutation-sweep-selftest-fixture');
  const fs = { rm: (p) => { try { execSync(`rm -rf "${p}"`); } catch { /* best-effort */ } } };
  fs.rm(fixtureDir);
  execSync(`mkdir -p "${fixtureDir}"`);

  const guardedFile = path.join(fixtureDir, 'guarded.mjs');
  const caughtSuite = path.join(fixtureDir, 'caught.suite.mjs');
  const gapSuite = path.join(fixtureDir, 'gap.suite.mjs');

  writeFileSync(
    guardedFile,
    "export function isEven(n) {\n  if (n % 2 !== 0) {\n    throw new Error('not even');\n  }\n  return true;\n}\n"
  );
  // This suite exercises the guard's condition — must go RED when the guard is neutralised.
  writeFileSync(
    caughtSuite,
    `import { isEven } from './guarded.mjs';\nlet threw = false;\ntry { isEven(3); } catch { threw = true; }\nif (!threw) { console.error('expected isEven(3) to throw'); process.exit(1); }\nconsole.log('ok');\n`
  );
  // This suite never calls the guard at all — must stay GREEN under mutation (a real GAP).
  writeFileSync(gapSuite, `console.log('ok, but never exercised the guard');\n`);

  const registry = {
    guards: [
      {
        id: 'selftest-caught',
        issue: 0,
        file: path.relative(REPO_ROOT, guardedFile),
        pattern: "if (n % 2 !== 0) {",
        mutation: 'if (false) {',
        suite: `node "${caughtSuite}"`,
        description: 'self-test: a suite that exercises the guard',
      },
      {
        id: 'selftest-gap',
        issue: 0,
        file: path.relative(REPO_ROOT, guardedFile),
        pattern: "if (n % 2 !== 0) {",
        mutation: 'if (false) {',
        suite: `node "${gapSuite}"`,
        description: 'self-test: a suite that never exercises the guard',
      },
    ],
  };

  const before = readFileSync(guardedFile);
  const results = registry.guards.map(g => runOneGuard(g, { verbose: false }));
  const after = readFileSync(guardedFile);

  let ok = true;
  const caught = results.find(r => r.id === 'selftest-caught');
  const gap = results.find(r => r.id === 'selftest-gap');
  if (!caught || caught.verdict !== 'CAUGHT') {
    console.error(`SELF-TEST FAIL: expected 'selftest-caught' to be CAUGHT, got ${caught && caught.verdict}`);
    ok = false;
  }
  if (!gap || gap.verdict !== 'GAP') {
    console.error(`SELF-TEST FAIL: expected 'selftest-gap' to be GAP, got ${gap && gap.verdict}`);
    ok = false;
  }
  if (!before.equals(after)) {
    console.error('SELF-TEST FAIL: fixture file was not restored byte-identical');
    ok = false;
  }

  fs.rm(fixtureDir);

  if (ok) {
    console.log('SELF-TEST PASS: mutate/run/detect/restore mechanics all correct.');
    return 0;
  }
  console.error('SELF-TEST FAILED — see above.');
  return 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    process.exit(runSelfTest());
  }

  assertCleanTree();

  const registry = JSON.parse(readFileSync(args.registry, 'utf8'));
  let guards = registry.guards;
  if (args.only) guards = guards.filter(g => g.id === args.only);
  if (guards.length === 0) {
    console.error(`No guards matched (--only=${args.only}).`);
    process.exit(1);
  }

  const results = [];
  for (const entry of guards) {
    console.log(`\n== ${entry.id} (issue #${entry.issue}) ==`);
    const r = runOneGuard(entry);
    results.push(r);
    console.log(`  -> ${r.verdict}: ${r.detail}`);
    if (r.verdict === 'GAP' && r.suiteOutputTail) {
      console.log('  suite output (tail):');
      console.log(r.suiteOutputTail.split('\n').map(l => `    ${l}`).join('\n'));
    }
  }

  console.log('\n');
  printTable(results);

  const gaps = results.filter(r => r.verdict === 'GAP');
  const errors = results.filter(r => r.verdict === 'ERROR');
  if (gaps.length > 0 || errors.length > 0) {
    console.error(`\nFAIL: ${gaps.length} gap(s), ${errors.length} error(s) — see table above.`);
    process.exit(1);
  }
  console.log('\nPASS: every registered guard is caught by its own suite.');
  process.exit(0);
}

main();
