/**
 * AST-based detector for web/app/admin/** SERVER pages (and, if any appear later, server
 * actions): does the file's default-exported async component call getAdminSessionFromCookies
 * (and redirect away on failure) before the first statement that reads data (a `db.` property
 * access, `await cookies()`/`redis` aside, or constructing a `*Repository(`)?
 *
 * A page with no data access at all (a plain redirect, a static form with no DB read) is not
 * required to carry the check — see EXPECTED_DATA_READING_SERVER_PAGES in the test file, which
 * is the reviewed, exact list of pages this detector must guard.
 *
 * Parses with the TypeScript compiler rather than matching text, for the same reason
 * admin-route-guard-detector.ts does: a guard mentioned only in a comment or a string, or a
 * check whose result is discarded, must not pass.
 */
import ts from 'typescript';

function isUseClientDirective(sourceFile: ts.SourceFile): boolean {
  const [first] = sourceFile.statements;
  if (!first || !ts.isExpressionStatement(first) || !ts.isStringLiteral(first.expression)) return false;
  return first.expression.text === 'use client';
}

function defaultExportFunctionBody(sourceFile: ts.SourceFile): ts.Block | undefined {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      return stmt.body;
    }
  }
  return undefined;
}

/** `const X = await getAdminSessionFromCookies();` as a standalone statement. */
function sessionVarName(stmt: ts.Statement): string | null {
  if (!ts.isVariableStatement(stmt)) return null;
  const [decl] = stmt.declarationList.declarations;
  if (!decl || !ts.isIdentifier(decl.name) || !decl.initializer) return null;
  const init = decl.initializer;
  if (!ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression)) return null;
  const callee = init.expression.expression;
  if (!ts.isIdentifier(callee) || callee.text !== 'getAdminSessionFromCookies') return null;
  return decl.name.text;
}

/** `if (!X) { redirect(...); }` or `if (!X) redirect(...);` — the shape every real page uses. */
function isRedirectOnMissingSession(stmt: ts.Statement, varName: string): boolean {
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

/** Does this single statement itself perform a data read (db.*, or `new XyzRepository(`)? */
function statementReadsData(stmt: ts.Statement): boolean {
  let found = false;
  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'db') {
      found = true;
      return;
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /Repository$/.test(node.expression.text)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(stmt);
  return found;
}

export type GuardVerdict =
  | { status: 'no-data-access' }
  | { status: 'guarded' }
  | { status: 'unguarded'; reason: string };

/**
 * Evaluates ONE server page/component source file. `no-data-access` means the detector found no
 * db/repository read at all, so the caller decides (via its own reviewed list) whether the file
 * was expected to need a guard.
 */
export function evaluateAdminPageGuard(src: string): GuardVerdict {
  const sourceFile = ts.createSourceFile('page.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (isUseClientDirective(sourceFile)) return { status: 'no-data-access' };

  const body = defaultExportFunctionBody(sourceFile);
  if (!body) return { status: 'no-data-access' };

  const stmts = body.statements;
  let guardEndIndex = -1; // index (exclusive) up to which the session guard completed
  for (let i = 0; i < stmts.length - 1; i++) {
    const varName = sessionVarName(stmts[i]);
    if (varName && isRedirectOnMissingSession(stmts[i + 1], varName)) {
      guardEndIndex = i + 2;
      break;
    }
  }

  const firstDataReadIndex = stmts.findIndex((s) => statementReadsData(s));
  if (firstDataReadIndex === -1) return { status: 'no-data-access' };

  if (guardEndIndex !== -1 && guardEndIndex <= firstDataReadIndex) return { status: 'guarded' };

  return {
    status: 'unguarded',
    reason:
      guardEndIndex === -1
        ? 'no getAdminSessionFromCookies() + redirect guard found before the data read'
        : 'the session guard runs AFTER a data read',
  };
}
