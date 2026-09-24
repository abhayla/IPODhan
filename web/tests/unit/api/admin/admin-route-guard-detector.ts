/**
 * AST-based detector: does an exported HTTP-method handler in an admin route
 * file actually call the admin-auth guard, or does it only look like it?
 *
 * A regex-based version of this matched `await requireAdminAuth(` anywhere in
 * the function body (including inside a comment or a string) and
 * `withAdminAuth(` anywhere in the file (including inside a comment or an
 * unrelated string). Both are bypassable without a real guard being present.
 *
 * This version parses the file with the TypeScript compiler and accepts only
 * two shapes per exported HTTP-method handler:
 *
 *   (a) `export const METHOD = withAdminAuth(...)` — the export's
 *       initializer is itself a call to `withAdminAuth`.
 *   (b) `export async function METHOD(...) { ... }` (or
 *       `export const METHOD = async (...) => { ... }`) whose statement
 *       list — the function body, or the body of its first statement when
 *       that first statement is a `try` block (the pattern every real route
 *       in this codebase uses) — opens with exactly:
 *         `const X = await requireAdminAuth();`
 *         `if (X) return X;`  (or `if (X) { return X; }`)
 *       in that order, as the first two statements.
 */
import ts from 'typescript';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

function isWithAdminAuthCall(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isCallExpression(node)) return false;
  return ts.isIdentifier(node.expression) && node.expression.text === 'withAdminAuth';
}

/** Statements to inspect for the guard: unwraps a single leading `try` block. */
function guardCandidateStatements(body: ts.Block): readonly ts.Statement[] {
  const [first] = body.statements;
  if (first && ts.isTryStatement(first)) {
    return first.tryBlock.statements;
  }
  return body.statements;
}

/** `if (X) return X;` or `if (X) { return X; }` with no else. */
function isGuardReturnIf(stmt: ts.Statement, varName: string): boolean {
  if (!ts.isIfStatement(stmt) || stmt.elseStatement) return false;
  if (!ts.isIdentifier(stmt.expression) || stmt.expression.text !== varName) return false;
  const then = stmt.thenStatement;
  const inner = ts.isBlock(then) ? then.statements[0] : then;
  if (!inner || !ts.isReturnStatement(inner)) return false;
  return !!inner.expression && ts.isIdentifier(inner.expression) && inner.expression.text === varName;
}

/** `const X = await requireAdminAuth(...);` as a standalone statement. */
function guardedVarName(stmt: ts.Statement): string | null {
  if (!ts.isVariableStatement(stmt)) return null;
  const [decl] = stmt.declarationList.declarations;
  if (!decl || !ts.isIdentifier(decl.name) || !decl.initializer) return null;
  const init = decl.initializer;
  if (!ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression)) return null;
  const callee = init.expression.expression;
  if (!ts.isIdentifier(callee) || callee.text !== 'requireAdminAuth') return null;
  return decl.name.text;
}

function bodyIsGuarded(body: ts.Block | undefined): boolean {
  if (!body) return false;
  const stmts = guardCandidateStatements(body);
  if (stmts.length < 2) return false;
  const varName = guardedVarName(stmts[0]);
  if (!varName) return false;
  return isGuardReturnIf(stmts[1], varName);
}

function functionLikeBody(node: ts.Node): ts.Block | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    return node.body;
  }
  if (ts.isArrowFunction(node) && ts.isBlock(node.body)) {
    return node.body;
  }
  return undefined;
}

/**
 * Returns the HTTP methods exported by this route file that are NOT covered
 * by a real `withAdminAuth(` wrap or a real leading `requireAdminAuth()`
 * guard.
 */
export function unguardedMethods(src: string): string[] {
  const sourceFile = ts.createSourceFile('route.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const covered = new Set<string>();
  const declared = new Set<string>();

  for (const stmt of sourceFile.statements) {
    // export async function METHOD(...) { ... }
    if (ts.isFunctionDeclaration(stmt) && stmt.name && HTTP_METHODS.includes(stmt.name.text as (typeof HTTP_METHODS)[number])) {
      const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      const method = stmt.name.text;
      declared.add(method);
      if (bodyIsGuarded(stmt.body)) covered.add(method);
      continue;
    }

    // export const METHOD = withAdminAuth(...) | async (...) => { ... } | re-export list
    if (ts.isVariableStatement(stmt)) {
      const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const method = decl.name.text;
        if (!HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number])) continue;
        declared.add(method);
        if (isWithAdminAuthCall(decl.initializer)) {
          covered.add(method);
          continue;
        }
        if (decl.initializer) {
          const body = functionLikeBody(decl.initializer);
          if (bodyIsGuarded(body)) covered.add(method);
        }
      }
      continue;
    }

    // export { GET, POST } (re-export) — declared, never itself a guard
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const method = el.name.text;
        if (HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number])) declared.add(method);
      }
    }
  }

  return HTTP_METHODS.filter((m) => declared.has(m) && !covered.has(m));
}
