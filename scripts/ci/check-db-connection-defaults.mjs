#!/usr/bin/env node
/**
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'ci', 'db-connection-defaults-baseline.json');

// #640 round 2: widened from scripts-only to every tree that builds a pg
// connection — the round-1 gate did not cover scraper/src, packages/shared/src
// or web/lib, so a regression there (a default re-added to
// packages/shared/src/db/index.ts) would not have been caught.
const SCAN_DIRS = [
  'scraper/scripts',
  'scraper/src',
  'scripts',
  'web/scripts',
  'web/lib',
  'packages/shared/src',
];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const EXCLUDE_PATTERNS = [
  /\/node_modules\//,
  /\.test\.(ts|mjs|js)$/,
  /\/tests?\//,
  // Documents the old (fixed) shape in a comment, and defines the resolver
  // itself — it is not a connection-building call site.
  /\/lib\/pg-connection-params\.mjs$/,
  // This detector's own source quotes the offending shapes to document them.
  /\/ci\/check-db-connection-defaults\.mjs$/,
];

const TARGET_VARS = new Set(['DATABASE_NAME', 'DATABASE_USER']);
const ENV_OBJECT_TEXTS = new Set(['process.env', 'env']);

function listFiles() {
  const out = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => SCAN_DIRS.some((d) => f === d || f.startsWith(d + '/')))
    .filter((f) => FILE_EXTENSIONS.has(path.extname(f)))
    .filter((f) => !EXCLUDE_PATTERNS.some((re) => re.test('/' + f)));
}

/** Non-empty string value of a literal-like node, or undefined if not one. */
function literalStringValue(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    // A template WITH substitutions is still a computed-but-fixed-shape
    // default (e.g. `` `ipodhan_${suffix}` ``) — flag it; there is no safe
    // way to know the resolved value is never a real database name.
    return node.getText().length > 2 ? '<template>' : undefined;
  }
  return undefined;
}

/** Collect same-file `const NAME = 'literal'` bindings, for the
 * named-constant-as-default shape. */
function collectFileConstants(sourceFile) {
  const map = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const val = literalStringValue(node.initializer);
      if (val !== undefined && val !== '') map.set(node.name.text, val);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return map;
}

/** Is `expr` a literal (or named-constant-resolving-to-literal) non-empty
 * default value? */
function isLiteralDefault(expr, constMap) {
  if (!expr) return false;
  const direct = literalStringValue(expr);
  if (direct !== undefined) return direct !== '';
  if (ts.isIdentifier(expr) && constMap.has(expr.text)) {
    return constMap.get(expr.text) !== '';
  }
  return false;
}

/** DATABASE_NAME | DATABASE_USER | undefined — is `expr` a direct read of a
 * target var off `process.env` / a local `env` alias? */
function envReadTarget(expr) {
  if (!expr) return undefined;
  if (ts.isPropertyAccessExpression(expr)) {
    if (ENV_OBJECT_TEXTS.has(expr.expression.getText()) && TARGET_VARS.has(expr.name.text)) {
      return expr.name.text;
    }
  }
  if (ts.isElementAccessExpression(expr)) {
    const arg = expr.argumentExpression;
    if (
      ENV_OBJECT_TEXTS.has(expr.expression.getText()) &&
      arg &&
      ts.isStringLiteralLike(arg) &&
      TARGET_VARS.has(arg.text)
    ) {
      return arg.text;
    }
  }
  return undefined;
}

/** Unwrap a single leading `!` for the negated-ternary-condition shape. */
function unwrapNegation(expr) {
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return { negated: true, inner: expr.operand };
  }
  return { negated: false, inner: expr };
}

export function findOffenders(file, source, isTsx = false) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
  const constMap = collectFileConstants(sourceFile);
  const offenders = [];

  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const record = (node, variable) => {
    offenders.push({
      file,
      line: lineOf(node),
      text: node.getText(sourceFile).replace(/\s+/g, ' ').trim().slice(0, 160),
      variable,
    });
  };

  const visit = (node) => {
    // `X || 'lit'` / `X ?? 'lit'`
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const target = envReadTarget(node.left);
      if (target && isLiteralDefault(node.right, constMap)) {
        record(node.right, target);
      }
    }

    // Ternary: `X ? X : 'lit'` or `!X ? 'lit' : X`
    if (ts.isConditionalExpression(node)) {
      const { negated, inner } = unwrapNegation(node.condition);
      const target = envReadTarget(inner);
      if (target) {
        const defaultExpr = negated ? node.whenTrue : node.whenFalse;
        if (isLiteralDefault(defaultExpr, constMap)) {
          record(defaultExpr, target);
        }
      }
    }

    // Destructuring default: `const { DATABASE_NAME = 'lit' } = process.env`
    // and the aliased form `{ DATABASE_NAME: db = 'lit' }`.
    if (ts.isBindingElement(node) && node.initializer) {
      const pattern = node.parent;
      if (ts.isObjectBindingPattern(pattern) && ts.isVariableDeclaration(pattern.parent)) {
        const decl = pattern.parent;
        const sourceExpr = decl.initializer;
        if (sourceExpr && ENV_OBJECT_TEXTS.has(sourceExpr.getText())) {
          const propName = node.propertyName
            ? (ts.isIdentifier(node.propertyName) ? node.propertyName.text : undefined)
            : ts.isIdentifier(node.name)
              ? node.name.text
              : undefined;
          if (propName && TARGET_VARS.has(propName) && isLiteralDefault(node.initializer, constMap)) {
            record(node.initializer, propName);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

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
    let offenders;
    try {
      offenders = findOffenders(relFile, source, relFile.endsWith('.tsx'));
    } catch (err) {
      console.error(`[check-db-connection-defaults] could not parse ${relFile}: ${err.message}`);
      continue;
    }
    allOffenders.push(...offenders);
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
        `DATABASE_NAME or DATABASE_USER defaults to a literal instead of failing loudly when ` +
        `unset. A script through the tunnel (DATABASE_HOST set) that forgets the variable ` +
        `silently connects to that literal — 'ipodhan' is production, 'postgres' is the superuser. ` +
        `Use resolveDiscreteDbParams(env) (from '@ipodhan/shared/db' in a .ts file, or ` +
        `'scripts/lib/pg-connection-params.mjs' in a plain-node .mjs file) instead. If this default ` +
        `is genuinely safe (a hardcoded non-production database, a least-privilege role default, a ` +
        `diagnostic label), add it to scripts/ci/db-connection-defaults-baseline.json with a reason.\n`
    );
    newOffenders.forEach((o) => {
      console.error(`  ${o.file}:${o.line}  [${o.variable}]  ${o.text}`);
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
