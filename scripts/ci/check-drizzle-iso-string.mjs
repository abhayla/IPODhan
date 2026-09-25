#!/usr/bin/env node
/**
 * Detection check for failure class `iso-string-bound-to-drizzle-timestamp`
 * (docs/reviews/failure-classes/iso-string-bound-to-drizzle-timestamp.json).
 *
 * Core mechanism: drizzle's PgTimestamp.mapToDriverValue calls `.toISOString()`
 * on whatever value it is handed. A `timestamp()` column in drizzle's DEFAULT
 * mode expects a JS `Date`; binding an already-stringified `.toISOString()`
 * result throws `TypeError: value.toISOString is not a function` at write/query
 * time (#954: demand-graph 500s on 4 prod nights; #1033's first attempt hit the
 * same class on a `.set()` call).
 *
 * This is the OPPOSITE of the rule for raw node-postgres parameters (hand-written
 * `sql` templates / pool.query), where `date.toISOString()` is the CORRECT bind
 * (see .claude/rules/ist-timezone.md). So this check must NOT flag:
 *   - `.toISOString()` used inside a `sql`...`` template literal (raw pg path)
 *   - `.toISOString()` bound to a drizzle column declared with
 *     `{ mode: 'string' }` (that column's driver value IS a string)
 *   - a drizzle `date()` column (Postgres DATE, not TIMESTAMP; unaffected by
 *     this mechanism)
 *   - any `.toISOString()` call that is not an argument to a drizzle
 *     comparison operator (eq/ne/gt/gte/lt/lte/between/inArray/notInArray) or
 *     inside a `.set(...)` / `.values(...)` object literal
 *
 * Usage: node scripts/ci/check-drizzle-iso-string.mjs [--baseline]
 *   (no flags) - scan the real tree, fail (exit 1) on any NEW offender not in
 *                the committed baseline (scripts/ci/drizzle-iso-string-baseline.json)
 *   --baseline - print the current offender list as baseline JSON (for updating
 *                the baseline file when a legitimate exemption is added)
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'ci', 'drizzle-iso-string-baseline.json');

const OPERATOR_NAMES = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'inArray', 'notInArray',
];

const SCAN_DIRS = ['web', 'scraper/src', 'packages/shared/src', 'scripts'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const EXCLUDE_PATTERNS = [/\/node_modules\//, /\/dist\//, /\.test\.(ts|mjs|js)$/, /\/tests?\//];

/**
 * Strip `sql`...`` tagged template contents (and other template-literal
 * bodies) so a `.toISOString()` call written INSIDE a sql`` template — the
 * raw-pg path, where it is correct — is never matched by the operator-call
 * scan below. We only need to blank out `sql\`...\`` bodies specifically;
 * blanking ALL template literals would be safe too but risks hiding real
 * offenders written inside an unrelated template string, so we scope it to
 * `sql` tags (drizzle's raw-SQL helper) and any tag ending in `sql`.
 */
function stripSqlTemplates(source) {
  const len = source.length;
  // Find every `<ident>\`` where ident ends in sql/Sql, then blank until the
  // matching unescaped closing backtick (this is drizzle's raw-SQL tag, the
  // one path where .toISOString() bound to a string parameter is correct).
  const tagRe = /\b\w*[sS]ql\s*`/g;
  let lastIndex = 0;
  let result = '';
  let match;
  while ((match = tagRe.exec(source)) !== null) {
    const start = match.index;
    const backtickStart = match.index + match[0].length; // position right after opening `
    result += source.slice(lastIndex, backtickStart);
    // find matching closing backtick, respecting \` escapes and ${...} nesting depth of backticks (rare)
    let j = backtickStart;
    let depth = 0;
    while (j < len) {
      const ch = source[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`' && depth === 0) {
        break;
      }
      if (ch === '$' && source[j + 1] === '{') {
        depth++;
        j += 2;
        continue;
      }
      if (ch === '}' && depth > 0) {
        depth--;
      }
      j += 1;
    }
    // Blank the template body (replace with spaces, keep newlines for line numbers)
    const body = source.slice(backtickStart, j);
    result += body.replace(/[^\n]/g, ' ');
    lastIndex = j;
    tagRe.lastIndex = j;
  }
  result += source.slice(lastIndex);
  return result;
}

function listFiles() {
  const out = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => SCAN_DIRS.some((d) => f === d || f.startsWith(d + '/')))
    .filter((f) => FILE_EXTENSIONS.has(path.extname(f)))
    .filter((f) => !EXCLUDE_PATTERNS.some((re) => re.test('/' + f)));
}

/**
 * Classify every schema column by JS property name so the scan can tell a
 * default-mode (Date) `timestamp()` column — the one this class hits — apart
 * from a `date()` column (Postgres DATE, unaffected: drizzle's PgDate driver
 * value is already a string in its default mode) and a `timestamp(...,
 * { mode: 'string' })` column (also unaffected: that column's driver value IS
 * a string, matching what `.toISOString()` produces).
 *
 * A column name is only treated as "flaggable" when EVERY declaration of that
 * property name across the schema is a default-mode timestamp() — if the same
 * name is ever declared as date() or as timestamp(mode:'string') anywhere
 * (e.g. two different tables reusing "createdAt" differently), it is treated
 * as ambiguous and skipped, favouring a false negative over a false positive
 * that would block the PR gate on legitimate code.
 */
function loadColumnClassification(schemaSourceOverride) {
  let src = schemaSourceOverride;
  if (src === undefined) {
    const schemaPath = path.join(REPO_ROOT, 'packages', 'shared', 'src', 'db', 'schema.ts');
    if (!existsSync(schemaPath)) return new Set();
    src = readFileSync(schemaPath, 'utf8');
  }
  const perNameKinds = new Map(); // colName -> Set<'timestamp-default' | 'timestamp-string' | 'date' | 'other'>

  const declRe = /(\w+)\s*:\s*(timestamp|date)\(([^;]*?)\)(?=[,;\n]|\.\w)/g;
  let m;
  while ((m = declRe.exec(src)) !== null) {
    const [, colName, fnName, argsRaw] = m;
    // argsRaw may over-capture past this call's closing paren for nested
    // calls (e.g. .defaultNow()); trim to the first balanced-paren slice.
    let depth = 1;
    let end = 0;
    for (let k = 0; k < argsRaw.length; k++) {
      if (argsRaw[k] === '(') depth++;
      else if (argsRaw[k] === ')') {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    const args = end > 0 ? argsRaw.slice(0, end) : argsRaw;
    let kind;
    if (fnName === 'date') {
      kind = 'date';
    } else if (/mode\s*:\s*['"]string['"]/.test(args)) {
      kind = 'timestamp-string';
    } else {
      kind = 'timestamp-default';
    }
    if (!perNameKinds.has(colName)) perNameKinds.set(colName, new Set());
    perNameKinds.get(colName).add(kind);
  }

  const flaggable = new Set();
  for (const [colName, kinds] of perNameKinds) {
    if (kinds.size === 1 && kinds.has('timestamp-default')) {
      flaggable.add(colName);
    }
  }
  return flaggable;
}

function findOffenders(file, source, flaggableColumns) {
  const cleaned = stripSqlTemplates(source);
  const offenders = [];
  const lines = cleaned.split('\n');

  const opAlt = OPERATOR_NAMES.join('|');
  // Operator call form: opName( <col>, <expr>.toISOString() ...)  or  opName(<expr>.toISOString(), <col>)
  const opCallRe = new RegExp(
    `\\b(?:${opAlt})\\(\\s*([\\w.]+)\\s*,\\s*[^;]*?\\.toISOString\\(\\)`,
    'g'
  );
  const opCallReverseRe = new RegExp(
    `\\b(?:${opAlt})\\(\\s*[^,]*?\\.toISOString\\(\\)\\s*,\\s*([\\w.]+)\\s*\\)`,
    'g'
  );

  lines.forEach((line, idx) => {
    let m;
    opCallRe.lastIndex = 0;
    while ((m = opCallRe.exec(line)) !== null) {
      const colRef = m[1];
      const colName = colRef.split('.').pop();
      if (!flaggableColumns.has(colName)) continue;
      offenders.push({ file, line: idx + 1, text: line.trim(), colRef });
    }
    opCallReverseRe.lastIndex = 0;
    while ((m = opCallReverseRe.exec(line)) !== null) {
      const colRef = m[1];
      const colName = colRef.split('.').pop();
      if (!flaggableColumns.has(colName)) continue;
      offenders.push({ file, line: idx + 1, text: line.trim(), colRef });
    }
  });

  // .set({...}) / .values({...}) object-literal form, scanned across a small
  // multi-line window since these are usually multi-line object literals.
  const setValuesRe = /\.(set|values)\(\s*\{/g;
  let m2;
  setValuesRe.lastIndex = 0;
  while ((m2 = setValuesRe.exec(cleaned)) !== null) {
    // find the matching closing brace for this object literal (simple depth count)
    let j = m2.index + m2[0].length;
    let depth = 1;
    const objStart = j;
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === '{') depth++;
      else if (cleaned[j] === '}') depth--;
      j++;
    }
    const objBody = cleaned.slice(objStart, j - 1);
    const startLine = cleaned.slice(0, objStart).split('\n').length;
    const fieldRe = /(\w+)\s*:\s*[^,{}]*?\.toISOString\(\)/g;
    let fm;
    while ((fm = fieldRe.exec(objBody)) !== null) {
      const fieldName = fm[1];
      if (!flaggableColumns.has(fieldName)) continue;
      const lineOffset = objBody.slice(0, fm.index).split('\n').length - 1;
      offenders.push({
        file,
        line: startLine + lineOffset,
        text: fm[0].trim(),
        colRef: fieldName,
      });
    }
  }

  return offenders;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function keyOf(o) {
  return `${o.file}:${o.line}`;
}

function main() {
  const printBaseline = process.argv.includes('--baseline');
  const flaggableColumns = loadColumnClassification();
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
    if (!source.includes('.toISOString(')) continue;
    const offenders = findOffenders(relFile, source, flaggableColumns);
    allOffenders.push(...offenders);
  }

  if (printBaseline) {
    console.log(JSON.stringify(allOffenders.map(keyOf).sort(), null, 2));
    return;
  }

  const baseline = new Set(loadBaseline());
  const newOffenders = allOffenders.filter((o) => !baseline.has(keyOf(o)));
  const goneFromBaseline = [...baseline].filter(
    (k) => !allOffenders.some((o) => keyOf(o) === k)
  );

  if (goneFromBaseline.length > 0) {
    console.log(
      `[check-drizzle-iso-string] ${goneFromBaseline.length} baseline entr${goneFromBaseline.length === 1 ? 'y is' : 'ies are'} gone (fixed) — shrink scripts/ci/drizzle-iso-string-baseline.json:`
    );
    goneFromBaseline.forEach((k) => console.log(`  - ${k}`));
  }

  if (newOffenders.length > 0) {
    console.error(
      `[check-drizzle-iso-string] FAIL: ${newOffenders.length} new offender(s) — a ".toISOString()" ` +
        `string is bound to a drizzle query-builder operator or .set()/.values() field on what appears ` +
        `to be a default-mode (Date) timestamp() column. Drizzle calls .toISOString() itself on the ` +
        `value it receives, so binding a string throws TypeError at query time (class: ` +
        `iso-string-bound-to-drizzle-timestamp, #954). Pass a Date object instead, or if the column is ` +
        `genuinely { mode: 'string' } and this is a false positive, add the entry to ` +
        `scripts/ci/drizzle-iso-string-baseline.json with a reason.\n`
    );
    newOffenders.forEach((o) => {
      console.error(`  ${o.file}:${o.line}  ${o.text}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-drizzle-iso-string] PASS: 0 new offenders (${allOffenders.length} baseline entries carried forward)`
  );
}

export { stripSqlTemplates, loadColumnClassification, findOffenders, keyOf };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
