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
 * This is a ratchet. Round 2 (#1312) parses each file with the TypeScript compiler API instead of matching text:
 * a SINK is a property (object literal key, shorthand, `x.fooAt = v`, parameter default) named `*At`, `*_at`,
 * `timestamp` or `*Time`; its value is classified as the app clock (`Date.now()`, `new Date()`, `performance.now()`,
 * any alias of Date, local helper functions returning one, variables assigned from them, methods like
 * `.toISOString()` on them), the database clock (sql`now()`, readDatabaseNow imported from database-clock) or
 * UNRESOLVED (an imported or unknown call, a computed member): unresolved fails closed. It fails on any occurrence
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
import ts from 'typescript';

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

const MARKER_RE = /\/\/\s*app-clock-ok:\s*\S/;
// A sink: a property named like a timestamp (createdAt, resolved_at, timestamp, startTime).
const SINK_NAME_RE = /^(\w*At|\w*_at|timestamp|\w*Time)$/;
// A declaration `const createdAt = new Date()` is a sink too (it is then passed by name); `startTime` timers are not.
const DECLARATION_NAME_RE = /^(\w*At|\w*_at|timestamp)$/;
// A db-clock helper is allow-listed by IMPORT SOURCE, never by identifier text.
const DB_CLOCK_MODULE_RE = /(^|\/)database-clock(\.[jt]s)?$/;
const DB_CLOCK_EXPORTS = new Set(['readDatabaseNow']);
const SQL_MODULE_RE = /^drizzle-orm(\/.*)?$/;
// Schema / validation builders (timestamp('updated_at').defaultNow(), z.date()) describe a column, they hold no time.
const SCHEMA_MODULE_RE = /^(drizzle-orm|zod)(\/.*)?$/;
const DATE_RECEIVER_METHODS = new Set([
  'toISOString', 'toJSON', 'getTime', 'valueOf', 'toString', 'toUTCString', 'toDateString', 'toLocaleString',
  'toLocaleDateString', 'toLocaleTimeString', 'toTimeString',
  // string / number methods on the text or number a clock produced keep its origin
  'replace', 'replaceAll', 'split', 'slice', 'substring', 'substr', 'trim', 'padStart', 'padEnd', 'concat', 'toFixed', 'toLowerCase', 'toUpperCase',
]);
const PURE_GLOBAL_FNS = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat']);
// 'clock' = a Date object or ISO text made from the process clock; 'clock-num' = epoch milliseconds / a duration
// built from it (Date.now()). Both are sink violations; only 'clock' is also flagged under a non-timestamp key.
const RANK = { safe: 0, unresolved: 1, 'clock-num': 2, clock: 3 };
const isClockKind = (k) => k === 'clock' || k === 'clock-num';
const join = (...ks) => ks.reduce((a, k) => (RANK[k] > RANK[a] ? k : a), 'safe');

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (EXTENSIONS.has(path.extname(name))) out.push(abs);
  }
}

function unwrap(e) {
  while (
    e &&
    (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e) || ts.isAwaitExpression(e))
  ) {
    e = e.expression;
  }
  return e;
}

const nameOfKey = (n) =>
  ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n) ? n.text : null;

/**
 * Structural analysis of one file (#1312 round 2). Classifies the value of every timestamp-named sink as
 * 'clock' (the process clock reaches it), 'unresolved' (a call or computed member the scan cannot follow;
 * fails closed) or 'safe' (database clock, literal, or plain data). Bindings are name-keyed per file, not
 * scope-aware, which errs toward flagging.
 */
function analyze(sf) {
  const bindings = new Map(); // name -> [{ init, destructured }]
  const imports = new Map(); // local name -> { source, imported }
  const fnNodes = new Map(); // local function name -> [function-like nodes]
  const dateAliases = new Set(['Date']);
  const add = (map, k, v) => (map.has(k) ? map.get(k).push(v) : map.set(k, [v]));

  const patternNames = (pat, out) => {
    if (ts.isIdentifier(pat)) out.push(pat);
    else if (ts.isObjectBindingPattern(pat) || ts.isArrayBindingPattern(pat)) {
      for (const el of pat.elements) if (ts.isBindingElement(el)) patternNames(el.name, out);
    }
    return out;
  };

  const collect = (n) => {
    if (ts.isImportDeclaration(n) && n.importClause && ts.isStringLiteral(n.moduleSpecifier)) {
      const source = n.moduleSpecifier.text;
      const c = n.importClause;
      if (c.name) imports.set(c.name.text, { source, imported: 'default' });
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) imports.set(c.namedBindings.name.text, { source, imported: '*' });
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const el of c.namedBindings.elements) imports.set(el.name.text, { source, imported: (el.propertyName ?? el.name).text });
      }
    } else if (ts.isVariableDeclaration(n) && n.initializer) {
      if (ts.isIdentifier(n.name)) {
        add(bindings, n.name.text, { init: n.initializer, destructured: false });
        const init = unwrap(n.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) add(fnNodes, n.name.text, init);
      } else {
        for (const id of patternNames(n.name, [])) add(bindings, id.text, { init: n.initializer, destructured: true });
      }
    } else if (ts.isFunctionDeclaration(n) && n.name) {
      add(fnNodes, n.name.text, n);
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
      add(bindings, n.left.text, { init: n.right, destructured: false });
    } else if (ts.isClassDeclaration(n) && n.name && n.heritageClauses) {
      for (const h of n.heritageClauses) {
        if (h.token === ts.SyntaxKind.ExtendsKeyword) for (const t of h.types) add(bindings, n.name.text, { init: t.expression, destructured: false });
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  // Names bound to Date (const D = Date; globalThis.Date; { Date: D } = globalThis; class D extends Date), to a fixpoint.
  const isGlobalRoot = (e) => ts.isIdentifier(e) && ['globalThis', 'global', 'window', 'self'].includes(e.text);
  const isDateRef = (raw) => {
    const e = unwrap(raw);
    if (ts.isIdentifier(e)) return dateAliases.has(e.text);
    return ts.isPropertyAccessExpression(e) && isGlobalRoot(e.expression) && e.name.text === 'Date';
  };
  const walkDestructure = (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name) && isGlobalRoot(unwrap(n.initializer))) {
      for (const el of n.name.elements) {
        if (ts.isIdentifier(el.name) && (el.propertyName ? nameOfKey(el.propertyName) : el.name.text) === 'Date') dateAliases.add(el.name.text);
      }
    }
    ts.forEachChild(n, walkDestructure);
  };
  walkDestructure(sf);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, list] of bindings) {
      if (dateAliases.has(name)) continue;
      if (list.some((b) => !b.destructured && isDateRef(b.init))) {
        dateAliases.add(name);
        grew = true;
      }
    }
  }

  const importOf = (id) => imports.get(id.text);
  const isDbClockImport = (id) => {
    const imp = importOf(id);
    return !!imp && DB_CLOCK_MODULE_RE.test(imp.source) && DB_CLOCK_EXPORTS.has(imp.imported);
  };
  const isSqlTag = (raw) => {
    const e = unwrap(raw);
    if (ts.isIdentifier(e)) {
      const imp = importOf(e);
      return !!imp && SQL_MODULE_RE.test(imp.source) && imp.imported === 'sql';
    }
    return ts.isPropertyAccessExpression(e) && e.name.text === 'raw' && isSqlTag(e.expression);
  };

  // `Date.now`, `performance.now`, `const f = Date.now`.
  const visitingFn = new Set();
  const isClockFn = (raw) => {
    const e = unwrap(raw);
    if (ts.isPropertyAccessExpression(e)) {
      const base = unwrap(e.expression);
      const isPerf =
        (ts.isIdentifier(base) && base.text === 'performance') ||
        (ts.isPropertyAccessExpression(base) && base.name.text === 'performance' && isGlobalRoot(base.expression));
      return e.name.text === 'now' && (isDateRef(base) || isPerf);
    }
    if (ts.isIdentifier(e) && !visitingFn.has(e.text)) {
      visitingFn.add(e.text);
      const r = (bindings.get(e.text) ?? []).some((b) => !b.destructured && isClockFn(b.init));
      visitingFn.delete(e.text);
      return r;
    }
    return false;
  };

  const returnsOf = (fn) => {
    if (!fn.body) return [];
    if (!ts.isBlock(fn.body)) return [fn.body];
    const out = [];
    const rec = (n) => {
      if (ts.isFunctionLike(n) && n !== fn) return;
      if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
      ts.forEachChild(n, rec);
    };
    rec(fn.body);
    return out;
  };

  const visiting = new Set();
  const guard = (key, f) => {
    if (visiting.has(key)) return 'safe';
    visiting.add(key);
    try {
      return f();
    } finally {
      visiting.delete(key);
    }
  };

  const kindOfIdentifier = (id) => {
    if (id.text === 'undefined' || id.text === 'NaN' || id.text === 'Infinity') return 'safe';
    const list = bindings.get(id.text);
    if (!list) return 'safe'; // a parameter, an import, a global: data, not a local clock
    return guard('id:' + id.text, () => join('safe', ...list.map((b) => kindOf(b.init))));
  };

  const rootIdentifier = (raw) => {
    let e = unwrap(raw);
    while (e && (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e))) e = unwrap(e.expression);
    return e && ts.isIdentifier(e) ? e : null;
  };

  const kindOfCall = (call) => {
    const callee = unwrap(call.expression);
    const root = rootIdentifier(callee);
    if (root && imports.has(root.text) && SCHEMA_MODULE_RE.test(imports.get(root.text).source) && !isSqlTag(root)) return 'safe';
    const args = () => join('safe', ...call.arguments.map((a) => kindOf(a)));
    if (isClockFn(callee)) return 'clock-num';
    if (ts.isIdentifier(callee)) {
      if (dateAliases.has(callee.text)) return 'clock'; // Date() called as a function returns the current time
      if (isDbClockImport(callee) || isSqlTag(callee)) return 'safe';
      if (PURE_GLOBAL_FNS.has(callee.text) && !bindings.has(callee.text) && !imports.has(callee.text)) return args();
      const fns = fnNodes.get(callee.text);
      if (fns) return guard('fn:' + callee.text, () => join('safe', ...fns.flatMap((f) => returnsOf(f).map((r) => kindOf(r)))));
      return 'unresolved';
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const base = unwrap(callee.expression);
      if (ts.isIdentifier(base) && base.text === 'Math') return args();
      if (isDateRef(base) && (callee.name.text === 'parse' || callee.name.text === 'UTC')) return args();
      if (DATE_RECEIVER_METHODS.has(callee.name.text)) {
        const k = kindOf(base);
        return k === 'clock' && (callee.name.text === 'getTime' || callee.name.text === 'valueOf') ? 'clock-num' : k;
      }
      if (isSqlTag(callee)) return 'safe';
      return 'unresolved';
    }
    return 'unresolved';
  };

  function kindOf(raw) {
    const e = unwrap(raw);
    if (!e) return 'safe';
    if (ts.isIdentifier(e)) return kindOfIdentifier(e);
    if (ts.isNewExpression(e)) {
      if (isDateRef(e.expression)) {
        const args = e.arguments ?? [];
        if (args.length === 0) return 'clock';
        const k = join('safe', ...args.map((a) => kindOf(a)));
        return isClockKind(k) ? 'clock' : k;
      }
      return 'unresolved';
    }
    if (ts.isCallExpression(e)) return kindOfCall(e);
    if (ts.isTaggedTemplateExpression(e)) return isSqlTag(e.tag) ? 'safe' : 'unresolved';
    if (ts.isPropertyAccessExpression(e)) {
      const base = unwrap(e.expression);
      return e.name.text === 'timeOrigin' && ts.isIdentifier(base) && base.text === 'performance' ? 'clock-num' : 'safe';
    }
    if (ts.isElementAccessExpression(e)) {
      const a = e.argumentExpression && unwrap(e.argumentExpression);
      if (!a || !(ts.isStringLiteralLike(a) || ts.isNumericLiteral(a))) return 'unresolved';
      const k = kindOf(e.expression);
      return isClockKind(k) ? k : 'safe'; // a Date's ISO string sliced to its date part is still the app clock
    }
    if (ts.isBinaryExpression(e)) {
      const k = join(kindOf(e.left), kindOf(e.right));
      const arithmetic = [ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken];
      return k === 'clock' && arithmetic.includes(e.operatorToken.kind) ? 'clock-num' : k;
    }
    if (ts.isConditionalExpression(e)) return join(kindOf(e.whenTrue), kindOf(e.whenFalse));
    if (ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) return kindOf(e.operand);
    if (ts.isTemplateExpression(e)) {
      const k = join('safe', ...e.templateSpans.map((s) => kindOf(s.expression)));
      return k === 'clock' ? 'clock-num' : k; // text that embeds the time is not itself a time value
    }
    if (
      ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isBigIntLiteral(e) || ts.isObjectLiteralExpression(e) ||
      ts.isArrayLiteralExpression(e) || ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isRegularExpressionLiteral(e) ||
      ts.isVoidExpression(e) || ts.isTypeOfExpression(e) || e.kind === ts.SyntaxKind.NullKeyword ||
      e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.ThisKeyword
    ) {
      return 'safe';
    }
    return 'unresolved';
  }

  return { kindOf };
}

/** Offenders in one file's source: [{ file, line, text, column, kind }]. kind is 'clock' or 'unresolved'. */
export function findOffenders(file, source) {
  const scriptKind = /\.m?js$/.test(file) ? ts.ScriptKind.JS : file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = source.split(/\r?\n/);
  const { kindOf } = analyze(sf);
  const out = [];
  const report = (nameNode, valueExpr, column, clockOnly = false) => {
    const kind = kindOf(valueExpr);
    if (kind === 'safe' || (clockOnly && !isClockKind(kind))) return;
    const i = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line;
    if (MARKER_RE.test(lines[i]) || (i > 0 && MARKER_RE.test(lines[i - 1]))) return;
    out.push({ file, line: i + 1, text: lines[i].trim(), column, kind: kind === 'unresolved' ? 'unresolved' : 'clock' });
  };
  const visit = (n) => {
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isComputedPropertyName(n.name)
        ? ts.isStringLiteralLike(n.name.expression) ? n.name.expression.text : null
        : nameOfKey(n.name);
      if (key !== null && SINK_NAME_RE.test(key)) report(n.name, n.initializer, key);
      else if (key === null && isClockKind(kindOf(n.initializer))) report(n.name, n.initializer, '[computed]');
      // The same Date held under a key that is not named like a timestamp (`lastUpdated: new Date()`, `at: now`).
      else if (key !== null && kindOf(n.initializer) === 'clock') report(n.name, n.initializer, key);
    } else if (ts.isShorthandPropertyAssignment(n)) {
      if (SINK_NAME_RE.test(n.name.text)) report(n.name, n.name, n.name.text);
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = n.left;
      const key = ts.isPropertyAccessExpression(l)
        ? l.name.text
        : ts.isElementAccessExpression(l) && ts.isStringLiteralLike(l.argumentExpression) ? l.argumentExpression.text : null;
      if (key !== null && SINK_NAME_RE.test(key)) report(l, n.right, key);
    } else if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) && DECLARATION_NAME_RE.test(n.name.text)) {
      report(n.name, n.initializer, n.name.text, true);
    } else if (ts.isParameter(n) && n.initializer && ts.isIdentifier(n.name) && SINK_NAME_RE.test(n.name.text)) {
      report(n.name, n.initializer, n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
        'in the statement or readDatabaseNow(tx). [unresolved] means a call or computed member the scan cannot follow: ' +
        'use a db-clock helper, or prove it is not the app clock. If this value is never compared with a database time (a response ' +
        'field, a cache score), mark the line `// app-clock-ok: <reason>`.'
    );
    fresh.forEach((o) => console.error(`  ${o.file}:${o.line}  [${o.kind}]  ${o.text}`));
    process.exitCode = 1;
    return;
  }
  if (stale.length > 0) return;
  console.log(`[check-app-clock-timestamps] PASS: 0 new offenders (${offenders.length} baselined across ${SCAN_DIRS.length} trees)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
