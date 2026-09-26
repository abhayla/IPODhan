#!/usr/bin/env node
/**
 * Type-check `scraper/src` against a FRESHLY built `packages/shared`, with a
 * shrink-only baseline (issue #890).
 *
 * Why this exists: no CI job type-checked scraper/src directly. `pr-gate.yml`
 * ran `tsc --noEmit` in `web/` and `npm run type-check:scripts` in `scraper/`
 * (which only covers `scraper/tsconfig.scripts.json`'s `scripts/**` include,
 * and only pulls in whatever slice of `src/` a given script happens to
 * import). #890/#891 measured that a script importing a different src/ file
 * changed the reported error count from 0 to 22 to 98 depending on which
 * scripts existed and whether `packages/shared/dist` was fresh — the result
 * depended on accidents of which files were on disk, not on `scraper/src`'s
 * actual correctness.
 *
 * This check runs `scraper/tsconfig.json` (whose `include` is `src/**\/*`)
 * directly, after rebuilding `packages/shared/dist` from source so a stale
 * dist can never produce a false "0 errors". Every existing error is
 * captured once in a committed baseline
 * (config/scraper-src-type-baseline.json), keyed by FILE + TS ERROR CODE +
 * a normalized MESSAGE (never line number, which shifts on unrelated edits
 * in the same file). The gate is a multiset comparison:
 *
 *   - a key occurring MORE often in the current run than in the baseline is
 *     a NEW error -> FAIL (a regression was introduced).
 *   - a key occurring in the baseline but not (or less often) in the current
 *     run is a FIXED error -> FAIL, asking the PR to shrink the baseline in
 *     the same change (this is what makes the ratchet shrink-only instead of
 *     silently accepting a smaller baseline forever).
 *
 * This PR does not fix any of the existing errors — it only baselines them
 * (count and per-file breakdown in the PR body) so no NEW error can land
 * uncaught from here on.
 *
 * Usage: node scripts/ci/check-scraper-src-types.mjs [--baseline]
 *   (no flags) - fail on any new offender not in the baseline, or any
 *                baseline entry no longer reproduced (must be shrunk)
 *   --baseline - print the current offender list as baseline JSON (for
 *                updating the baseline file after a real fix)
 */
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHARED_DIR = path.join(REPO_ROOT, 'packages', 'shared');
const SCRAPER_DIR = path.join(REPO_ROOT, 'scraper');
const BASELINE_PATH = path.join(REPO_ROOT, 'config', 'scraper-src-type-baseline.json');

// Matches tsc --noEmit's default (non-pretty) diagnostic format:
//   path/to/file.ts(12,34): error TS2339: Property 'foo' does not exist on type 'Bar'.
const DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/**
 * Normalize a diagnostic message so the key is stable across cosmetic
 * whitespace differences but still distinguishes genuinely different
 * messages. Deliberately does NOT strip identifiers/types out of the
 * message — two different type errors on the same line-less key must stay
 * distinct entries, which the multiset comparison in main() relies on.
 */
export function normalizeMessage(message) {
  return message.trim().replace(/\s+/g, ' ');
}

/**
 * Parse raw `tsc --noEmit` output (stdout+stderr combined) into one entry
 * per diagnostic: { file, code, message }. `file` is repo-root-relative with
 * forward slashes so the baseline is stable across Windows/POSIX runners.
 */
export function parseDiagnostics(output, { repoRoot = REPO_ROOT, cwd = SCRAPER_DIR } = {}) {
  const entries = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = DIAGNOSTIC_RE.exec(line);
    if (!m) continue;
    const [, rawFile, , , code, rawMessage] = m;
    const absFile = path.isAbsolute(rawFile) ? rawFile : path.join(cwd, rawFile);
    const relFile = path.relative(repoRoot, absFile).split(path.sep).join('/');
    entries.push({ file: relFile, code, message: normalizeMessage(rawMessage) });
  }
  return entries;
}

export function keyOf(entry) {
  return `${entry.file}::${entry.code}::${entry.message}`;
}

/** Turn a flat list of entries into a key -> count multiset. */
export function toMultiset(entries) {
  const counts = new Map();
  for (const e of entries) {
    const k = keyOf(e);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

/**
 * Compare current vs baseline multisets. Returns:
 *   - newOffenders: [{ key, current, baseline }] where current > baseline
 *   - shrinkable:   [{ key, current, baseline }] where baseline > current
 */
export function diffMultisets(currentCounts, baselineCounts) {
  const newOffenders = [];
  const shrinkable = [];
  const allKeys = new Set([...currentCounts.keys(), ...baselineCounts.keys()]);
  for (const k of allKeys) {
    const current = currentCounts.get(k) || 0;
    const baseline = baselineCounts.get(k) || 0;
    if (current > baseline) newOffenders.push({ key: k, current, baseline });
    if (baseline > current) shrinkable.push({ key: k, current, baseline });
  }
  return { newOffenders, shrinkable };
}

function rebuildSharedFresh() {
  rmSync(path.join(SHARED_DIR, 'dist'), { recursive: true, force: true });
  rmSync(path.join(SHARED_DIR, 'tsconfig.tsbuildinfo'), { force: true });
  execFileSync('npx', ['tsc'], { cwd: SHARED_DIR, stdio: 'inherit', shell: true });
  const schemaDts = path.join(SHARED_DIR, 'dist', 'db', 'schema.d.ts');
  if (!existsSync(schemaDts)) {
    console.error(`FATAL: ${schemaDts} was not created by the shared build.`);
    process.exit(1);
  }
}

function runScraperSrcTsc() {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {
      cwd: SCRAPER_DIR,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
    });
    return ''; // 0 errors
  } catch (err) {
    // tsc exits 2 on type errors; stdout carries the diagnostics.
    return (err.stdout ? String(err.stdout) : '') + (err.stderr ? String(err.stderr) : '');
  }
}

function loadBaselineCounts() {
  if (!existsSync(BASELINE_PATH)) return new Map();
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (!Array.isArray(raw)) {
    console.error(`FATAL: ${BASELINE_PATH} must be a JSON array of {file, code, message}.`);
    process.exit(1);
  }
  return toMultiset(raw);
}

function main() {
  const printBaseline = process.argv.includes('--baseline');

  rebuildSharedFresh();
  const output = runScraperSrcTsc();
  const entries = parseDiagnostics(output);

  if (printBaseline) {
    const sorted = [...entries].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    console.log(JSON.stringify(sorted, null, 2));
    return;
  }

  const currentCounts = toMultiset(entries);
  const baselineCounts = loadBaselineCounts();
  const { newOffenders, shrinkable } = diffMultisets(currentCounts, baselineCounts);

  console.log(
    `[check-scraper-src-types] scraper/src (fresh shared build): ${entries.length} error(s), ` +
      `${[...baselineCounts.values()].reduce((a, b) => a + b, 0)} baselined.`
  );

  let failed = false;

  if (shrinkable.length > 0) {
    failed = true;
    console.error(
      `FAIL: ${shrinkable.length} baseline entr${shrinkable.length === 1 ? 'y is' : 'ies are'} ` +
        `no longer reproduced — this is a shrink-only baseline: fixed errors must be removed from ` +
        `${path.relative(REPO_ROOT, BASELINE_PATH)} in the same PR that fixes them. Re-run with ` +
        `--baseline and commit the result.`
    );
    for (const s of shrinkable) console.error(`  FIXED (shrink me): ${s.key}`);
  }

  if (newOffenders.length > 0) {
    failed = true;
    console.error(
      `FAIL: ${newOffenders.length} new scraper/src type error(s) not in the baseline. Fix them, or ` +
        `if they are genuinely pre-existing and only newly detected, re-run with --baseline and commit ` +
        `${path.relative(REPO_ROOT, BASELINE_PATH)}.`
    );
    for (const o of newOffenders) console.error(`  NEW: ${o.key}`);
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log('[check-scraper-src-types] PASS: no new errors, baseline fully reproduced.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
