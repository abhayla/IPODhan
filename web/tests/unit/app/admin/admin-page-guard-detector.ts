/**
 * AST-based, FAIL-CLOSED detector: for a non-client-component file under web/app/admin/**
 * (a page.tsx, layout.tsx, route.ts, or any file carrying a 'use server' directive), does EVERY
 * exported entry point (default export, generateMetadata, an HTTP method, or — in a 'use server'
 * file — every exported function) start with a real session guard?
 *
 * Round-1 review finding (#1324): the previous version of this file classified a file as
 * "no data access" (and therefore exempt) unless it matched a literal `db.` property access or
 * `new *Repository(`. That let an imported helper read, a repository factory call, an aliased
 * `db` import, an indirect/anonymous default export, a `generateMetadata` read, a module-scope
 * read, and a 'use server' action file all pass silently — the classification was the PASS
 * condition, so anything it failed to recognize as a "read" was accepted as safe. This version
 * drops that heuristic entirely: an entry point is guarded or it is not; there is no third,
 * silently-passing "doesn't look like a read" state. A file that is not guarded and not on the
 * explicit, reviewed allowlist (see ADMIN_SERVER_FILES_WITHOUT_DATA in the test file) FAILS.
 *
 * Accepted guard shapes (as the entry point's first statement, after unwrapping a single leading
 * `try` and/or a leading 'use server' directive):
 *   (a) `const X = await getAdminSessionFromCookies(); if (!X) { redirect(...); }`
 *   (b) `const X = await requireAdminAuth(); if (X) { return X; }` (the route-handler shape)
 *   (c) the entry point's value IS itself `withAdminAuth(...)`
 * A guard mentioned only in a comment, a discarded result, or one that runs after other code is
 * NOT accepted — same discipline as admin-route-guard-detector.ts.
 *
 * A module-scope statement that performs a call (module-scope read/write, independent of any
 * request-scoped guard) is ALWAYS an offender — a guard inside a function can never protect code
 * that already ran at import time.
 */
import ts from 'typescript';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const NAMED_ENTRY_NAMES = new Set(['generateMetadata', ...HTTP_METHODS]);

function hasDirective(sourceFile: ts.SourceFile, text: string): boolean {
  const [first] = sourceFile.statements;
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === text;
}

/** Unwraps a single leading `try` block and/or a single leading directive-string statement. */
function unwrapLeading(stmts: readonly ts.Statement[]): readonly ts.Statement[] {
  let out = stmts;
  const [first] = out;
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) {
    out = out.slice(1);
  }
  const [maybeTry] = out;
  if (maybeTry && ts.isTryStatement(maybeTry)) {
    out = maybeTry.tryBlock.statements;
  }
  return out;
}

function isIfNotVarThenRedirect(stmt: ts.Statement, varName: string): boolean {
  if (!ts.isIfStatement(stmt) || stmt.elseStatement) return false;
  const cond = stmt.expression;
  if (!ts.isPrefixUnaryExpression(cond) || cond.operator !== ts.SyntaxKind.ExclamationToken) return false;
  if (!ts.isIdentifier(cond.operand) || cond.operand.text !== varName) return false;
  const then = stmt.thenStatement;
  const stmts = ts.isBlock(then) ? then.statements : [then];
  return stmts.some(
    (s) => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && ts.isIdentifier(s.expression.expression) && s.expression.expression.text === 'redirect'
  );
}

function isIfVarThenReturnVar(stmt: ts.Statement, varName: string): boolean {
  if (!ts.isIfStatement(stmt) || stmt.elseStatement) return false;
  if (!ts.isIdentifier(stmt.expression) || stmt.expression.text !== varName) return false;
  const then = stmt.thenStatement;
  const inner = ts.isBlock(then) ? then.statements[0] : then;
  return !!inner && ts.isReturnStatement(inner) && !!inner.expression && ts.isIdentifier(inner.expression) && inner.expression.text === varName;
}

/** `const X = await CALLEE();` as a standalone statement; returns [varName, calleeName] or null. */
function awaitedCallVar(stmt: ts.Statement): [string, string] | null {
  if (!ts.isVariableStatement(stmt)) return null;
  const [decl] = stmt.declarationList.declarations;
  if (!decl || !ts.isIdentifier(decl.name) || !decl.initializer) return null;
  const init = decl.initializer;
  if (!ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression)) return null;
  const callee = init.expression.expression;
  if (!ts.isIdentifier(callee)) return null;
  return [decl.name.text, callee.text];
}

function isGuardedBody(body: ts.Block | undefined): boolean {
  if (!body) return false;
  const stmts = unwrapLeading(body.statements);
  if (stmts.length < 2) return false;
  const pair = awaitedCallVar(stmts[0]);
  if (!pair) return false;
  const [varName, callee] = pair;
  if (callee === 'getAdminSessionFromCookies') return isIfNotVarThenRedirect(stmts[1], varName);
  if (callee === 'requireAdminAuth') return isIfVarThenReturnVar(stmts[1], varName);
  return false;
}

function isWithAdminAuthCall(node: ts.Node | undefined): boolean {
  return !!node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'withAdminAuth';
}

/** Is `node` itself a guarded entry point value: a guarded function, or a withAdminAuth(...) wrap? */
function nodeIsGuarded(node: ts.Node | undefined): boolean {
  if (!node) return false;
  if (isWithAdminAuthCall(node)) return true;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) return isGuardedBody(node.body);
  if (ts.isArrowFunction(node)) return ts.isBlock(node.body) ? isGuardedBody(node.body) : false;
  return false;
}

/** Resolves `export default X;` / `export default function(){}` to the exported value's node. */
function resolveDefaultExport(sourceFile: ts.SourceFile): ts.Node | undefined {
  const topLevel = new Map<string, ts.Node>();
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) topLevel.set(decl.name.text, decl.initializer);
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      topLevel.set(stmt.name.text, stmt);
    }
  }
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      return stmt;
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression;
      if (ts.isIdentifier(expr) && topLevel.has(expr.text)) return topLevel.get(expr.text);
      return expr;
    }
  }
  return undefined;
}

interface Entry {
  label: string;
  guarded: boolean;
}

function collectEntries(sourceFile: ts.SourceFile): Entry[] {
  const entries: Entry[] = [];
  const def = resolveDefaultExport(sourceFile);
  if (def) entries.push({ label: 'default export', guarded: nodeIsGuarded(def) });

  const fileIsUseServer = hasDirective(sourceFile, 'use server');

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (!isExported || isDefault) continue;
      const name = stmt.name.text;
      if (NAMED_ENTRY_NAMES.has(name) || fileIsUseServer) {
        entries.push({ label: name, guarded: isGuardedBody(stmt.body) });
      }
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        if (NAMED_ENTRY_NAMES.has(name) || fileIsUseServer) {
          entries.push({ label: name, guarded: nodeIsGuarded(decl.initializer) });
        }
      }
    }
  }
  return entries;
}

/** Does a top-level statement (outside every function/arrow body) perform a call? */
function hasTopLevelSideEffect(sourceFile: ts.SourceFile): boolean {
  function callsAtOwnScope(node: ts.Node): boolean {
    let found = false;
    function visit(n: ts.Node) {
      if (found) return;
      if (n !== node && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n))) {
        return; // never descend into a nested function/arrow body
      }
      if (ts.isCallExpression(n)) {
        found = true;
        return;
      }
      ts.forEachChild(n, visit);
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return false;
    visit(node);
    return found;
  }

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt)) continue;
    if (ts.isFunctionDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
    if (ts.isExportAssignment(stmt)) continue; // default export value, evaluated separately
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) continue; // directive
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!decl.initializer) continue;
        if (ts.isIdentifier(decl.name) && NAMED_ENTRY_NAMES.has(decl.name.text)) continue; // checked as an entry
        if (callsAtOwnScope(decl.initializer)) return true;
      }
      continue;
    }
    if (ts.isExpressionStatement(stmt) && callsAtOwnScope(stmt.expression)) return true;
  }
  return false;
}

export type GuardVerdict =
  | { status: 'client' }
  | { status: 'no-entry-points' }
  | { status: 'guarded' }
  | { status: 'unguarded'; reason: string };

export function evaluateAdminServerFile(src: string): GuardVerdict {
  const sourceFile = ts.createSourceFile('file.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (hasDirective(sourceFile, 'use client')) return { status: 'client' };

  if (hasTopLevelSideEffect(sourceFile)) {
    return { status: 'unguarded', reason: 'module-scope statement performs a call before any request-scoped guard can run' };
  }

  const entries = collectEntries(sourceFile);
  if (entries.length === 0) return { status: 'no-entry-points' };

  const unguarded = entries.filter((e) => !e.guarded).map((e) => e.label);
  if (unguarded.length > 0) {
    return { status: 'unguarded', reason: `entry point(s) without a leading session guard: ${unguarded.join(', ')}` };
  }
  return { status: 'guarded' };
}
