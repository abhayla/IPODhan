// scripts/tests/no-utc-day-in-run-labels.test.mjs — #687 regrowth guard.
//
// Slices 1-3 guarded a hand-maintained list of eleven files, so the twelfth
// file to derive a day from the UTC clock would have landed unnoticed. Slice
// 4 walks the tree instead: every scripts/**/*.mjs, scraper/src/**/*.ts,
// web/lib/**/*.ts and web/app/**/*.ts must derive "today" from the IST day
// (packages/shared/src/utils/ist-day.ts istDayIso, scripts/lib/ist-day.mjs,
// or scraper's istDateIso wrapper), never from the UTC calendar day.
//
// This is the fence for scraper/ and packages/shared/, which have no ESLint
// config and no lint script — web/eslint.config.mjs carries the equivalent
// no-restricted-syntax rule for web/, and this test covers web too so a
// change that only runs `node --test` still catches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// Matches `new Date().toISOString().slice(0, 10)` and
// `new Date().toISOString().split('T')[0]` — a FRESH clock read, which is
// the UTC calendar day (the class this guard exists to stop regrowing).
// Deliberately narrower than "any expr before .toISOString()": several files
// call `.toISOString()` on an already-PARSED date variable (e.g.
// `date.toISOString().split('T')[0]` inside a date-string parser) — a
// different class (F-104, formatting a known date, not deriving "today")
// that this guard must NOT flag.
const UTC_DAY_PATTERN =
  /new Date\(\)\.toISOString\(\)\.(slice\(0,\s*10\)|split\(['"]T['"]\)\[0\])/;

const SCAN_ROOTS = [
  { dir: 'scripts', exts: ['.mjs'] },
  { dir: join('scraper', 'src'), exts: ['.ts'] },
  { dir: join('web', 'lib'), exts: ['.ts'] },
  { dir: join('web', 'app'), exts: ['.ts'] },
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', 'tests', '__tests__']);

// The guard's own documentation (and the helpers') QUOTE the bad pattern to
// explain it. Scanning raw text would flag those comments, so whole-line
// comments are dropped before matching. Deliberately line-based and
// conservative: it only removes a line whose first non-space characters are
// `//` or that sits inside a `/* ... */` block, never an inline trailing
// comment, so it can never swallow code (no hand-rolled lexer, cf. the
// never-hand-roll-a-lexer lesson). A real offender always appears as code on
// a line that starts with code.
function stripWholeLineComments(contents) {
  const out = [];
  let inBlock = false;
  for (const line of contents.split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    out.push(line);
  }
  return out.join(String.fromCharCode(10));
}

function isTestFile(relPath) {
  const base = relPath.split(sep).pop();
  return /\.(test|spec)\./.test(base) || relPath.split(sep).includes('tests');
}

function walk(absDir, exts, out) {
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return out; // a scan root that does not exist is not a failure
  }
  for (const entry of entries) {
    const abs = join(absDir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(abs, exts, out);
    } else if (exts.some((e) => entry.endsWith(e))) {
      const rel = relative(REPO_ROOT, abs);
      if (!isTestFile(rel)) out.push(rel);
    }
  }
  return out;
}

const SCANNED = SCAN_ROOTS.flatMap(({ dir, exts }) => walk(join(REPO_ROOT, dir), exts, []));

test('the scan actually reaches the tree (positive control)', () => {
  // A zero-file scan would make every assertion below vacuously pass.
  assert.ok(
    SCANNED.length > 100,
    `expected the walk to find >100 source files, found ${SCANNED.length} — ` +
      'the scan roots or the walker are broken, and this guard is proving nothing.'
  );
  // The pattern itself must be able to fire.
  assert.match("new Date().toISOString().split('T')[0]", UTC_DAY_PATTERN);
  assert.match('new Date().toISOString().slice(0, 10)', UTC_DAY_PATTERN);
  // ...and must NOT fire on the F-104 formatting class.
  assert.doesNotMatch("parsed.toISOString().split('T')[0]", UTC_DAY_PATTERN);
  // The comment stripper must drop documentation but keep code.
  const sample = [
    "// new Date().toISOString().split('T')[0] is the UTC day",
    "const real = new Date().toISOString().slice(0, 10);",
  ].join(String.fromCharCode(10));
  const stripped = stripWholeLineComments(sample);
  assert.doesNotMatch(stripped, /UTC day/);
  assert.match(stripped, UTC_DAY_PATTERN);
});

test('no UTC-day derivation anywhere in scripts/, scraper/src, web/lib, web/app', () => {
  const offenders = [];
  for (const rel of SCANNED) {
    const contents = stripWholeLineComments(readFileSync(join(REPO_ROOT, rel), 'utf8'));
    const match = contents.match(UTC_DAY_PATTERN);
    if (match) offenders.push(`${rel}: "${match[0]}"`);
  }
  assert.deepEqual(
    offenders,
    [],
    [
      'These files still derive a day from new Date().toISOString() (the UTC calendar day):',
      ...offenders.map((o) => `  - ${o}`),
      'Use istDayIso() from @ipodhan/shared/utils/ist-day (TS) or scripts/lib/ist-day.mjs',
      '(plain Node) for any run label, state-file name, dedupe key or "today" comparison.',
      'See #687.',
    ].join(String.fromCharCode(10))
  );
});
