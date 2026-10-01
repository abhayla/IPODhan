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
  // #1312: the web repositories/services and the scraper also write timestamps that are ordered
  // against database-stamped times (e.g. field-extraction-failures-repository resolvedAt).
  'web/lib',
  'scraper/src',
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const EXCLUDE = [/\.test\.(ts|tsx|mjs|js)$/, /[\\/]tests?[\\/]/, /[\\/]node_modules[\\/]/];

// A key ending in `At` (createdAt, detectedAt, stateChangedAt) or named `timestamp`, assigned the app clock.
const OFFENDER_RE = /\b(\w*At|timestamp)\s*:\s*new Date\(\s*\)/g;
const MARKER_RE = /\/\/\s*app-clock-ok:\s*\S/;
// #1312: the app clock held in a variable (`const now = new Date(); ... resolvedAt: now`).
const APP_CLOCK_VAR_RE = /\b(?:const|let|var)\s+(\w+)\s*=\s*new Date\(\s*\)/g;
const TIMESTAMP_NAME_RE = /^(\w*At|timestamp)$/;

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
  const isComment = (t) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  // #1312: every identifier this file assigns the app clock to. File-wide, so a later reassignment is
  // not resolved and any such name used as a timestamp value is flagged (fail closed).
  const clockVars = new Set();
  for (const raw of lines) {
    if (isComment(raw.trim())) continue;
    APP_CLOCK_VAR_RE.lastIndex = 0;
    let v;
    while ((v = APP_CLOCK_VAR_RE.exec(raw.replace(/\/\/.*$/, ''))) !== null) clockVars.add(v[1]);
  }
  const varUseRe =
    clockVars.size > 0 ? new RegExp(String.raw`\b(\w*At|timestamp)\s*:\s*(?:${[...clockVars].join('|')})\b`, 'g') : null;
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (isComment(trimmed)) return;
    const code = raw.replace(/\/\/.*$/, '');
    const marked = MARKER_RE.test(raw) || (i > 0 && MARKER_RE.test(lines[i - 1]));
    if (marked) return;
    const push = (column) => out.push({ file, line: i + 1, text: trimmed, column });
    let m;
    OFFENDER_RE.lastIndex = 0;
    while ((m = OFFENDER_RE.exec(code)) !== null) push(m[1]);
    if (varUseRe) {
      varUseRe.lastIndex = 0;
      while ((m = varUseRe.exec(code)) !== null) push(m[1]);
    }
    // A timestamp-named variable holding the app clock (`const detectedAt = new Date()`): a shorthand
    // `{ detectedAt }` cannot be told apart from any other use, so the declaration itself is flagged.
    APP_CLOCK_VAR_RE.lastIndex = 0;
    while ((m = APP_CLOCK_VAR_RE.exec(code)) !== null) if (TIMESTAMP_NAME_RE.test(m[1])) push(m[1]);
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
  // #1312 item 3: the baseline is exact. An entry whose count exceeds the occurrences found (lines
  // fixed, or the entry gone) is slack that would silently cover a future identical line, so it fails.
  const found = new Map();
  for (const o of offenders) found.set(keyOf(o), (found.get(keyOf(o)) ?? 0) + 1);
  const stale = baseline.filter((b) => (b.count ?? 1) > (found.get(b.key) ?? 0));
  if (stale.length > 0) {
    console.error(
      `[check-app-clock-timestamps] FAIL: ${stale.length} baseline entr${stale.length === 1 ? 'y' : 'ies'} whose count exceeds the occurrences found - shrink the baseline:`
    );
    stale.forEach((b) => console.error(`  - ${b.key} (baseline ${b.count ?? 1}, found ${found.get(b.key) ?? 0})`));
    process.exitCode = 1;
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
  if (stale.length > 0) return;
  console.log(`[check-app-clock-timestamps] PASS: 0 new offenders (${offenders.length} baselined across ${SCAN_DIRS.length} trees)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
