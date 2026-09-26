#!/usr/bin/env node
/**
 * Detection check for #640: a pg connection field read as
 * `process.env.DATABASE_NAME || '<literal>'` or
 * `process.env.DATABASE_USER || '<literal>'` (or the `??` form) silently
 * defaults to that literal when the env var is unset. For DATABASE_NAME the
 * observed literal was 'ipodhan' — the PRODUCTION database — and for
 * DATABASE_USER it was 'postgres' — the superuser. A script run through the
 * tunnel (DATABASE_HOST set) that forgets either variable then connects to
 * prod, as the superuser, with no error.
 *
 * The fix is `resolveDiscreteDbParams(env)` (packages/shared/src/db/index.ts
 * for .ts files that already depend on @ipodhan/shared; scripts/lib/
 * pg-connection-params.mjs for plain-`node`-run .mjs files, which cannot
 * import a .ts module) — it throws naming whichever variable is missing,
 * never defaults. This check fails the PR gate on any NEW occurrence of the
 * defaulting shape in connection-building code under scraper/scripts/**,
 * scripts/**, web/scripts/**, unless it is listed in the committed baseline
 * with a reason (a legitimate non-production default, e.g. a hardcoded
 * test-only database, or a diagnostic console.log label).
 *
 * Usage: node scripts/ci/check-db-connection-defaults.mjs [--baseline]
 *   (no flags) - scan the real tree, fail (exit 1) on any NEW offender not in
 *                the committed baseline (scripts/ci/db-connection-defaults-baseline.json)
 *   --baseline - print the current offender list as baseline JSON
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'ci', 'db-connection-defaults-baseline.json');

const SCAN_DIRS = ['scraper/scripts', 'scripts', 'web/scripts'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const EXCLUDE_PATTERNS = [
  /\/node_modules\//,
  /\.test\.(ts|mjs|js)$/,
  /\/tests?\//,
  // Documents the old (fixed) shape in a comment, and defines the resolver
  // itself — it is not a connection-building call site.
  /\/lib\/pg-connection-params\.mjs$/,
  // This detector's own source quotes the offending shape to document it.
  /\/ci\/check-db-connection-defaults\.mjs$/,
];

const OFFENDER_RE = /\b(DATABASE_NAME|DATABASE_USER)\s*(?:\|\||\?\?)\s*['"]/g;

function listFiles() {
  const out = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => SCAN_DIRS.some((d) => f === d || f.startsWith(d + '/')))
    .filter((f) => FILE_EXTENSIONS.has(path.extname(f)))
    .filter((f) => !EXCLUDE_PATTERNS.some((re) => re.test('/' + f)));
}

export function findOffenders(file, source) {
  const offenders = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, idx) => {
    OFFENDER_RE.lastIndex = 0;
    let m;
    while ((m = OFFENDER_RE.exec(line)) !== null) {
      offenders.push({ file, line: idx + 1, text: line.trim(), variable: m[1] });
    }
  });
  return offenders;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return parsed.map((e) => `${e.file}:${e.line}`);
}

export function keyOf(o) {
  return `${o.file}:${o.line}`;
}

function main() {
  const printBaseline = process.argv.includes('--baseline');
  const files = listFiles();
  const allOffenders = [];

  for (const relFile of files) {
    const abs = path.join(REPO_ROOT, relFile);
    let source;
    try {
      source = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!source.includes('DATABASE_NAME') && !source.includes('DATABASE_USER')) continue;
    allOffenders.push(...findOffenders(relFile, source));
  }

  if (printBaseline) {
    console.log(
      JSON.stringify(
        allOffenders.map((o) => ({ file: o.file, line: o.line, reason: 'FILL IN' })),
        null,
        2
      )
    );
    return;
  }

  const baseline = new Set(loadBaseline());
  const newOffenders = allOffenders.filter((o) => !baseline.has(keyOf(o)));
  const goneFromBaseline = [...baseline].filter(
    (k) => !allOffenders.some((o) => keyOf(o) === k)
  );

  if (goneFromBaseline.length > 0) {
    console.log(
      `[check-db-connection-defaults] ${goneFromBaseline.length} baseline entr${goneFromBaseline.length === 1 ? 'y is' : 'ies are'} gone (fixed) — shrink scripts/ci/db-connection-defaults-baseline.json:`
    );
    goneFromBaseline.forEach((k) => console.log(`  - ${k}`));
  }

  if (newOffenders.length > 0) {
    console.error(
      `[check-db-connection-defaults] FAIL: ${newOffenders.length} new offender(s) (#640) — ` +
        `DATABASE_NAME or DATABASE_USER defaults to a hardcoded literal instead of failing loudly ` +
        `when unset. A script through the tunnel (DATABASE_HOST set) that forgets the variable ` +
        `silently connects to that literal — 'ipodhan' is production, 'postgres' is the superuser. ` +
        `Use resolveDiscreteDbParams(env) (from '@ipodhan/shared/db' in a .ts file, or ` +
        `'scripts/lib/pg-connection-params.mjs' in a plain-node .mjs file) instead. If this default ` +
        `is genuinely safe (a hardcoded non-production database, a least-privilege role default, a ` +
        `diagnostic label), add it to scripts/ci/db-connection-defaults-baseline.json with a reason.\n`
    );
    newOffenders.forEach((o) => {
      console.error(`  ${o.file}:${o.line}  ${o.text}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-db-connection-defaults] PASS: 0 new offenders (${allOffenders.length} baseline entries carried forward)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
