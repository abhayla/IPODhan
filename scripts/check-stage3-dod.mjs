#!/usr/bin/env node
// scripts/check-stage3-dod.mjs — runs every stage 3 build card's own "### Definition of Done"
// table and prints PASS/FAIL/SKIP per row.
//
// WHY. Stage 3 (docs/design/stage-3-ledger.md) is twelve one-source-table slices
// (docs/design/build-cards/item-03-s*.md), each carrying its own DoD table as the actual gate a
// slice is built against. A card's prose says "the gate is `node scripts/check-stage3-dod.mjs
// --slice S0a`" (see item-03-s0a-spec-repair.md) — this is that script. It never re-types a row's
// command or expectation; it parses the table straight out of the card and RUNS what's there, so a
// card edit changes the gate without a second file to keep in sync (the class of bug
// `duplicated-check-implementations.md` names).
//
// Usage:
//   node scripts/check-stage3-dod.mjs --slice S0a [--test-db] [--staging] [--cards <dir>]
//   node scripts/check-stage3-dod.mjs                              (all slices found)
//   node scripts/check-stage3-dod.mjs --sql "<select ...>" --expect-db <name>   (used BY DoD rows)
//
// Exit codes (per selected slice set):
//   0 every selected row PASS
//   1 at least one row FAILed
//   2 no FAIL, but at least one row SKIPped (incomplete — an env flag was withheld)
//   3 a card has no DoD table, or a row is malformed (named in the error)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_CARDS_DIR = path.join(REPO_ROOT, 'docs', 'design', 'build-cards');

function parseArgs(argv) {
  const args = { testDb: false, staging: false, cardsDir: DEFAULT_CARDS_DIR, slice: null, sql: null, expectDb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slice') args.slice = argv[++i];
    else if (a === '--test-db') args.testDb = true;
    else if (a === '--staging') args.staging = true;
    else if (a === '--cards') args.cardsDir = path.resolve(argv[++i]);
    else if (a === '--sql') args.sql = argv[++i];
    else if (a === '--expect-db') args.expectDb = argv[++i];
  }
  return args;
}

// Unescape a markdown table cell: a literal pipe inside a cell is written `\|`.
function unescapeCell(cell) {
  return cell.replace(/\\\|/g, '|').trim();
}

// Strip one layer of backticks a cell value is wrapped in, if present.
function unbacktick(s) {
  const t = s.trim();
  if (t.startsWith('`') && t.endsWith('`') && t.length >= 2) return t.slice(1, -1);
  return t;
}

// Split a markdown table row line into unescaped cells, dropping the leading/trailing empty
// cells produced by the outer `|...|` delimiters. A pipe is a cell separator UNLESS it is either
// (a) backslash-escaped (`\|`, unescaped back to a literal `|` in the cell), or (b) inside a
// backtick-quoted span — a command cell like `` `node -e "...(f.r||[])..."` `` carries raw,
// unescaped `|`s that are part of the shell command, not table syntax.
function splitRow(line) {
  const raw = line.trim();
  if (!raw.startsWith('|')) return null;
  const cells = [];
  let cur = '';
  let inBacktick = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && raw[i + 1] === '|') {
      cur += '\\|';
      i++;
      continue;
    }
    if (ch === '`') {
      inBacktick = !inBacktick;
      cur += ch;
      continue;
    }
    if (ch === '|' && !inBacktick) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // First and last are the empty strings before/after the leading/trailing pipe.
  const trimmed = cells.slice(1, -1).map(unescapeCell);
  return trimmed;
}

// Parses the "### Definition of Done" table out of one card's markdown text.
// Returns [{ id, command, expect, env }], or throws with a message naming the card + reason.
export function parseDodTable(cardText, cardName) {
  const headingIdx = cardText.indexOf('### Definition of Done');
  if (headingIdx === -1) {
    throw new Error(`card ${cardName} has no "### Definition of Done" heading`);
  }
  const after = cardText.slice(headingIdx);
  const lines = after.split('\n').map((l) => l.replace(/\r$/, ''));
  // Find the header row (starts with "| id " or similar) and the separator row beneath it.
  let headerLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|.*\bid\b.*\|.*\bcommand\b.*\|.*\bexpect\b.*\|.*\benv\b.*\|/i.test(lines[i])) {
      headerLineIdx = i;
      break;
    }
  }
  if (headerLineIdx === -1) {
    throw new Error(`card ${cardName} has a "### Definition of Done" heading but no id|command|expect|env table`);
  }
  const rows = [];
  for (let i = headerLineIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break; // table ended
    const cells = splitRow(line);
    if (!cells || cells.length < 4) {
      throw new Error(`card ${cardName} DoD row malformed (expected 4 columns): ${line}`);
    }
    const [idCell, commandCell, expectCell, envCell] = cells;
    const id = idCell.trim();
    const command = unbacktick(commandCell);
    const expect = parseExpect(expectCell);
    const env = envCell.trim();
    if (!id || !command || !env) {
      throw new Error(`card ${cardName} DoD row malformed (empty id/command/env): ${line}`);
    }
    rows.push({ id, command, expect, env, raw: expectCell.trim() });
  }
  if (rows.length === 0) {
    throw new Error(`card ${cardName} DoD table has a header but zero rows`);
  }
  return rows;
}

// Parses an "expect" cell into { kind, value }.
//   exit N              -> { kind: 'exit', code: N }
//   line: `text`         -> { kind: 'line', text }
//   regex: `source`      -> { kind: 'regex', source }
function parseExpect(cell) {
  const t = cell.trim();
  const exitMatch = /^exit\s+(\d+)$/.exec(t);
  if (exitMatch) return { kind: 'exit', code: parseInt(exitMatch[1], 10) };
  const lineMatch = /^line:\s*`([\s\S]*)`$/.exec(t);
  if (lineMatch) return { kind: 'line', text: lineMatch[1] };
  const regexMatch = /^regex:\s*`([\s\S]*)`$/.exec(t);
  if (regexMatch) return { kind: 'regex', source: regexMatch[1] };
  throw new Error(`unrecognized expect grammar: ${t}`);
}

function slicePrefix(id) {
  // e.g. "S0a-1" -> "S0a"; "S1a-7" -> "S1a"
  const dash = id.indexOf('-');
  return dash === -1 ? id : id.slice(0, dash);
}

export function findCards(cardsDir) {
  return fs
    .readdirSync(cardsDir)
    .filter((f) => /^item-\d+-s.*\.md$/.test(f))
    .sort();
}

// Builds a RegExp from an expect: regex source, translating a leading `(?s)` (Python/PCRE
// "DOTALL" inline flag, not valid in JS) into the JS `s` (dotAll) flag instead.
function buildRegex(source) {
  let flags = 'm';
  let src = source;
  if (src.startsWith('(?s)')) {
    src = src.slice(4);
    flags += 's';
  }
  return new RegExp(src, flags);
}

function runRow(row, repoRoot) {
  const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execSync(row.command, {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      timeout: 10 * 60 * 1000,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    stdout = e.stdout ? e.stdout.toString() : '';
    stderr = e.stderr ? e.stderr.toString() : '';
    code = typeof e.status === 'number' ? e.status : 1;
    if (e.signal) code = 124; // timeout/killed
    return finish(row, code, stdout, stderr);
  }
  return finish(row, code, stdout, stderr);
}

function firstNChars(s, n) {
  const flat = s.replace(/\r?\n/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) : flat;
}

function finish(row, code, stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let pass = false;
  let evidence = '';
  if (row.expect.kind === 'exit') {
    pass = code === row.expect.code;
    evidence = pass ? `exit=${code}` : `expected exit ${row.expect.code}`;
  } else if (row.expect.kind === 'line') {
    const match = lines.find((l) => l.includes(row.expect.text));
    pass = Boolean(match);
    evidence = pass ? match : `expected line: [${row.expect.text}]`;
  } else if (row.expect.kind === 'regex') {
    const re = buildRegex(row.expect.source);
    pass = re.test(combined);
    evidence = pass ? (combined.match(re) || [''])[0] : `expected regex: ${row.expect.source}`;
  }
  return { pass, code, evidence, firstLine: lines[0] || '' };
}

function checkEnvGate(row, args) {
  if (row.env === 'local') return { runnable: true };
  if (row.env === 'test-db') return { runnable: args.testDb };
  if (row.env === 'staging') return { runnable: args.staging };
  return { runnable: true }; // unknown env value: treat as always-runnable rather than silently dropping the row
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.sql) {
    await runSqlMode(args);
    return;
  }

  let cardFiles;
  try {
    cardFiles = findCards(args.cardsDir);
  } catch (e) {
    console.error(`FATAL: cannot read cards dir ${args.cardsDir}: ${e.message}`);
    process.exit(3);
  }

  const bySlice = new Map(); // sliceId -> [{id, command, expect, env, raw}]
  for (const file of cardFiles) {
    const text = fs.readFileSync(path.join(args.cardsDir, file), 'utf8');
    let rows;
    try {
      rows = parseDodTable(text, file);
    } catch (e) {
      console.error(`FATAL: ${e.message}`);
      process.exit(3);
    }
    for (const row of rows) {
      const sl = slicePrefix(row.id);
      if (!bySlice.has(sl)) bySlice.set(sl, []);
      bySlice.get(sl).push(row);
    }
  }

  const slicesToRun = args.slice ? [args.slice] : [...bySlice.keys()];
  for (const sl of slicesToRun) {
    if (!bySlice.has(sl)) {
      console.error(`FATAL: no card provides slice "${sl}"`);
      process.exit(3);
    }
  }

  let anyFail = false;
  let anySkip = false;

  for (const sl of slicesToRun) {
    const rows = bySlice.get(sl);
    let p = 0, f = 0, s = 0;
    for (const row of rows) {
      const gate = checkEnvGate(row, args);
      if (!gate.runnable) {
        console.log(`SKIP ${row.id} env=${row.env}`);
        s++;
        anySkip = true;
        continue;
      }
      const result = runRow(row, REPO_ROOT);
      if (result.pass) {
        console.log(`PASS ${row.id} exit=${result.code} | ${firstNChars(result.evidence, 100)}`);
        p++;
      } else {
        console.log(`FAIL ${row.id} exit=${result.code} expected ${row.raw} | ${firstNChars(result.evidence, 100)}`);
        f++;
        anyFail = true;
      }
    }
    console.log(`${sl}: ${p} PASS, ${f} FAIL, ${s} SKIP of ${rows.length}`);
  }

  if (anyFail) process.exit(1);
  if (anySkip) process.exit(2);
  process.exit(0);
}

// --sql mode: used BY the cards' own DoD rows to run one read-only SELECT against a named
// database, guarded against pointing at prod. Reuses the "assert the LIVE connection's own
// current_database(), never env vars" idiom from scripts/assert-repair-held.mjs / -
// scripts/audit-ipo-coverage.mjs:448 (`SELECT current_database()`), and the "refuse prod" contract
// from scripts/assert-repair-held.mjs's ipodhan_test/ipodhan_staging-only design.
export async function runSqlMode({ sql, expectDb }) {
  if (!expectDb) {
    console.error('FATAL: --sql requires --expect-db <name>');
    process.exit(1);
    return;
  }
  if (expectDb === 'ipodhan') {
    console.error(`FATAL: --expect-db ipodhan refused — this tool never targets production`);
    process.exit(1);
    return;
  }
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) {
    console.error(`FATAL: --sql must start with SELECT (no writes) — got: ${firstNChars(trimmed, 60)}`);
    process.exit(1);
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('FATAL: DATABASE_URL not set');
    process.exit(1);
    return;
  }

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, ssl: false, max: 1 });
  try {
    const { rows: dbRows } = await pool.query('SELECT current_database() AS name');
    const actualDb = dbRows[0].name;
    if (actualDb !== expectDb) {
      console.error(`FATAL: connected database is "${actualDb}", expected "${expectDb}" — refusing to run`);
      process.exit(1);
      return;
    }
    if (actualDb === 'ipodhan') {
      console.error('FATAL: connected database is "ipodhan" (production) — refused');
      process.exit(1);
      return;
    }
    const { rows } = await pool.query(trimmed);
    for (const row of rows) {
      console.log(Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' '));
    }
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
