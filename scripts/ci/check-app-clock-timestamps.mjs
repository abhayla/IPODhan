#!/usr/bin/env node
/**
 * Detection check for failure class `mixed-clock-ordering`
 * (docs/reviews/failure-classes/mixed-clock-ordering.json, F-210).
 *
 * Mechanism: a timestamp column that feeds an ordering decision against another DATABASE-stamped time
 * (documents.created_at, data_conflicts.detected_at, every defaultNow() column) must be written from the
 * database clock (sql`now()` or readDatabaseNow(tx)). Writing it from the app host's clock
 * (`new Date()`) mixes two machines' clocks, and any drift misorders every event inside the drift.
 *
 * This is a ratchet: it scans the admin / shared write code for a timestamp-named key assigned
 * `new Date()` (`fooAt: new Date()`, `timestamp: new Date().toISOString()`), and fails on any occurrence
 * that is neither in the committed baseline (scripts/ci/app-clock-timestamps-baseline.json, one entry per
 * file + line text with a count and a reason) nor marked on the same or the previous line with
 * `// app-clock-ok: <reason>`.
 *
 * Usage: node scripts/ci/check-app-clock-timestamps.mjs [--baseline] [--root <dir>] [--baseline-file <path>]
 *   (no flags)  scan the tree, exit 1 naming file:line of every NEW offender
 *   --baseline  print the current offenders as baseline JSON (reasons must then be written by hand)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCAN_DIRS = [
  'packages/shared/src/services',
  'packages/shared/src/repositories',
  'packages/shared/src/admin',
  'web/app/api/admin',
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const EXCLUDE = [/\.test\.(ts|tsx|mjs|js)$/, /[\\/]tests?[\\/]/, /[\\/]node_modules[\\/]/];

// A key ending in `At` (createdAt, detectedAt, stateChangedAt) or named `timestamp`, assigned the app clock.
const OFFENDER_RE = /\b(\w*At|timestamp)\s*:\s*new Date\(\s*\)/g;
const MARKER_RE = /\/\/\s*app-clock-ok:\s*\S/;

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (EXTENSIONS.has(path.extname(name))) out.push(abs);
  }
}

/** Offenders in one file's source: [{ file, line, text, column }]. Comment lines are ignored. */
export function findOffenders(file, source) {
  const lines = source.split(/\r?\n/);
  const out = [];
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const code = raw.replace(/\/\/.*$/, '');
    OFFENDER_RE.lastIndex = 0;
    let m;
    while ((m = OFFENDER_RE.exec(code)) !== null) {
      if (MARKER_RE.test(raw) || (i > 0 && MARKER_RE.test(lines[i - 1]))) continue;
      out.push({ file, line: i + 1, text: trimmed, column: m[1] });
    }
  });
  return out;
}

export const keyOf = (o) => `${o.file} :: ${o.text}`;

/** Offenders the baseline does not cover: a baseline entry covers `count` occurrences of its file + text. */
export function newOffenders(offenders, baseline) {
  const allowance = new Map(baseline.map((b) => [b.key, b.count ?? 1]));
  const out = [];
  for (const o of offenders) {
    const left = allowance.get(keyOf(o)) ?? 0;
    if (left > 0) allowance.set(keyOf(o), left - 1);
    else out.push(o);
  }
  return out;
}

export function scan(root) {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(root, d), files);
  const offenders = [];
  for (const abs of files.sort()) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (EXCLUDE.some((re) => re.test(rel))) continue;
    offenders.push(...findOffenders(rel, readFileSync(abs, 'utf8')));
  }
  return offenders;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const root = path.resolve(arg('--root') ?? path.join(__dirname, '..', '..'));
  const baselinePath = path.resolve(arg('--baseline-file') ?? path.join(root, 'scripts', 'ci', 'app-clock-timestamps-baseline.json'));
  const offenders = scan(root);

  if (process.argv.includes('--baseline')) {
    const counts = new Map();
    for (const o of offenders) counts.set(keyOf(o), (counts.get(keyOf(o)) ?? 0) + 1);
    console.log(JSON.stringify([...counts].map(([key, count]) => ({ key, count, reason: 'TODO' })), null, 2));
    return;
  }

  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : [];
  const missingReason = baseline.filter((b) => typeof b.reason !== 'string' || b.reason.trim().length < 10 || b.reason === 'TODO');
  if (missingReason.length > 0) {
    console.error(`[check-app-clock-timestamps] FAIL: ${missingReason.length} baseline entr${missingReason.length === 1 ? 'y has' : 'ies have'} no reason (10+ chars):`);
    missingReason.forEach((b) => console.error(`  ${b.key}`));
    process.exitCode = 1;
    return;
  }
  const fresh = newOffenders(offenders, baseline);
  const present = new Set(offenders.map(keyOf));
  const gone = baseline.filter((b) => !present.has(b.key));
  if (gone.length > 0) {
    console.log(`[check-app-clock-timestamps] ${gone.length} baseline entr${gone.length === 1 ? 'y is' : 'ies are'} gone (fixed) - shrink the baseline:`);
    gone.forEach((b) => console.log(`  - ${b.key}`));
  }
  if (fresh.length > 0) {
    console.error(
      `[check-app-clock-timestamps] FAIL: ${fresh.length} new app-clock timestamp(s) (class mixed-clock-ordering, F-210). ` +
        'A time that is ordered against a database-stamped time must come from the database clock: use sql`now()` ' +
        'in the statement or readDatabaseNow(tx). If this value is never compared with a database time (a response ' +
        'field, a cache score), mark the line `// app-clock-ok: <reason>`.'
    );
    fresh.forEach((o) => console.error(`  ${o.file}:${o.line}  ${o.text}`));
    process.exitCode = 1;
    return;
  }
  console.log(`[check-app-clock-timestamps] PASS: 0 new offenders (${offenders.length} baselined across ${SCAN_DIRS.length} trees)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
