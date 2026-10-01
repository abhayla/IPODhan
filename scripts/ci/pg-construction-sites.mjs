/**
 * #1142 round 2, layer 1 (structural): every Postgres connection is built by
 * ONE sanctioned module per package. A pg / postgres.js client constructed
 * anywhere else is an offender, whatever values it is given.
 *
 * Why structural (run-discipline B8): round 1 traced VALUES (which database /
 * user a connection gets) and missed 9 of 15 bypass shapes — shorthand
 * `{ database }`, a config with no host key (pg then reads PG* env vars), a
 * spread, `process.env.PGDATABASE = ...`, an if-assign, a parameter default, a
 * `+`-built URL, a property assignment. A value can arrive by too many shapes;
 * a construction cannot hide from its import. So this layer keys on the IMPORT
 * SOURCE ('pg', 'pg-pool', 'pg-native', 'postgres', 'pg/...', 'postgres/...',
 * and drizzle's own pg drivers), follows aliases (`import * as`, default,
 * named-with-rename, `require`, `createRequire(...)('pg')`, `await import()`,
 * destructuring, `const P = pg.Pool`, `.default` interop) and reports:
 *   - construction: `new X(...)` / `X(...)` on a resolved constructor
 *   - escape:       the binding used any other way (passed, exported, spread,
 *                   re-exported, assigned, subclassed) — fail closed
 *   - unresolved:   a member of pg the scanner does not know (`pg.defaults`),
 *                   a computed member, or a `require(<non-literal>)` /
 *                   `import(<non-literal>)` whose module cannot be read
 *   - drizzle-fresh-client: `drizzle(<url|config|env read>)`, which opens its
 *                   own client instead of taking a sanctioned pool
 * Scoping is name-keyed per file (not scope-aware), which errs toward flagging.
 */
import ts from 'typescript';

/** The one sanctioned constructor per package (plus the test-db module). */
export const SANCTIONED_MODULES = new Map([
  ['packages/shared/src/db/index.ts', 'shared + scraper pool: -c timezone=UTC, configureUtcTimestampParsing'],
  ['web/lib/db/index.ts', 'web pool: -c timezone=UTC, configureUtcTimestampParsing'],
  ['scripts/lib/pg-utc.mjs', 'createUtcPool() for plain-node scripts: -c timezone=UTC + installUtcTimestampParsing'],
  ['scraper/tests/test-utils/db.ts', 'test-db module; every integration run is behind the global prod/staging guard (vitest.integration.setup.ts)'],
]);

const NS_MODULES = new Set(['pg']); // module object with .Pool/.Client/.native
const CTOR_MODULE = /^(pg-pool|pg-native|postgres|pg\/.+|postgres\/.+|pg-cursor|pg-query-stream)$/;
const DRIZZLE_MODULE = /^drizzle-orm\/(node-postgres|postgres-js)(\/.*)?$/;
// Members of the pg module object that never open a connection.
const SAFE_NS_MEMBERS = new Set(['types', 'escapeIdentifier', 'escapeLiteral', 'DatabaseError', 'TypeOverrides', 'Result']);
const NS_CTOR_MEMBERS = new Set(['Pool', 'Client', 'Connection']);
const WRAPPERS = (n) =>
  ts.isParenthesizedExpression(n) ||
  ts.isAsExpression(n) ||
  ts.isNonNullExpression(n) ||
  ts.isTypeAssertionExpression(n) ||
  ts.isSatisfiesExpression(n);

function unwrap(e) {
  while (e && WRAPPERS(e)) e = e.expression;
  return e;
}

function moduleKind(spec) {
  if (NS_MODULES.has(spec)) return 'ns';
  if (CTOR_MODULE.test(spec)) return 'ctor';
  if (DRIZZLE_MODULE.test(spec)) return 'drizzleModule';
  return null;
}

/** Kind of `<value of kind k>.<name>`. */
function member(k, name) {
  if (k === 'ns') {
    if (NS_CTOR_MEMBERS.has(name)) return 'ctor';
    if (name === 'native' || name === 'default') return 'ns';
    if (SAFE_NS_MEMBERS.has(name)) return 'safe';
    return 'unresolved';
  }
  if (k === 'ctor' || k === 'ctorModule') return name === 'default' ? 'ctor' : 'unresolved';
  if (k === 'drizzleModule') return name === 'drizzle' || name === 'default' ? 'drizzle' : 'safe';
  if (k === 'drizzle') return 'unresolved';
  if (k === 'promise') return 'unresolved';
  return 'unresolved';
}

/** Kind a module's namespace / default / require() value has. */
function importKind(spec, how) {
  const mk = moduleKind(spec);
  if (!mk) return null;
  if (mk === 'ns') return 'ns';
  if (mk === 'drizzleModule') return how === 'default' ? 'drizzle' : 'drizzleModule';
  // ctor modules: default import and require() are the constructor itself;
  // `import * as M` is a module object whose .default is the constructor.
  return how === 'namespace' ? 'ctorModule' : 'ctor';
}

function stringArg(call) {
  const a = call.arguments[0] && unwrap(call.arguments[0]);
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : undefined;
}

/** A computed specifier that can only name a local FILE, never a package:
 * `pathToFileURL(x).href`, `'file://' + x`, or a string/template that starts
 * with '.', '/' or 'file:'. Every other computed specifier fails closed. */
function isLocalFileSpecifier(arg) {
  let a = unwrap(arg);
  if (ts.isPropertyAccessExpression(a) && a.name.text === 'href') a = unwrap(a.expression);
  if (ts.isCallExpression(a) && ts.isIdentifier(a.expression) && /^pathToFileUrl$/i.test(a.expression.text)) return true;
  let head = a;
  while (ts.isBinaryExpression(head) && head.operatorToken.kind === ts.SyntaxKind.PlusToken) head = unwrap(head.left);
  const text = ts.isStringLiteralLike(head) ? head.text : ts.isTemplateExpression(head) ? head.head.text : null;
  return text !== null && /^(\.{1,2}\/|\/|file:)/.test(text);
}

function isCreateRequireCall(call) {
  const c = unwrap(call.expression);
  return (ts.isIdentifier(c) && c.text === 'createRequire') || (ts.isPropertyAccessExpression(c) && c.name.text === 'createRequire');
}

function isDynamicImport(call) {
  return call.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function propName(nameNode) {
  if (!nameNode) return undefined;
  if (ts.isIdentifier(nameNode) || ts.isStringLiteralLike(nameNode) || ts.isPrivateIdentifier(nameNode)) return nameNode.text;
  return undefined;
}

function scriptKindFor(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (/\.(ts|mts|cts)$/.test(file)) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function isExported(decl) {
  const list = decl.parent;
  const stmt = list && list.parent;
  return Boolean(stmt && ts.isVariableStatement(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

export function findConstructionSites(file, source) {
  if (SANCTIONED_MODULES.has(file)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const bindings = new Map(); // local name -> kind
  const offenders = [];
  const seen = new Set();
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const record = (node, kind, detail) => {
    if (seen.has(node.pos + ':' + node.end + ':' + kind)) return;
    seen.add(node.pos + ':' + node.end + ':' + kind);
    offenders.push({
      file,
      line: lineOf(node),
      text: node.getText(sf).replace(/\s+/g, ' ').trim().slice(0, 200),
      variable: detail,
      kind,
    });
  };

  /** Kind of an expression's VALUE, or null when it is not a pg value. */
  const resolve = (expr) => {
    const e = unwrap(expr);
    if (!e) return null;
    if (ts.isIdentifier(e)) return bindings.get(e.text) ?? null;
    if (ts.isCallExpression(e)) {
      const spec = stringArg(e);
      if (isDynamicImport(e)) return spec !== undefined && moduleKind(spec) ? 'promise:' + spec : null;
      // require('pg'), createRequire(url)('pg'), module.require('pg'): any
      // one-string-argument call naming a pg module is treated as a require.
      if (spec !== undefined && e.arguments.length === 1) return importKind(spec, 'require');
      return null;
    }
    if (ts.isAwaitExpression(e)) {
      const inner = resolve(e.expression);
      if (inner && inner.startsWith('promise:')) return importKind(inner.slice(8), 'namespace');
      return null;
    }
    if (ts.isPropertyAccessExpression(e)) {
      const k = resolve(e.expression);
      return k && k !== 'safe' ? member(k.startsWith('promise:') ? 'promise' : k, e.name.text) : null;
    }
    if (ts.isElementAccessExpression(e)) {
      const k = resolve(e.expression);
      if (!k || k === 'safe') return null;
      const key = unwrap(e.argumentExpression);
      return key && ts.isStringLiteralLike(key) ? member(k.startsWith('promise:') ? 'promise' : k, key.text) : 'unresolved';
    }
    return null;
  };

  // --- pass 1: import bindings -------------------------------------------
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      if (!moduleKind(spec)) continue;
      const clause = st.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) bindings.set(clause.name.text, importKind(spec, 'default'));
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) bindings.set(nb.name.text, importKind(spec, 'namespace'));
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (el.isTypeOnly) continue;
          const imported = propName(el.propertyName ?? el.name);
          const k = member(importKind(spec, 'namespace'), imported);
          // An unknown named import is usually a type (PoolClient, QueryResult)
          // imported without `type`; it is flagged only if used as a VALUE.
          if (k !== 'safe') bindings.set(el.name.text, k);
        }
      }
    }
    if (ts.isImportEqualsDeclaration(st) && !st.isTypeOnly && ts.isExternalModuleReference(st.moduleReference)) {
      const ref = st.moduleReference.expression;
      if (ts.isStringLiteral(ref) && moduleKind(ref.text)) bindings.set(st.name.text, importKind(ref.text, 'require'));
    }
  }

  // --- pass 2: alias fixpoint over variable declarations -------------------
  const decls = [];
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer) decls.push(n);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  // Names bound to createRequire(...): calling one is a require.
  const requireFns = new Set();
  for (const d of decls) {
    const init = unwrap(d.initializer);
    if (ts.isIdentifier(d.name) && init && ts.isCallExpression(init) && isCreateRequireCall(init)) requireFns.add(d.name.text);
  }
  const isRequireLike = (expr) => {
    const e = unwrap(expr);
    if (!e) return false;
    if (ts.isIdentifier(e)) return e.text === 'require' || requireFns.has(e.text);
    if (ts.isPropertyAccessExpression(e)) return e.name.text === 'require' && ts.isIdentifier(unwrap(e.expression)) && unwrap(e.expression).text === 'module';
    if (ts.isCallExpression(e)) return isCreateRequireCall(e);
    return false;
  };
  const bindPattern = (pattern, k) => {
    let changed = false;
    for (const el of pattern.elements) {
      if (ts.isOmittedExpression(el)) continue;
      const sub = el.dotDotDotToken ? k : member(k.startsWith('promise:') ? 'promise' : k, propName(el.propertyName ?? el.name) ?? '<computed>');
      if (sub === 'safe') continue;
      if (ts.isIdentifier(el.name)) {
        if (!bindings.has(el.name.text)) {
          bindings.set(el.name.text, sub);
          changed = true;
        }
      } else if (ts.isObjectBindingPattern(el.name) || ts.isArrayBindingPattern(el.name)) {
        changed = bindPattern(el.name, sub) || changed;
      }
    }
    return changed;
  };
  for (let pass = 0, changed = true; changed && pass < 10; pass++) {
    changed = false;
    for (const d of decls) {
      const k = resolve(d.initializer);
      if (!k || k === 'safe') continue;
      if (ts.isIdentifier(d.name)) {
        if (!bindings.has(d.name.text)) {
          bindings.set(d.name.text, k);
          changed = true;
        }
      } else if (ts.isObjectBindingPattern(d.name)) {
        changed = bindPattern(d.name, k) || changed;
      }
    }
  }

  // --- pass 3: classify every maximal pg-valued expression by its use ------
  const climb = (n) => {
    let top = n;
    while (top.parent && WRAPPERS(top.parent) && top.parent.expression === top) top = top.parent;
    return top;
  };
  const extendsChain = (n) => {
    const p = climb(n).parent;
    return (
      (ts.isPropertyAccessExpression(p) && p.expression === climb(n)) ||
      (ts.isElementAccessExpression(p) && p.expression === climb(n)) ||
      (ts.isAwaitExpression(p) && p.expression === climb(n))
    );
  };

  const checkDrizzleCall = (call) => {
    const a = call.arguments[0] && unwrap(call.arguments[0]);
    if (!a) return record(call, 'drizzle-fresh-client', 'drizzle()');
    if (ts.isStringLiteralLike(a) || ts.isTemplateExpression(a) || ts.isBinaryExpression(a) || ts.isConditionalExpression(a)) {
      return record(call, 'drizzle-fresh-client', 'drizzle(<url>)');
    }
    if (ts.isObjectLiteralExpression(a)) {
      const ok = a.properties.every((p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
        ? ['client', 'schema', 'logger', 'casing'].includes(propName(p.name)) : false);
      if (!ok) record(call, 'drizzle-fresh-client', 'drizzle({connection})');
      return;
    }
    const text = a.getText(sf);
    if (/\bprocess\s*\.\s*env\b|\benv\s*\.\s*[A-Z_]+/.test(text)) record(call, 'drizzle-fresh-client', 'drizzle(<env>)');
  };

  const classify = (node, k) => {
    if (k === 'safe') return;
    const top = climb(node);
    const p = top.parent;
    if (k === 'unresolved') return record(top, 'unresolved', 'pg member');
    if (ts.isNewExpression(p) && p.expression === top) {
      return k === 'ctor' ? record(p, 'construction', 'new') : record(p, 'unresolved', `new on ${k}`);
    }
    if (ts.isCallExpression(p) && p.expression === top) {
      if (k === 'ctor') return record(p, 'construction', 'call');
      if (k === 'drizzle') return checkDrizzleCall(p);
      return record(p, 'unresolved', `call on ${k}`);
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && p.right === top) return;
    if (ts.isVariableDeclaration(p) && p.initializer === top && !isExported(p)) return; // alias, followed in pass 2
    if (ts.isExpressionStatement(p) && ts.isCallExpression(top)) return; // bare require('pg'): side effect only
    if (ts.isPropertyAccessExpression(p) && p.expression === top) return; // safe member (non-safe resolved upstream)
    if (ts.isElementAccessExpression(p) && p.expression === top) return;
    record(top, 'escape', k);
  };

  const visit = (n) => {
    // Type positions never construct; but `class X extends pg.Pool` does.
    if (ts.isHeritageClause(n)) {
      if (n.token === ts.SyntaxKind.ExtendsKeyword && (ts.isClassDeclaration(n.parent) || ts.isClassExpression(n.parent))) {
        for (const t of n.types) {
          const k = resolve(t.expression);
          if (k && k !== 'safe') record(t, 'escape', `extends ${k}`);
          visit(t.expression);
        }
      }
      return;
    }
    if (ts.isTypeNode(n) || ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n)) return;
    if (ts.isExportDeclaration(n)) {
      if (n.isTypeOnly) return;
      const spec = n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : null;
      if (spec && moduleKind(spec)) {
        const els = n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements : null;
        if (!els) return record(n, 'escape', `re-export ${spec}`);
        for (const el of els) {
          if (el.isTypeOnly) continue;
          const k = member(importKind(spec, 'namespace'), propName(el.propertyName ?? el.name));
          if (k !== 'safe') record(el, 'escape', `re-export ${spec}`);
        }
        return;
      }
      if (!spec && n.exportClause && ts.isNamedExports(n.exportClause)) {
        for (const el of n.exportClause.elements) {
          const k = !el.isTypeOnly && bindings.get(propName(el.propertyName ?? el.name));
          if (k && k !== 'safe') record(el, 'escape', `export ${k}`);
        }
      }
      return;
    }
    if (ts.isCallExpression(n)) {
      const spec = stringArg(n);
      const isReq = isDynamicImport(n) || isRequireLike(n.expression);
      // require.call(...) / .apply(...) / .bind(...) hide the module name from
      // the one-string-argument rule; fail closed.
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee) && /^(call|apply|bind)$/.test(callee.name.text) && isRequireLike(callee.expression)) {
        record(n, 'unresolved', `require.${callee.name.text}`);
      }
      if (isReq && spec === undefined && n.arguments.length > 0 && !isLocalFileSpecifier(n.arguments[0])) {
        record(n, 'unresolved', 'non-literal module');
      }
    }
    if (ts.isExpression(n) && !extendsChain(n)) {
      // Only test names that can be a reference (skip declaration names / property names).
      const parent = n.parent;
      const isDeclName =
        ts.isIdentifier(n) &&
        parent &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === n) ||
          ((ts.isVariableDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent) ||
            ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isPropertyAssignment(parent) ||
            ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
            ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) && parent.name === n) ||
          (ts.isBindingElement(parent) && parent.propertyName === n));
      if (!isDeclName) {
        const k = resolve(n);
        if (k && !k.startsWith('promise:')) classify(n, k);
        else if (k && k.startsWith('promise:')) {
          const top = climb(n);
          if (!(ts.isAwaitExpression(top.parent) && top.parent.expression === top)) record(top, 'escape', 'import() promise');
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return offenders;
}
