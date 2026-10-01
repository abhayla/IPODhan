#!/usr/bin/env node
// #1150: every script that can WRITE the database must open it through
// openRepairDb() (scraper/scripts/lib/repair-tool.ts) — the prod guard,
// --expect-db check and dry-run default — whatever the script is CALLED.
//
// Why: require-repair-tool-module.mjs (T-490) only checks files named
// `(repair|backfill|refresh|requeue)-*.ts` under scraper/scripts. Scripts that
// write the DB under any other name (add-missing-registrars-t300.ts inserts,
// reclassify-trust-shape-ipos-t277.ts updates, six under scraper/src/scripts)
// carried no guard and no lint looked at them. This check finds writers by
// what they DO, not by their filename.
//
// What counts (all decided on the TypeScript AST, never by regex over source):
//   DB reach  — the file imports a DB client by import SOURCE (pg, postgres,
//               drizzle-orm/node-postgres|postgres-js, @ipodhan/shared barrel,
//               @ipodhan/shared/db, a relative path into a db/ module), or
//               imports a relative module that transitively does. A dynamic
//               import()/require() whose specifier is not a literal is
//               UNRESOLVED and counts as DB reach (fail closed).
//   Write     — a `.insert(` / `.update(` / `.delete(` call (receivers that are
//               provably not a DB handle — `new Map/Set/...`, createHash(),
//               URLSearchParams/Headers — are excluded; anything else counts),
//               raw DML text (INSERT INTO / UPDATE .. SET / DELETE FROM /
//               TRUNCATE / ALTER|DROP|CREATE TABLE ...) in any string or
//               template literal, or `.execute(`/`.query(` whose SQL argument
//               is not a literal (UNRESOLVED -> write, fail closed).
//   Indirect  — the file imports a RELATIVE module that transitively reaches a
//               DB client and calls into it. What that module does with the
//               handle is not visible here, so it is a possible writer (fail
//               closed).
// A file with DB reach and a direct or indirect write must call openRepairDb()
// imported from lib/repair-tool, carry `// repair-tool-exempt: <date> <reason>`,
// or be listed in scripts/ci/db-writer-guard-baseline.json with a reason.
// The baseline is shrink-only: a listed file that no longer needs the entry
// fails the check, so it cannot rot.
//
// Usage: node scripts/ci/require-db-writer-guard.mjs [rootDir]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  callsGuardEntryPoint,
  EXEMPTION_PATTERN,
  importsRepairToolModule,
  parseSource,
} from './require-repair-tool-module.mjs';

export const SCAN_DIRS = [path.join('scraper', 'scripts'), path.join('scraper', 'src', 'scripts')];
export const BASELINE_PATH = path.join('scripts', 'ci', 'db-writer-guard-baseline.json');

const SCRIPT_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/;
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]s$|\.d\.ts$/;
/** lib/ holds the helpers the tools call (repair-tool.ts itself writes); fixtures/data are not code. */
const SKIP_DIRS = new Set(['lib', 'fixtures', 'data', 'node_modules', '__tests__', 'tests', '__pycache__']);

/** Import sources that hand the file a DB client. Matched on the SPECIFIER, never on an identifier. */
const DB_SOURCE_PATTERNS = [
  /^(pg|postgres|pg-pool)$/,
  /^drizzle-orm\/(node-postgres|postgres-js|pg-proxy|neon-serverless|vercel-postgres)(\/.*)?$/,
  /^@ipodhan\/shared(\/index)?(\.js)?$/, // the barrel re-exports `db` / pool helpers
  /^@ipodhan\/shared\/db(\/index)?(\.js)?$/,
  /^@ipodhan\/shared\/(db\/)?(connection|client|pool)(\.js)?$/,
  /(^|\/)db(\/index)?(\.[cm]?[jt]s)?$/, // relative `../db`, `../../packages/shared/src/db/index`
  /packages\/shared\/src(\/index)?(\.[cm]?[jt]s)?$/,
];

export function isDbSource(specifier) {
  return DB_SOURCE_PATTERNS.some((re) => re.test(specifier));
}

/** Raw DML/DDL that changes data or schema. Case-insensitive on purpose (fail closed). */
export const DML_PATTERN =
  /\b(insert\s+into|update\s+[\w".]+\s+set|delete\s+from|truncate\s+(table\s+)?[\w"]|merge\s+into|(alter|drop)\s+(table|index|schema|column|type|view)|create\s+(unique\s+)?(table|index|schema|type|view))\b/i;

const WRITE_METHODS = new Set(['insert', 'update', 'delete']);
const SQL_RUN_METHODS = new Set(['execute', 'query']);
const NON_DB_CONSTRUCTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'URLSearchParams', 'Headers', 'FormData']);
const NON_DB_FACTORIES = new Set(['createHash', 'createHmac', 'createCipheriv', 'createDecipheriv', 'createSign', 'createVerify']);
const NON_DB_PROPERTY_RECEIVERS = new Set(['searchParams', 'headers']);

function moduleSpecifiersOf(sourceFile) {
  /** @type {{spec: string|null, kind: string}[]} */
  const out = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) {
        // `import type` brings no runtime client.
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (!typeOnly) out.push({ spec: node.moduleSpecifier.text, kind: 'static' });
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const e = node.moduleReference.expression;
      out.push({ spec: e && ts.isStringLiteralLike(e) ? e.text : null, kind: 'require' });
    } else if (ts.isCallExpression(node)) {
      const isDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynImport || isRequire) {
        const a = node.arguments[0];
        const literal = a && (ts.isStringLiteralLike(a) || ts.isNoSubstitutionTemplateLiteral(a));
        out.push({ spec: literal ? a.text : null, kind: isDynImport ? 'dynamic' : 'require' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** Names bound (anywhere in the file) to a value that is provably not a DB handle. */
function nonDbBindings(sourceFile) {
  const nonDb = new Set();
  const other = new Set();
  const isNonDbInit = (init) => {
    if (!init) return false;
    if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) return NON_DB_CONSTRUCTORS.has(init.expression.text);
    if (ts.isCallExpression(init)) {
      const c = init.expression;
      const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
      return name !== null && NON_DB_FACTORIES.has(name);
    }
    return false;
  };
  const visit = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && ts.isIdentifier(node.name)) {
      (isNonDbInit(node.initializer) ? nonDb : other).add(node.name.text);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      other.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  // A name declared twice with different kinds is ambiguous: fail closed (treat as possibly DB).
  for (const n of other) nonDb.delete(n);
  return nonDb;
}

function receiverIsProvablyNonDb(receiver, nonDb) {
  let r = receiver;
  while (ts.isParenthesizedExpression(r) || ts.isAsExpression(r) || ts.isNonNullExpression(r)) r = r.expression;
  if (ts.isNewExpression(r) && ts.isIdentifier(r.expression)) return NON_DB_CONSTRUCTORS.has(r.expression.text);
  if (ts.isCallExpression(r)) {
    const c = r.expression;
    const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
    return name !== null && NON_DB_FACTORIES.has(name);
  }
  if (ts.isIdentifier(r)) return nonDb.has(r.text);
  if (ts.isPropertyAccessExpression(r)) {
    if (NON_DB_PROPERTY_RECEIVERS.has(r.name.text)) return true;
    // `this.cache.delete(...)` where `cache = new Map()` is a class property.
    if (r.expression.kind === ts.SyntaxKind.ThisKeyword) return nonDb.has(r.name.text);
  }
  return false;
}

function literalText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
  if (ts.isTaggedTemplateExpression(node)) return literalText(node.template);
  return null;
}

/** Direct write evidence in one file: a list of short reasons (empty = none found). */
export function findWriteEvidence(sourceFile) {
  const nonDb = nonDbBindings(sourceFile);
  const reasons = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name = null;
      let receiver = null;
      if (ts.isPropertyAccessExpression(callee)) {
        name = callee.name.text;
        receiver = callee.expression;
      } else if (ts.isElementAccessExpression(callee)) {
        receiver = callee.expression;
        const arg = callee.argumentExpression;
        // `db['ins' + 'ert'](...)`: a computed method name cannot be resolved -> fail closed.
        name = ts.isStringLiteralLike(arg) ? arg.text : '<computed>';
      }
      if (name !== null) {
        if ((WRITE_METHODS.has(name) || name === '<computed>') && !receiverIsProvablyNonDb(receiver, nonDb)) {
          reasons.push(`line ${lineOf(node)}: .${name}( call`);
        } else if (SQL_RUN_METHODS.has(name) && !receiverIsProvablyNonDb(receiver, nonDb)) {
          const a = node.arguments[0];
          if (a) {
            const text = literalText(a);
            if (text === null && !(ts.isObjectLiteralExpression(a))) {
              reasons.push(`line ${lineOf(node)}: .${name}( with a non-literal SQL argument (unresolved)`);
            }
          }
        }
      }
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const text = literalText(node);
      if (text && DML_PATTERN.test(text)) reasons.push(`line ${lineOf(node)}: raw DML "${text.match(DML_PATTERN)[0]}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return reasons;
}

const RESOLVE_EXTS = ['', '.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '/index.ts', '/index.js', '/index.mjs'];

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  for (const ext of RESOLVE_EXTS) candidates.push(base + ext);
  // TS ESM style: `./x.js` written for `./x.ts`.
  if (/\.[cm]?js$/.test(base)) {
    const stem = base.replace(/\.[cm]?js$/, '');
    candidates.push(stem + '.ts', stem + '.mts', stem + '.cts');
  }
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Does `file` reach a DB client, directly or through relative imports?
 * Returns { reach: boolean, via: string|null }. An unresolvable relative
 * import or a non-literal dynamic specifier counts as reach (fail closed).
 */
export function makeReachResolver(readFile = (f) => readFileSync(f, 'utf-8')) {
  const cache = new Map();
  const reach = (file, stack = new Set()) => {
    if (cache.has(file)) return cache.get(file);
    if (stack.has(file)) return { reach: false, via: null };
    stack.add(file);
    let result = { reach: false, via: null };
    let source;
    try {
      source = readFile(file);
    } catch {
      result = { reach: true, via: `${file} (unreadable)` };
      cache.set(file, result);
      return result;
    }
    const sf = parseSource(file, source);
    for (const { spec } of moduleSpecifiersOf(sf)) {
      if (spec === null) {
        result = { reach: true, via: 'a dynamic import/require with a non-literal specifier (unresolved)' };
        break;
      }
      if (isDbSource(spec)) {
        result = { reach: true, via: spec };
        break;
      }
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target === null) {
          result = { reach: true, via: `${spec} (unresolved relative import)` };
          break;
        }
        const sub = reach(target, stack);
        if (sub.reach) {
          result = { reach: true, via: `${spec} -> ${sub.via}` };
          break;
        }
      }
    }
    stack.delete(file);
    cache.set(file, result);
    return result;
  };
  return reach;
}

/**
 * Classify ONE script file. `absPath` is used only to resolve relative
 * imports; `reachOf` is a resolver from makeReachResolver().
 */
export function classifyDbWriterFile(absPath, source, reachOf) {
  const sf = parseSource(absPath, source);
  const specs = moduleSpecifiersOf(sf);

  let directDb = null;
  const indirect = [];
  for (const { spec } of specs) {
    if (spec === null) {
      directDb ??= 'a dynamic import/require with a non-literal specifier (unresolved)';
      continue;
    }
    if (isDbSource(spec)) {
      directDb ??= spec;
      continue;
    }
    if (spec.startsWith('.') && !/lib\/repair-tool(\.js)?$/.test(spec)) {
      const target = resolveRelative(absPath, spec);
      if (target === null) {
        indirect.push(`${spec} (unresolved relative import)`);
        continue;
      }
      const r = reachOf(target);
      if (r.reach) indirect.push(`${spec} -> ${r.via}`);
    }
  }

  const guarded = importsRepairToolModule(sf) && callsGuardEntryPoint(sf);
  const writes = directDb || indirect.length > 0 ? findWriteEvidence(sf) : [];

  let kind = null;
  if (writes.length > 0 && (directDb || indirect.length > 0)) kind = 'direct-write';
  else if (indirect.length > 0) kind = 'indirect';
  if (kind === null) return { verdict: directDb ? 'db-read-only' : 'not-db' };
  if (guarded) return { verdict: 'ok', kind };

  const exemption = source.match(EXEMPTION_PATTERN);
  if (exemption) return { verdict: 'exempt', kind, date: exemption[1], reason: exemption[2].trim() };

  const evidence =
    kind === 'direct-write'
      ? `writes the DB (${writes.slice(0, 3).join('; ')}${writes.length > 3 ? `; +${writes.length - 3} more` : ''})`
      : `calls into module(s) that reach a DB client (${indirect.slice(0, 2).join('; ')}), so it may write through them`;
  return { verdict: 'violation', kind, evidence };
}

export function listScriptFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
      } else if (SCRIPT_EXT.test(name) && !SKIP_FILE.test(name)) {
        out.push(full);
      }
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(root, d));
  return out;
}

export function toPosixRel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Pure evaluation against a baseline: returns { violations, stale, exempt, ok }. */
export function evaluate(results, baseline) {
  const listed = new Map((baseline.entries ?? []).map((e) => [e.file, e]));
  const violations = [];
  const stale = [];
  const baselined = [];
  for (const [file, r] of results) {
    if (r.verdict === 'violation') {
      if (listed.has(file)) baselined.push(file);
      else violations.push(`${file} ${r.evidence}. Open the DB through openRepairDb() from scraper/scripts/lib/repair-tool.ts, or declare "// repair-tool-exempt: YYYY-MM-DD <reason>".`);
    }
  }
  for (const [file, entry] of listed) {
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      violations.push(`baseline entry ${file} has no reason (20+ chars required)`);
    }
    const r = results.get(file);
    if (!r || r.verdict !== 'violation') stale.push(`${file} is in the baseline but ${r ? `is now "${r.verdict}"` : 'no longer exists'} — remove the entry (the baseline only shrinks)`);
  }
  return { violations, stale, baselined };
}

function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const files = listScriptFiles(root);
  const reachOf = makeReachResolver();
  const results = new Map();
  for (const f of files) results.set(toPosixRel(root, f), classifyDbWriterFile(f, readFileSync(f, 'utf-8'), reachOf));
  const baselineFile = path.join(root, BASELINE_PATH);
  const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf-8')) : { entries: [] };
  const { violations, stale, baselined } = evaluate(results, baseline);

  const count = (v) => [...results.values()].filter((r) => r.verdict === v).length;
  console.log(
    `[require-db-writer-guard] ${files.length} script(s) in ${SCAN_DIRS.join(', ')}: ` +
      `${count('ok')} guarded, ${count('exempt')} exempt, ${baselined.length} baselined, ` +
      `${count('db-read-only')} db-read-only, ${count('not-db')} not-db`,
  );
  const problems = [...violations, ...stale];
  if (problems.length > 0) {
    console.error(`[require-db-writer-guard] ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('[require-db-writer-guard] OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
