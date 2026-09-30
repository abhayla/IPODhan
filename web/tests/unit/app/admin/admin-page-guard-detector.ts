/**
 * AST-based, FAIL-CLOSED detector: for a non-client-component file under web/app/admin/**
 * (a page.tsx, layout.tsx, route.ts, or any file carrying a 'use server' directive — file-level
 * OR on an inline action nested anywhere inside another function), does EVERY exported entry
 * point AND every inline 'use server' action start with a real session guard, as that function's
 * OWN top-level statement (never inside a try, never satisfied by a call in a default parameter
 * that runs before the guard)?
 *
 * Round-1 review finding (#1324): the previous version classified a file as "no data access" (and
 * therefore exempt) unless it matched a literal `db.` property access or `new *Repository(`. That
 * let a whole class of reads pass silently. Round-1's rewrite fixed that but a second independent
 * review of it (#1325) found four more shapes a text/structure matcher still missed, because each
 * one is a shape the LANGUAGE allows that the detector's model of "guarded" did not cover:
 *
 *   1. File-header handling: a 'use server' file whose directive follows a leading doc comment.
 *      The OLD candidate-file scan used a regex anchored at literal file-start, so a leading
 *      `/** ... *\/` comment before the directive hid the file from the scan entirely — comments
 *      are trivia to the TypeScript parser, never a statement, so the fix is to let the parser
 *      decide (see `fileHasUseServerDirective`) instead of pattern-matching bytes.
 *   2. Nested entry points: an inline server action (`async function x(){ 'use server'; ... }`)
 *      declared INSIDE another function (e.g. inside an otherwise-guarded page component). The
 *      old walker only inspected top-level statements of the file, so a `'use server'` directive
 *      nested inside any function body was invisible to it. Every such nested action is itself a
 *      real RPC entry point Next.js exposes and must independently start with the guard.
 *   3. The guard swallowed by its own try/catch: the old code deliberately unwrapped a single
 *      leading `try` block so a guard placed inside one was still recognized — exactly backwards,
 *      because a `catch` around the guard can swallow the thrown redirect and let execution
 *      continue. The guard must now be a genuine top-level statement of the entry function, never
 *      nested inside any `try`.
 *   4. Allowlisted-by-path, not by content: ADMIN_SERVER_FILES_WITHOUT_DATA (in the test file) was
 *      exempted because of its filename, never because anything confirmed the file reads no data.
 *      A file on that list that later grows a data read stayed silently exempt. `fileHasNoDataAccess`
 *      below gives the test file something to check the claim against on every run.
 *   5. A default parameter that reads data: `function P(_p, rows = loadAll())` executes the default
 *      initializer BEFORE the function body's first statement runs — so a guard as the body's first
 *      statement never protects a data read sitting in a parameter default. `hasUnsafeDefaultParam`
 *      makes any such entry point unguarded regardless of what its body does.
 *
 * Accepted guard shapes (as the entry point's OWN first statement — never unwrapped out of a try):
 *   (a) `const X = await getAdminSessionFromCookies(); if (!X) { redirect(...); }`
 *   (b) `const X = await requireAdminAuth(); if (X) { return X; }` (the route-handler shape)
 *   (c) the entry point's value IS itself `withAdminAuth(...)`
 * A guard mentioned only in a comment, a discarded result, one that runs after other code, or one
 * sitting inside a try/catch is NOT accepted.
 *
 * A module-scope statement that performs a call (module-scope read/write, independent of any
 * request-scoped guard) is ALWAYS an offender — a guard inside a function can never protect code
 * that already ran at import time.
 */
import ts from 'typescript';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const NAMED_ENTRY_NAMES = new Set(['generateMetadata', ...HTTP_METHODS]);

/** Calls that never read application data — safe anywhere, including in an allowlisted file. */
const PURE_CALL_NAMES = new Set(['redirect', 'notFound']);

/**
 * Round-3 finding 2: a guard is recognised by WHERE its callee was imported from, never by name
 * alone. A local function or an import from another module that merely shares the name is not a
 * guard. Each canonical guard maps to its real module (alias form, or a relative path that ends in
 * the same tail).
 */
const TRUSTED_GUARD_MODULES: Record<string, { alias: string; tail: string }> = {
  getAdminSessionFromCookies: { alias: '@/lib/admin-accounts/admin-session', tail: 'admin-accounts/admin-session' },
  requireAdminAuth: { alias: '@/lib/auth/admin-auth', tail: 'auth/admin-auth' },
  withAdminAuth: { alias: '@/lib/middleware/admin-auth', tail: 'middleware/admin-auth' },
};

function specifierIsTrusted(canonical: string, spec: string): boolean {
  const t = TRUSTED_GUARD_MODULES[canonical];
  if (!t) return false;
  if (spec === t.alias) return true;
  return /^\.{1,2}\//.test(spec) && (spec.endsWith('/' + t.tail) || spec === './' + t.tail);
}

/** local identifier -> canonical guard name, for imports that come from the real module only. */
let trustedGuardLocals = new Map<string, string>();

function computeTrustedGuardLocals(sourceFile: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  const localDecls = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) localDecls.add(stmt.name.text);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) localDecls.add(d.name.text);
    }
  }
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      if (el.isTypeOnly) continue;
      const canonical = (el.propertyName ?? el.name).text;
      const local = el.name.text;
      if (localDecls.has(local)) continue; // a same-named local declaration shadows/duplicates it: not a guard
      if (specifierIsTrusted(canonical, stmt.moduleSpecifier.text)) out.set(local, canonical);
    }
  }
  return out;
}

function hasDirective(stmts: readonly ts.Statement[], text: string): boolean {
  const [first] = stmts;
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === text;
}

/** Whether the file's own leading statement (comments are trivia, never a statement) is `'use server'`. */
export function fileHasUseServerDirective(src: string): boolean {
  const sourceFile = ts.createSourceFile('file.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return hasDirective(sourceFile.statements, 'use server');
}

/** Unwraps a single leading directive-string statement only — NEVER a `try` (finding 3: a guard inside a try is not accepted). */
function unwrapLeadingDirective(stmts: readonly ts.Statement[]): readonly ts.Statement[] {
  const [first] = stmts;
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) return stmts.slice(1);
  return stmts;
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

function isGuardedStatements(stmts: readonly ts.Statement[]): boolean {
  const unwrapped = unwrapLeadingDirective(stmts);
  if (unwrapped.length < 2) return false;
  const pair = awaitedCallVar(unwrapped[0]);
  if (!pair) return false;
  const [varName, callee] = pair;
  const canonical = trustedGuardLocals.get(callee);
  if (canonical === 'getAdminSessionFromCookies') return isIfNotVarThenRedirect(unwrapped[1], varName);
  if (canonical === 'requireAdminAuth') return isIfVarThenReturnVar(unwrapped[1], varName);
  return false;
}

function isGuardedBody(body: ts.Block | undefined): boolean {
  if (!body) return false;
  return isGuardedStatements(body.statements);
}

function isWithAdminAuthCall(node: ts.Node | undefined): boolean {
  return !!node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && trustedGuardLocals.get(node.expression.text) === 'withAdminAuth';
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

/** Does any node in `root` perform a call other than the small pure allowlist? Never descends into a nested function/arrow — each one is checked as its own entry point instead. */
function hasDisallowedCall(root: ts.Node): boolean {
  let found = false;
  function visit(n: ts.Node) {
    if (found) return;
    if (n !== root && isFunctionLike(n)) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isPure = ts.isIdentifier(callee) && PURE_CALL_NAMES.has(callee.text);
      if (!isPure) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(root);
  return found;
}

/** Finding 5: a default parameter whose initializer can call out for data BEFORE the guard's first statement runs. */
function hasUnsafeDefaultParam(fn: FunctionLike): boolean {
  return fn.parameters.some((p) => p.initializer && hasDisallowedCall(p.initializer!));
}

/** Is `node` itself a guarded entry point value: a guarded function (with no unsafe default param), or a withAdminAuth(...) wrap? */
function nodeIsGuarded(node: ts.Node | undefined): boolean {
  if (!node) return false;
  if (isWithAdminAuthCall(node)) return true;
  if (!isFunctionLike(node)) return false;
  if (hasUnsafeDefaultParam(node)) return false;
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return false;
  return isGuardedBody(node.body as ts.Block);
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

/** Finding 2: every function anywhere in the file (nested inside another function included) whose OWN first statement is the `'use server'` directive is a distinct RPC entry point Next.js exposes, independent of any file-level directive. */
function collectInlineServerActions(sourceFile: ts.SourceFile): Entry[] {
  const entries: Entry[] = [];
  function visit(n: ts.Node) {
    if (isFunctionLike(n) && n.body && ts.isBlock(n.body) && hasDirective(n.body.statements, 'use server')) {
      const name = ts.isFunctionDeclaration(n) && n.name ? n.name.text : '(anonymous)';
      const guarded = !hasUnsafeDefaultParam(n) && isGuardedStatements(n.body.statements.slice(1));
      entries.push({ label: `inline server action ${name}`, guarded });
    }
    ts.forEachChild(n, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return entries;
}

/** Top-level declarations by local name (functions and variable initializers), exported or not. */
function topLevelDeclarations(sourceFile: ts.SourceFile): Map<string, ts.Node> {
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
  return topLevel;
}

/**
 * Round-3 finding 1: `export { local as GET }`, `export { Page as default }`, `export { x } from '...'`
 * and `export * from '...'`. A name resolvable to a same-file declaration is judged like a direct
 * export; anything not resolvable in this file is UNGUARDED (fail-closed) — only the reviewed
 * allowlist in the test file can exempt such a file.
 */
function collectExportDeclarationEntries(sourceFile: ts.SourceFile, fileIsUseServer: boolean): Entry[] {
  const entries: Entry[] = [];
  const topLevel = topLevelDeclarations(sourceFile);
  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt) || stmt.isTypeOnly) continue;
    const from = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined;
    if (!stmt.exportClause) {
      entries.push({ label: `export * from '${from}'`, guarded: false });
      continue;
    }
    if (ts.isNamespaceExport(stmt.exportClause)) {
      entries.push({ label: `export * as ${stmt.exportClause.name.text} from '${from}'`, guarded: false });
      continue;
    }
    for (const el of stmt.exportClause.elements) {
      if (el.isTypeOnly) continue;
      const exported = el.name.text;
      if (!(exported === 'default' || NAMED_ENTRY_NAMES.has(exported) || fileIsUseServer)) continue;
      const local = (el.propertyName ?? el.name).text;
      const target = from === undefined ? topLevel.get(local) : undefined;
      entries.push({ label: exported === 'default' ? 'default export' : exported, guarded: nodeIsGuarded(target) });
    }
  }
  return entries;
}

function collectEntries(sourceFile: ts.SourceFile): Entry[] {
  const entries: Entry[] = [];
  const def = resolveDefaultExport(sourceFile);
  if (def) entries.push({ label: 'default export', guarded: nodeIsGuarded(def) });

  const fileIsUseServer = hasDirective(sourceFile.statements, 'use server');

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (!isExported || isDefault) continue;
      const name = stmt.name.text;
      if (NAMED_ENTRY_NAMES.has(name) || fileIsUseServer) {
        entries.push({ label: name, guarded: nodeIsGuarded(stmt) });
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
  entries.push(...collectExportDeclarationEntries(sourceFile, fileIsUseServer));
  entries.push(...collectInlineServerActions(sourceFile));
  return entries;
}

/** Does a top-level statement (outside every function/arrow body) perform a call? */
function hasTopLevelSideEffect(sourceFile: ts.SourceFile): boolean {
  function callsAtOwnScope(node: ts.Node): boolean {
    let found = false;
    function visit(n: ts.Node) {
      if (found) return;
      if (n !== node && isFunctionLike(n)) return; // never descend into a nested function/arrow body
      if (ts.isCallExpression(n)) {
        found = true;
        return;
      }
      ts.forEachChild(n, visit);
    }
    if (isFunctionLike(node)) return false;
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

/**
 * Finding 4: proves a file reads no data by CONTENT, not by appearing on a path allowlist — any
 * call expression anywhere in the file other than the small pure allowlist (redirect, notFound;
 * JSX itself is never a CallExpression, so no JSX-specific exemption is needed) means the file is
 * not data-free.
 */
export function fileHasNoDataAccess(src: string): boolean {
  const sourceFile = ts.createSourceFile('file.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let disallowed = false;
  function visit(n: ts.Node) {
    if (disallowed) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isPure = ts.isIdentifier(callee) && PURE_CALL_NAMES.has(callee.text);
      if (!isPure) {
        disallowed = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sourceFile);
  return !disallowed;
}

export type GuardVerdict =
  | { status: 'client' }
  | { status: 'no-entry-points' }
  | { status: 'guarded' }
  | { status: 'unguarded'; reason: string };

export function evaluateAdminServerFile(src: string): GuardVerdict {
  const sourceFile = ts.createSourceFile('file.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (hasDirective(sourceFile.statements, 'use client')) return { status: 'client' };
  trustedGuardLocals = computeTrustedGuardLocals(sourceFile);

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
