#!/usr/bin/env node
// #1187 (class of #635): a db / redis handle passed to a constructor through a
// type-erasing cast (`as never`, `as any`, `as unknown`, `as unknown as X`,
// `<any>x`) turns off the one check that the handle matches what the
// repository / orchestrator expects. #635 shipped a Redis handle of the wrong
// shape to DataConsolidationOrchestrator through exactly such a cast.
//
// Rule (fail closed, parsed with TypeScript's own AST, never a hand-rolled lexer):
// every argument of a `new X(...)` expression, and every property value of an
// object-literal argument, is checked. It is an offender when, after stripping
// parentheses, `!` and `satisfies`, it is
//   (a) an erasing cast (as / angle-bracket to never | any | unknown, or a cast
//       whose operand is itself an erasing cast: `as unknown as T`), or
//   (b) an identifier bound by a same-file variable whose initializer is (a):
//       the intermediate-variable bypass (`const d = db as never; new R(d)`), or
//   (c) a spread argument (`new X(...args)`) whose contents this static check
//       cannot see: refused, not guessed.
// Which operand is cast is deliberately NOT decided by its name: a handle
// renamed `d`, `tx`, `dbx` or `client` is the same hole. A constructor argument
// that must stay erased is listed in the baseline with a reason.
//
// Usage: node scripts/ci/check-ctor-arg-casts.mjs [--root <dir>] [--list]
//   exit 0: no offender outside the baseline; exit 1: offenders or stale entries.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
export const SCAN_DIRS = ['scraper/src', 'web/lib', 'web/app', 'packages/shared/src'];
export const BASELINE_REL = 'scripts/ci/ctor-arg-casts-baseline.json';

const ERASING = new Set([ts.SyntaxKind.NeverKeyword, ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword]);

function strip(node) {
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))) {
      n = n.expression;
    } else {
      return n;
    }
  }
}

function isCast(n) {
  return ts.isAsExpression(n) || ts.isTypeAssertionExpression(n);
}

export function isErasingCast(node) {
  const n = strip(node);
  if (!isCast(n)) return false;
  if (ERASING.has(n.type.kind)) return true;
  // `x as unknown as T` / `<T><unknown>x`: the outer cast names a real type but
  // its operand was erased first, so the target type checks nothing.
  return isErasingCast(n.expression);
}

function declInList(list, name) {
  if (!list || !ts.isVariableDeclarationList(list)) return null;
  for (const d of list.declarations) {
    if (ts.isIdentifier(d.name) && d.name.text === name) return d;
    if (!ts.isIdentifier(d.name)) {
      // Destructured binding: the bound value's type is whatever the pattern
      // produced; treat a destructure of an erased initializer as erased.
      let hit = null;
      const v = (n) => { if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && n.name.text === name) hit = d; ts.forEachChild(n, v); };
      v(d.name);
      if (hit) return hit;
    }
  }
  return null;
}

// Nearest lexical binding of `id` (block, function parameter, for-initializer,
// catch clause, import). Returns the declaration node or null (global / unknown).
function findBinding(id) {
  const name = id.text;
  for (let n = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n) && n.parameters) {
      for (const p of n.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === name) return p;
      }
    }
    if ((ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.initializer) {
      const d = declInList(n.initializer, name);
      if (d) return d;
    }
    if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name) && n.variableDeclaration.name.text === name) {
      return n.variableDeclaration;
    }
    if (n.statements) {
      for (const s of n.statements) {
        if (ts.isVariableStatement(s)) {
          const d = declInList(s.declarationList, name);
          if (d) return d;
        } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name?.text === name) {
          return s;
        } else if (ts.isImportDeclaration(s) && s.importClause) {
          // An imported binding is typed by its module: not an erased local.
          const c = s.importClause;
          const named = c.namedBindings;
          if (c.name?.text === name) return null;
          if (named && ts.isNamespaceImport(named) && named.name.text === name) return null;
          if (named && ts.isNamedImports(named) && named.elements.some((e) => e.name.text === name)) return null;
        }
      }
    }
  }
  return null;
}

function isErasedBinding(id, seen = new Set()) {
  const d = findBinding(id);
  if (!d || seen.has(d)) return false;
  seen.add(d);
  if (ts.isVariableDeclaration(d) && d.initializer) {
    const init = strip(d.initializer);
    if (isErasingCast(init)) return true;
    // `const a = db as never; const b = a;` — follow plain identifier copies.
    if (ts.isIdentifier(init)) return isErasedBinding(init, seen);
    // `const r = redis ?? (x as never)` / ternary: any erased branch erases the whole.
    if (ts.isBinaryExpression(init) || ts.isConditionalExpression(init)) {
      let hit = false;
      const v = (n) => { if (hit) return; if (isCast(n) && isErasingCast(n)) { hit = true; return; } ts.forEachChild(n, v); };
      v(init);
      return hit;
    }
  }
  return false;
}

function classify(expr) {
  const n = strip(expr);
  if (isErasingCast(n)) return 'erasing-cast';
  if (ts.isIdentifier(n) && isErasedBinding(n)) return 'via-erased-variable';
  // `a ?? (b as never)`, `x || y`, `c ? a : b`: any erased branch reaches the constructor.
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) {
    return classify(n.left) ?? classify(n.right);
  }
  if (ts.isConditionalExpression(n)) return classify(n.whenTrue) ?? classify(n.whenFalse);
  return null;
}

export function findOffenders(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const push = (node, kind) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ file: fileName, line: line + 1, kind, text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 160) });
  };
  const visit = (node) => {
    if (ts.isNewExpression(node) && node.arguments) {
      for (const arg of node.arguments) {
        if (ts.isSpreadElement(arg)) {
          push(arg, 'unresolved-spread-argument');
          continue;
        }
        const k = classify(arg);
        if (k) {
          push(arg, k);
          continue;
        }
        const inner = strip(arg);
        if (ts.isObjectLiteralExpression(inner)) {
          for (const p of inner.properties) {
            if (ts.isPropertyAssignment(p)) {
              const pk = classify(p.initializer);
              if (pk) push(p, pk);
            } else if (ts.isShorthandPropertyAssignment(p)) {
              if (isErasedBinding(p.name)) push(p, 'via-erased-variable');
            } else if (ts.isSpreadAssignment(p)) {
              const sk = classify(p.expression);
              if (sk) push(p, sk);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const SKIP_DIR = new Set(['node_modules', 'dist', '.next', 'tests', 'test', '__tests__', '__mocks__']);
function walk(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

export function keyOf(o) {
  return `${o.file}::${o.text}`;
}

export function scan(root) {
  const out = [];
  for (const d of SCAN_DIRS) {
    for (const f of walk(path.join(root, d), [])) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      out.push(...findOffenders(rel, readFileSync(f, 'utf8')));
    }
  }
  return out;
}

export function loadBaseline(root) {
  const p = path.join(root, BASELINE_REL);
  if (!existsSync(p)) return [];
  const entries = JSON.parse(readFileSync(p, 'utf8')).entries ?? [];
  for (const e of entries) {
    if (!e.file || !e.text || !e.reason || String(e.reason).length < 20) {
      throw new Error(`check-ctor-arg-casts: baseline entry needs file, text and a reason of 20+ chars: ${JSON.stringify(e)}`);
    }
  }
  return entries;
}

export function run(root) {
  const offenders = scan(root);
  const baseline = loadBaseline(root);
  // Multiset: a baseline entry allows `count` occurrences (default 1) of its
  // file + expression text, so a second identical cast in the same file is new.
  const budget = new Map();
  for (const e of baseline) budget.set(`${e.file}::${e.text}`, (budget.get(`${e.file}::${e.text}`) ?? 0) + (e.count ?? 1));
  const used = new Map();
  const fresh = [];
  for (const o of offenders) {
    const k = keyOf(o);
    const n = (used.get(k) ?? 0) + 1;
    used.set(k, n);
    if (n > (budget.get(k) ?? 0)) fresh.push(o);
  }
  const stale = baseline.filter((e) => (used.get(`${e.file}::${e.text}`) ?? 0) < (e.count ?? 1));
  return { offenders, fresh, stale };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--root');
  const root = ri >= 0 ? path.resolve(args[ri + 1]) : DEFAULT_ROOT;
  if (args.includes('--list')) {
    const offenders = scan(root);
    for (const o of offenders) console.log(`${o.file}:${o.line} [${o.kind}] ${o.text}`);
    console.log(`total ${offenders.length}`);
    process.exit(0);
  }
  const { offenders, fresh, stale } = run(root);
  for (const s of stale) console.error(`check-ctor-arg-casts: STALE baseline entry (no longer in the tree, remove it): ${s.file} :: ${s.text}`);
  for (const o of fresh) console.error(`check-ctor-arg-casts: ${o.file}:${o.line} [${o.kind}] ${o.text}`);
  if (fresh.length || stale.length) {
    console.error(`check-ctor-arg-casts: FAIL - ${fresh.length} constructor argument(s) passed through a type-erasing cast, ${stale.length} stale baseline entr(y/ies). Pass the handle with its real type (#1187), or baseline it with a reason in ${BASELINE_REL}.`);
    process.exit(1);
  }
  console.log(`check-ctor-arg-casts: OK - ${offenders.length} baselined, 0 new`);
}
