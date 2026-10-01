#!/usr/bin/env node
/**
 * #1142 round 2: TWO layers, one baseline.
 *   Layer 1 (structural, the guarantee): every pg / postgres.js client is built
 *     by one sanctioned module per package - scripts/ci/pg-construction-sites.mjs
 *     (SANCTIONED_MODULES). A construction anywhere else, in ANY tracked code
 *     file including tests/, is an offender whatever values it is given, keyed
 *     by import source and followed through aliases, require, import(),
 *     re-exports and drizzle's own drivers; unresolvable shapes fail closed.
 *   Layer 2 (value, second layer, kept because it is cheap): the #640 checks
 *     below, on non-test code - they still catch a literal target handed to a
 *     sanctioned helper (createUtcPool({ database: 'ipodhan' })).
 * The baseline is SHRINK-ONLY: an entry whose offender is gone FAILS the run
 * until it is removed, so a fixed site cannot silently become a free slot.
 *
 * Detection check for #640: a pg connection field read from
 * `process.env.DATABASE_NAME` / `process.env.DATABASE_USER` (or `env.X` where
 * `env = process.env`) that silently DEFAULTS to a literal when the env var
 * is unset. For DATABASE_NAME the observed literal was 'ipodhan' — the
 * PRODUCTION database — and for DATABASE_USER it was 'postgres' — the
 * superuser. A script run through the tunnel (DATABASE_HOST set) that
 * forgets either variable then connects to prod, as the superuser, with no
 * error.
 *
 * AST-based (TypeScript compiler API, already a repo dependency — see
 * scripts/ci/require-repair-tool-module.mjs for the existing precedent),
 * not a regex: #640 round 2 review found a regex-only version missed a
 * backtick-template default, a destructuring default (plain and aliased), a
 * `process.env['DATABASE_NAME']` element access, a named-constant default, a
 * default split across lines, and a ternary. This check parses each file
 * into an AST and recognizes the DEFAULTING SHAPE regardless of how the env
 * read and the literal are spelled or laid out:
 *   - `X || 'lit'` / `X ?? 'lit'`               (any whitespace/newlines — AST)
 *   - `` X || `lit` ``                           (template literal default)
 *   - `const { DATABASE_NAME = 'lit' } = process.env`            (destructure)
 *   - `const { DATABASE_NAME: db = 'lit' } = process.env`  (aliased destructure)
 *   - `process.env['DATABASE_NAME'] || 'lit'`                (element access)
 *   - `const DEFAULT = 'lit'; ... || DEFAULT`         (named-constant default,
 *     resolved via a same-file `const NAME = 'literal'` lookup)
 *   - `X ? X : 'lit'` / `!X ? 'lit' : X`                        (ternary)
 * where X is a direct read of DATABASE_NAME or DATABASE_USER off
 * `process.env` (or a local `env` alias). An empty-string default (`|| ''`)
 * is NOT flagged — it fails differently (an empty/invalid target), never
 * silently to a named database or role; several call sites in this repo use
 * `env.DATABASE_NAME || env.PGDATABASE || ''` deliberately (falls through to
 * another env var, never a hardcoded name).
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
import ts from 'typescript';
import { findConstructionSites } from './pg-construction-sites.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'ci', 'db-connection-defaults-baseline.json');

// #1142: the whole tracked tree. The database/ directory and root scripts held
// hard-coded production targets outside the old six scan directories.
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const PREFILTER = /DATABASE_NAME|DATABASE_USER|PGDATABASE|PGUSER|postgres|database|user/;
const EXCLUDE_PATTERNS = [
  /^\/docs\//,
  /\/fixtures?\//,
  /\/node_modules\//,
  /\.test\.(ts|mjs|js)$/,
  /\/tests?\//,
  // Documents the old (fixed) shape in a comment, and defines the resolver
  // itself — it is not a connection-building call site.
  /\/lib\/pg-connection-params\.mjs$/,
  // This detector's own source quotes the offending shapes to document them.
  /\/ci\/check-db-connection-defaults\.mjs$/,
];

// #1142: PGDATABASE / PGUSER are libpq's own target variables; a default on
// them picks a connection target exactly like DATABASE_NAME / DATABASE_USER.
const TARGET_VARS = new Set(['DATABASE_NAME', 'DATABASE_USER', 'PGDATABASE', 'PGUSER']);
// `env` keeps its pre-#1142 meaning (a local alias of process.env by name);
// every OTHER alias is resolved structurally from its declaration below.
const ENV_OBJECT_NAMES = new Set(['env']);
// Keys that make an object literal a connection config (pg Pool/Client, a
// knex/drizzle connection block). A `user:` key alone is not enough.
const CONNECTION_KEYS = new Set(['host', 'port', 'password', 'connectionString']);
const TARGET_KEYS = new Set(['database', 'user']);
const PG_URL_FULL = /^postgres(?:ql)?:\/\/\S*\/[A-Za-z_][\w-]*(?:\?\S*)?$/;
const PG_URL_HEAD = /^postgres(?:ql)?:\/\//;
const PG_URL_TAIL = /\/[A-Za-z_][\w-]*(?:\?\S*)?$/;
const OR_KINDS = new Set([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
const OR_ASSIGN_KINDS = new Set([ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);

const LAYER1_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
// Layer 1 parses only files that could import a driver or load a module.
export const LAYER1_PREFILTER = /\bpg\b|postgres|drizzle|require|import\s*\(/i;

function trackedFiles() {
  const out = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter((f) => !/(^|\/)node_modules\//.test(f));
}

function listFiles(all = trackedFiles()) {
  return all
    .filter((f) => FILE_EXTENSIONS.has(path.extname(f)))
    .filter((f) => !EXCLUDE_PATTERNS.some((re) => re.test('/' + f)));
}

/** Strip every wrapper that does not change the runtime value: parentheses,
 * `as T`, `<T>x`, `x!`, `x satisfies T`. (#1142: each one hid an env read.) */
export function unwrap(expr) {
  let e = expr;
  while (
    e &&
    (ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isSatisfiesExpression(e))
  ) {
    e = e.expression;
  }
  return e;
}

/** Non-empty string value of a literal-like node, or undefined if not one. */
function literalStringValue(node) {
  const e = unwrap(node);
  if (!e) return undefined;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  // A template WITH substitutions is a computed-but-fixed-shape default
  // (`` `ipodhan_${suffix}` ``) — flag it.
  if (ts.isTemplateExpression(e)) return '<template>';
  return undefined;
}

function isProcessIdentifier(expr) {
  const e = unwrap(expr);
  if (!e) return false;
  if (ts.isIdentifier(e)) return e.text === 'process';
  const inner = ts.isPropertyAccessExpression(e) ? unwrap(e.expression) : undefined;
  return Boolean(inner && e.name.text === 'process' && ts.isIdentifier(inner) && inner.text === 'globalThis');
}

function bindingPropName(el) {
  if (el.propertyName) {
    if (ts.isIdentifier(el.propertyName) || ts.isStringLiteralLike(el.propertyName)) return el.propertyName.text;
    return undefined;
  }
  return ts.isIdentifier(el.name) ? el.name.text : undefined;
}

function isEnvObject(expr, ctx) {
  const e = unwrap(expr);
  if (!e) return false;
  if (ts.isIdentifier(e)) return ctx.envAliases.has(e.text);
  // process.env, process?.env (optional chains are PropertyAccessExpressions
  // with a questionDotToken), globalThis.process.env, process['env'].
  if (ts.isPropertyAccessExpression(e) && e.name.text === 'env') return isProcessIdentifier(e.expression);
  if (
    ts.isElementAccessExpression(e) &&
    ts.isStringLiteralLike(e.argumentExpression) &&
    e.argumentExpression.text === 'env'
  ) {
    return isProcessIdentifier(e.expression);
  }
  return false;
}

/** The variable name read off the env object ('<computed>' for a non-literal
 * key), or undefined when `expr` is not an env read. */
function anyEnvRead(expr, ctx) {
  const e = unwrap(expr);
  if (!e) return undefined;
  if (ts.isPropertyAccessExpression(e) && isEnvObject(e.expression, ctx)) return e.name.text;
  if (ts.isElementAccessExpression(e) && isEnvObject(e.expression, ctx)) {
    return ts.isStringLiteralLike(e.argumentExpression) ? e.argumentExpression.text : '<computed>';
  }
  if (ts.isIdentifier(e) && ctx.envReadVars.has(e.text)) return ctx.envReadVars.get(e.text);
  return undefined;
}

/** Target var name, '<computed>', or undefined. An `||` / `??` chain of env
 * reads (`env.DATABASE_NAME || env.PGDATABASE`) counts as a target read. */
function envReadTarget(expr, ctx) {
  const e = unwrap(expr);
  if (!e) return undefined;
  if (ts.isBinaryExpression(e) && OR_KINDS.has(e.operatorToken.kind)) {
    return envReadTarget(e.left, ctx) ?? envReadTarget(e.right, ctx);
  }
  const v = anyEnvRead(e, ctx);
  return v && (TARGET_VARS.has(v) || v === '<computed>') ? v : undefined;
}

function worst(a, b) {
  const rank = { safe: 0, unresolved: 1, literal: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** How safe is a fallback expression?
 *   'safe'       - '' / undefined / null / another env read
 *   'literal'    - a non-empty string (or a same-file const holding one)
 *   'unresolved' - anything the detector cannot prove safe (fail closed) */
function classifyDefault(expr, ctx) {
  const e = unwrap(expr);
  if (!e) return 'safe';
  const lit = literalStringValue(e);
  if (lit !== undefined) return lit === '' ? 'safe' : 'literal';
  if (e.kind === ts.SyntaxKind.NullKeyword) return 'safe';
  if (ts.isIdentifier(e)) {
    if (e.text === 'undefined') return 'safe';
    if (ctx.constMap.has(e.text)) return 'literal';
    if (ctx.envReadVars.has(e.text)) return 'safe';
    return 'unresolved';
  }
  if (anyEnvRead(e, ctx)) return 'safe';
  if (ts.isBinaryExpression(e) && OR_KINDS.has(e.operatorToken.kind)) {
    return worst(classifyDefault(e.left, ctx), classifyDefault(e.right, ctx));
  }
  if (ts.isConditionalExpression(e)) return worst(classifyDefault(e.whenTrue, ctx), classifyDefault(e.whenFalse, ctx));
  return 'unresolved';
}

/** Per-file resolution context: string constants, process.env aliases, and
 * variables that hold a target env read. Name-keyed (not scope-aware), which
 * errs toward flagging: a same-named variable elsewhere in the file is
 * treated as the env read, never the reverse. */
function buildContext(sourceFile) {
  const ctx = { constMap: new Map(), envAliases: new Set(ENV_OBJECT_NAMES), envReadVars: new Map() };
  const decls = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) decls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const d of decls) {
    if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.initializer) {
      const val = literalStringValue(d.initializer);
      if (val !== undefined && val !== '') ctx.constMap.set(d.name.text, val);
    }
  }
  // Fixpoint: aliases of aliases, and reads through aliases.
  let changed = true;
  for (let pass = 0; changed && pass < 10; pass++) {
    changed = false;
    for (const d of decls) {
      const init = d.initializer;
      if (!init) continue;
      if (ts.isIdentifier(d.name)) {
        const name = d.name.text;
        if (!ctx.envAliases.has(name) && isEnvObject(init, ctx)) {
          ctx.envAliases.add(name);
          changed = true;
        }
        const t = envReadTarget(init, ctx);
        if (t && t !== '<computed>' && !ctx.envReadVars.has(name)) {
          ctx.envReadVars.set(name, t);
          changed = true;
        }
      } else if (ts.isObjectBindingPattern(d.name)) {
        for (const el of d.name.elements) {
          const prop = bindingPropName(el);
          if (!prop || !ts.isIdentifier(el.name)) continue;
          const local = el.name.text;
          // const { env: vars } = process  /  const { env } = process
          if (prop === 'env' && isProcessIdentifier(init) && !ctx.envAliases.has(local)) {
            ctx.envAliases.add(local);
            changed = true;
          }
          // const { DATABASE_NAME } = process.env
          if (TARGET_VARS.has(prop) && isEnvObject(init, ctx) && !ctx.envReadVars.has(local)) {
            ctx.envReadVars.set(local, prop);
            changed = true;
          }
        }
      }
    }
  }
  return ctx;
}

/** Is a binding pattern's source the env object (directly, as a parameter
 * default, or nested as `{ env: { ... } } = process`)? */
function patternSourceIsEnv(pattern, ctx) {
  const parent = pattern.parent;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) {
    return Boolean(parent.initializer) && isEnvObject(parent.initializer, ctx);
  }
  if (ts.isBindingElement(parent) && bindingPropName(parent) === 'env') {
    const holder = parent.parent.parent;
    return (
      (ts.isVariableDeclaration(holder) || ts.isParameter(holder)) &&
      Boolean(holder.initializer) &&
      isProcessIdentifier(holder.initializer)
    );
  }
  return false;
}

function scriptKindFor(file, isTsx) {
  if (isTsx || file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

export function findOffenders(file, source, isTsx = false) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file, isTsx));
  const ctx = buildContext(sourceFile);
  const offenders = [];

  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const record = (node, variable, kind) => {
    offenders.push({
      file,
      line: lineOf(node),
      text: node.getText(sourceFile).replace(/\s+/g, ' ').trim().slice(0, 200),
      variable,
      kind,
    });
  };

  const judge = (whole, target, defaultExpr) => {
    const c = classifyDefault(defaultExpr, ctx);
    if (c === 'safe') return;
    if (target === '<computed>') {
      // A computed env key with a literal default cannot be proven not to be
      // a target variable. A computed key with a non-literal default is a
      // generic env helper; its call sites are checked by the helper-call rule.
      if (c === 'literal') record(whole, target, 'unresolved');
      return;
    }
    record(whole, target, c === 'literal' ? 'env-default' : 'unresolved');
  };

  const visit = (node) => {
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      // `X || D` / `X ?? D` — judged where the right side is not itself an env read.
      if (OR_KINDS.has(kind)) {
        const target = envReadTarget(node.left, ctx);
        if (target && anyEnvRead(node.right, ctx) === undefined) judge(node, target, node.right);
      }
      // `X ||= D` / `X ??= D`
      if (OR_ASSIGN_KINDS.has(kind)) {
        const target = envReadTarget(node.left, ctx);
        if (target) judge(node, target, node.right);
      }
    }

    // Ternary: `X ? X : D` or `!X ? D : X`
    if (ts.isConditionalExpression(node)) {
      let cond = unwrap(node.condition);
      let negated = false;
      if (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken) {
        negated = true;
        cond = cond.operand;
      }
      const target = envReadTarget(cond, ctx);
      if (target) judge(node, target, negated ? node.whenTrue : node.whenFalse);
    }

    // Destructuring default off the env object (variable or parameter).
    if (ts.isBindingElement(node) && node.initializer && ts.isObjectBindingPattern(node.parent)) {
      const prop = bindingPropName(node);
      if (prop && TARGET_VARS.has(prop) && patternSourceIsEnv(node.parent, ctx)) judge(node, prop, node.initializer);
    }

    // An env helper called with a target var name and a literal default,
    // `getEnv('DATABASE_NAME', 'ipodhan')`. Matched by shape, never by callee name.
    if (ts.isCallExpression(node)) {
      const args = node.arguments.map(unwrap);
      const nameArg = args.find((a) => a && ts.isStringLiteralLike(a) && TARGET_VARS.has(a.text));
      if (nameArg && args.some((a) => a !== nameArg && classifyDefault(a, ctx) === 'literal')) {
        record(node, nameArg.text, 'env-default');
      }
    }

    // A hard-coded connection target inside a connection-config object literal.
    if (ts.isObjectLiteralExpression(node)) {
      const keyOfProp = (p) =>
        p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : undefined;
      const keys = new Set(node.properties.map(keyOfProp).filter(Boolean));
      if ([...CONNECTION_KEYS].some((k) => keys.has(k))) {
        for (const p of node.properties) {
          const k = keyOfProp(p);
          if (!k || !TARGET_KEYS.has(k) || !ts.isPropertyAssignment(p)) continue;
          // An env read with a default is judged by the env-default rule above.
          if (envReadTarget(p.initializer, ctx)) continue;
          if (classifyDefault(p.initializer, ctx) === 'literal') record(p, k, 'hardcoded-target');
        }
      }
    }

    // A hard-coded database in a postgres:// URL literal.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (PG_URL_FULL.test(node.text)) record(node, 'connectionString', 'hardcoded-target');
    } else if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans;
      const tail = spans.length ? spans[spans.length - 1].literal.text : '';
      if (PG_URL_HEAD.test(node.head.text) && PG_URL_TAIL.test(tail)) {
        record(node, 'connectionString', 'hardcoded-target');
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return offenders;
}

/** Layer 1 over one file (same fail-closed parse wrapper). */
export function scanConstructions(file, source) {
  return scanSource(file, source, findConstructionSites);
}

/** Fail closed: a file the detector cannot parse is an offender, never a skip. */
export function scanSource(file, source, parse = findOffenders) {
  try {
    return parse(file, source);
  } catch (err) {
    return [{ file, line: 0, text: `could not parse: ${err.message}`, variable: '-', kind: 'parse-error' }];
  }
}

/** #1142: keyed by file + variable + normalised expression text, so an edit
 * that only shifts lines does not fail CI. */
export function keyOf(o) {
  return `${o.file}|${o.kind}|${o.variable}|${o.text}`;
}

/** Occurrence-counted compare: a second identical offender in the same file is
 * NEW. Every baseline entry must carry a reason. */
export function compareToBaseline(offenders, baseline) {
  const allowed = new Map();
  for (const e of baseline) {
    if (!e || typeof e.reason !== 'string' || e.reason.trim() === '' || e.reason === 'FILL IN') {
      throw new Error(`baseline entry without a reason: ${JSON.stringify(e)}`);
    }
    allowed.set(keyOf(e), (allowed.get(keyOf(e)) || 0) + 1);
  }
  const seen = new Map();
  const newOffenders = [];
  for (const o of offenders) {
    const k = keyOf(o);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n > (allowed.get(k) || 0)) newOffenders.push(o);
  }
  const gone = [];
  for (const [k, n] of allowed) if ((seen.get(k) || 0) < n) gone.push(k);
  return { newOffenders, gone };
}

/** Exit code for a compare result. A stale (gone) entry FAILS, same as a new
 * offender: the baseline is shrink-only (#1142 round 1 MINOR). */
export function exitCodeFor({ newOffenders, gone }) {
  return newOffenders.length > 0 || gone.length > 0 ? 1 : 0;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function main() {
  const printBaseline = process.argv.includes('--baseline');
  const allOffenders = [];
  const tracked = trackedFiles();
  const read = (relFile) => {
    try {
      return readFileSync(path.join(REPO_ROOT, relFile), 'utf8');
    } catch {
      return null; // listed by git but deleted in the working tree
    }
  };

  let layer1Files = 0;
  for (const relFile of tracked.filter((f) => LAYER1_EXTENSIONS.has(path.extname(f)))) {
    const source = read(relFile);
    if (source === null || !LAYER1_PREFILTER.test(source)) continue;
    layer1Files++;
    allOffenders.push(...scanConstructions(relFile, source));
  }
  if (layer1Files === 0) {
    console.error('[check-db-connection-defaults] FAIL: layer 1 scanned 0 files - the file walk is broken, refusing to pass');
    process.exitCode = 1;
    return;
  }

  for (const relFile of listFiles(tracked)) {
    const source = read(relFile);
    if (source === null || !PREFILTER.test(source)) continue;
    allOffenders.push(...scanSource(relFile, source));
  }

  if (printBaseline) {
    // Keep the reasons already written; only new entries get FILL IN.
    const reasons = new Map();
    for (const e of loadBaseline()) {
      const k = keyOf(e);
      reasons.set(k, [...(reasons.get(k) || []), e.reason]);
    }
    console.log(
      JSON.stringify(
        allOffenders.map((o) => {
          const pending = reasons.get(keyOf(o)) || [];
          return { file: o.file, variable: o.variable, text: o.text, kind: o.kind, reason: pending.shift() ?? 'FILL IN' };
        }),
        null,
        2
      )
    );
    return;
  }

  let result;
  try {
    result = compareToBaseline(allOffenders, loadBaseline());
  } catch (err) {
    console.error(`[check-db-connection-defaults] FAIL: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const { newOffenders, gone } = result;

  if (gone.length > 0) {
    // Shrink-only: a fixed site left in the baseline is a free slot for the
    // next offender with the same text, so it fails the run (#1142 round 1 MINOR).
    console.error(
      `[check-db-connection-defaults] FAIL: ${gone.length} baseline entr${gone.length === 1 ? 'y is' : 'ies are'} gone (fixed) - ` +
        `remove ${gone.length === 1 ? 'it' : 'them'} from scripts/ci/db-connection-defaults-baseline.json (the baseline is shrink-only):`
    );
    gone.forEach((k) => console.error(`  - ${k}`));
  }

  if (newOffenders.length > 0) {
    console.error(
      `[check-db-connection-defaults] FAIL: ${newOffenders.length} new offender(s) (#640, #1142).\n` +
        `  construction / escape / unresolved / drizzle-fresh-client: a Postgres client is built outside the ` +
        `sanctioned modules (scripts/ci/pg-construction-sites.mjs SANCTIONED_MODULES). Use the shared pool ` +
        `('@ipodhan/shared/db', web '@/lib/db'), createUtcPool() from scripts/lib/pg-utc.mjs in a plain-node ` +
        `script, or scraper/tests/test-utils/db.ts in a test.\n` +
        `  env-default / hardcoded-target: a connection target (database or user) is chosen without an explicit ` +
        `env value ('ipodhan' is production, 'postgres' is the superuser) - use resolveDiscreteDbParams(env).\n` +
        `  A genuinely needed exception goes in scripts/ci/db-connection-defaults-baseline.json with a reason.\n`
    );
    newOffenders.forEach((o) => {
      console.error(`  ${o.file}:${o.line}  [${o.kind} ${o.variable}]  ${o.text}`);
    });
  }

  process.exitCode = exitCodeFor(result);
  if (process.exitCode) return;
  console.log(
    `[check-db-connection-defaults] PASS: 0 new offenders, 0 stale baseline entries ` +
      `(${layer1Files} files in layer 1; ${allOffenders.length} baselined sites carried forward)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
