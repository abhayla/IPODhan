#!/usr/bin/env node
/**
 * R0 write ratchet (T-316).
 *
 * A grep-based CI gate, NOT an ESLint rule (T-313C amendment): the dynamic
 * admin routes resolve their target table at runtime
 * (`(schema as any)[tableName]`, web/app/api/admin/dynamic/[table]/route.ts)
 * and the repo's raw .mjs/.sql writers are outside any TypeScript AST a lint
 * rule could see. A file-content grep catches both; a syntax-aware lint rule
 * cannot.
 *
 * Finds every file that writes to the `ipos` table (directly, via the
 * IPORepository call surface, via raw SQL, or via a runtime-resolved table
 * name) and compares that set against a checked-in baseline
 * (config/write-ratchet-baseline.json). The baseline can only shrink:
 *   - a NEW file not in the baseline -> FAIL (exit 1), named.
 *   - a baseline entry no longer found -> FAIL (exit 1) until the baseline
 *     is regenerated (`--update`) and the shrink is committed. This is what
 *     makes "ratchet only goes down" enforceable instead of aspirational —
 *     a stale baseline entry can otherwise be silently reused as cover for
 *     a differently-shaped write in the same file.
 *
 * See docs/architecture/write-path-hardening.md ("R0") for the rationale.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(__dirname, '..');
export const BASELINE_PATH = join(ROOT, 'config', 'write-ratchet-baseline.json');

export const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.sql']);

export const EXCLUDED_DIR_NAMES = new Set([
  'node_modules', '.git', '.next', 'dist', 'coverage', '.turbo', '.husky',
]);

// Segments (checked against the POSIX-normalized relative path) that are
// never live write sites even when a pattern matches inside them.
//
// T-318: the bare '/test/' segment was REMOVED (T-316 originally had it).
// It over-matched: a *route directory* literally named `test/` (e.g.
// `web/app/api/admin/notifications/test/route.ts`) is a live production
// write site, not a test fixture — only '/tests/' (plural), '__tests__/',
// '.test.', and '.spec.' are actual test-file conventions in this repo.
export const EXCLUDED_PATH_SEGMENTS = [
  '/tests/',
  '__tests__/',
  '.test.',
  '.spec.',
  '/drizzle/migrations/', // journal-tracked schema history, not a live writer
];

// The ratchet's own source/self-test files describe the patterns in prose
// and regex literals (e.g. this file's header comment mentions "INSERT INTO
// ipos") — they are not writers and must never self-match.
const SELF_EXCLUDED_FILES = new Set([
  'scripts/check-write-ratchet.mjs',
  'scripts/tests/check-write-ratchet.test.mjs',
]);

// Exactly four pattern classes (mutation-tested 1:1 in
// scripts/tests/check-write-ratchet.test.mjs) — deleting any one of these
// must turn its self-test fixture RED.
export const PATTERNS = {
  drizzle: /\.(insert|update|delete)\(\s*(schema\.)?ipos\b/,
  repository: /\bipoRepository\.(create|update|delete|upsert)\(/i,
  // T-318: also match a schema-qualified (`public.ipos`, `"public"."ipos"`)
  // or double-quoted (`"ipos"`) identifier — all are valid Postgres
  // references to the same table that the original bare `ipos` pattern
  // missed. The schema qualifier itself may or may not be quoted
  // independently of the table name (drizzle-kit/pg_dump commonly emit
  // `"public"."ipos"` with both sides quoted).
  raw_sql: /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+("?public"?\.)?"?ipos"?\b/i,
  dynamic_table: /(getTableFromSchema\(|\(schema\s+as\s+any\)\[)/,
};

function toPosix(p) {
  return p.split(sep).join('/');
}

function isExcludedPath(relPosixPath) {
  if (SELF_EXCLUDED_FILES.has(relPosixPath)) return true;
  const withSlashes = `/${relPosixPath}/`;
  return EXCLUDED_PATH_SEGMENTS.some((seg) =>
    seg.endsWith('/') ? withSlashes.includes(seg) : relPosixPath.includes(seg)
  );
}

// Extensions the TS compiler API can parse for import statements. `.sql` files
// have no import syntax and `.cjs` conventionally uses `require()`, which this
// resolver does not (yet) handle — a `require()`-based alias is out of scope
// here (T-527 issue #1323's fixtures are all ESM `import`).
const IMPORT_PARSEABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Marker kind for the FAIL-CLOSED case (#1335): a write target whose binding
 * arrives through an import/re-export hop the resolver could not follow
 * (missing file, unresolvable `export *`, cycle). It is not one of the four
 * PATTERNS: it is appended by scanRepo() so the file is reported, named, and
 * must be baselined or fixed like any other writer.
 */
export const UNRESOLVED_REEXPORT_KIND = 'unresolved_reexport';

// Non-relative specifiers that ARE the schema module (the source of `ipos`).
// Chain resolution is keyed on these import sources, never on identifier text.
const IPOS_SOURCE_SPECIFIERS = [
  /^@ipodhan\/shared(\/db(\/schema)?)?$/,
  /^@\/lib\/db(\/index)?$/,
  /(^|\/)db\/schema(\.[cm]?[jt]sx?)?$/,
];
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const MAX_CHAIN_DEPTH = 25;

const IPOS_ENTRY = Object.freeze({ kind: 'ipos' });
const UNRESOLVED_ENTRY = Object.freeze({ kind: 'unresolved' });

function posixDirname(rel) {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

function normalizePosix(rel) {
  const out = [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function parseSource(content, ext) {
  const scriptKind = ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile('file' + ext, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function hasExportModifier(node) {
  return (ts.getModifiers?.(node) ?? node.modifiers ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );
}

/**
 * Cross-file resolver for `ipos` bindings (#1335). `candidates` is the set of
 * repo-relative POSIX paths that can be import targets; `read(rel)` returns
 * their source (or null). Built once per scan and memoised per module.
 */
export function createChainResolver({ candidates, read, legacy = false }) {
  const candidateSet = candidates instanceof Set ? candidates : new Set(candidates);
  const moduleCache = new Map(); // rel -> { names: Map, opaque: boolean }

  function resolveSpecifier(fromRel, spec) {
    if (legacy) return IPOS_SOURCE_SPECIFIERS.some((re) => re.test(spec)) ? { schema: true } : { external: true };
    let base = null;
    if (spec.startsWith('.')) base = normalizePosix(posixDirname(fromRel) + '/' + spec);
    else if (spec.startsWith('@/')) base = 'web/' + normalizePosix(spec.slice(2));
    if (base !== null) {
      const tries = [base];
      for (const ext of RESOLVE_EXTENSIONS) tries.push(base + ext);
      const jsLike = base.match(/^(.*)\.[cm]?jsx?$/);
      if (jsLike) for (const ext of ['.ts', '.tsx']) tries.push(jsLike[1] + ext);
      for (const ext of RESOLVE_EXTENSIONS) tries.push(base + '/index' + ext);
      for (const t of tries) if (candidateSet.has(t)) return { rel: t };
    }
    if (IPOS_SOURCE_SPECIFIERS.some((re) => re.test(spec))) return { schema: true };
    if (base !== null) return { unresolved: true };
    return { external: true };
  }

  // The export table of a local module: { names: Map<name, entry>, opaque }.
  // `opaque` = the module star-re-exports something we could not resolve, so a
  // name absent from `names` may still come through it.
  function moduleExports(rel, stack) {
    if (moduleCache.has(rel)) return moduleCache.get(rel);
    if (stack.includes(rel) || stack.length > MAX_CHAIN_DEPTH) {
      return { names: new Map(), opaque: true };
    }
    const result = { names: new Map(), opaque: false };
    const content = read(rel);
    if (content === null || content === undefined) {
      result.opaque = true;
      moduleCache.set(rel, result);
      return result;
    }
    let sourceFile;
    try {
      sourceFile = parseSource(content, '.' + rel.split('.').pop());
    } catch {
      result.opaque = true;
      moduleCache.set(rel, result);
      return result;
    }
    const nextStack = [...stack, rel];
    const locals = collectLocalBindings(sourceFile, rel, nextStack);
    let cyclic = false;
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue;
        const spec = statement.moduleSpecifier?.text;
        const clause = statement.exportClause;
        if (spec !== undefined && !clause) {
          // export * from S
          const target = exportsOfSpecifier(rel, spec, nextStack);
          for (const [name, entry] of target.names) {
            if (name !== 'default') result.names.set(name, entry);
          }
          if (target.opaque) result.opaque = true;
          if (target.cyclic) cyclic = true;
        } else if (spec !== undefined && clause && ts.isNamespaceExport(clause)) {
          // export * as ns from S
          const target = exportsOfSpecifier(rel, spec, nextStack);
          result.names.set(clause.name.text, namespaceEntry(target));
        } else if (clause && ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue;
            const original = (element.propertyName ?? element.name).text;
            const exported = element.name.text;
            const entry =
              spec !== undefined
                ? lookupInSpecifier(rel, spec, original, nextStack)
                : (locals.get(original) ?? null);
            if (entry) result.names.set(exported, entry);
          }
        }
      } else if (ts.isExportAssignment(statement)) {
        if (ts.isIdentifier(statement.expression)) {
          const entry = locals.get(statement.expression.text);
          if (entry) result.names.set('default', entry);
        }
      } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          const entry = locals.get(decl.name.text);
          if (entry) result.names.set(decl.name.text, entry);
        }
      }
    }
    if (cyclic) result.opaque = true;
    moduleCache.set(rel, result);
    return result;
  }

  function exportsOfSpecifier(fromRel, spec, stack) {
    const r = resolveSpecifier(fromRel, spec);
    if (r.schema) return { names: new Map([['ipos', IPOS_ENTRY]]), opaque: false };
    if (r.external) return { names: new Map(), opaque: false };
    if (r.unresolved) return { names: new Map(), opaque: true };
    if (stack.includes(r.rel) || stack.length > MAX_CHAIN_DEPTH) {
      return { names: new Map(), opaque: true, cyclic: true };
    }
    return moduleExports(r.rel, stack);
  }

  function lookupInSpecifier(fromRel, spec, name, stack) {
    const r = resolveSpecifier(fromRel, spec);
    if (r.schema || r.external) return name === 'ipos' ? IPOS_ENTRY : null;
    if (r.unresolved) return name === 'ipos' ? IPOS_ENTRY : UNRESOLVED_ENTRY;
    const target = exportsOfSpecifier(fromRel, spec, stack);
    const entry = target.names.get(name);
    if (entry) return entry;
    // Legacy name-based fallback (#1323): the literal export name `ipos` is
    // still treated as the table when the hop is opaque.
    if (target.opaque) return name === 'ipos' ? IPOS_ENTRY : UNRESOLVED_ENTRY;
    return null;
  }

  function namespaceEntry(target) {
    if (target.opaque) return UNRESOLVED_ENTRY;
    const members = new Set();
    for (const [name, entry] of target.names) if (entry.kind === 'ipos') members.add(name);
    return { kind: 'ns', members };
  }

  // local binding name -> entry, from this file's imports plus simple
  // top-level `const y = x` / local `ipos` declarations.
  function collectLocalBindings(sourceFile, rel, stack) {
    const locals = new Map();
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const spec = statement.moduleSpecifier.text;
        if (clause.name) {
          const entry = lookupInSpecifier(rel, spec, 'default', stack);
          if (entry) locals.set(clause.name.text, entry);
        }
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          const r = resolveSpecifier(rel, spec);
          let entry;
          if (r.schema || r.external) entry = { kind: 'ns', members: new Set(['ipos']) };
          else entry = namespaceEntry(exportsOfSpecifier(rel, spec, stack));
          locals.set(bindings.name.text, entry);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            const original = (element.propertyName ?? element.name).text;
            const entry = lookupInSpecifier(rel, spec, original, stack);
            if (entry) locals.set(element.name.text, entry);
          }
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          if (decl.initializer && ts.isIdentifier(decl.initializer)) {
            const entry = locals.get(decl.initializer.text);
            if (entry) locals.set(decl.name.text, entry);
          } else if (decl.name.text === 'ipos') {
            locals.set('ipos', IPOS_ENTRY); // the schema definition itself
          }
        }
      }
    }
    return locals;
  }

  /** Bindings of one consumer file: local name -> entry. */
  function bindingsOf(rel, sourceFile) {
    return collectLocalBindings(sourceFile, rel, [rel]);
  }

  return { bindingsOf };
}

/**
 * Issue #1323 + #1335: resolve every local binding that IS the `ipos` table
 * (or a namespace carrying it) and rewrite it back to the literal shapes the
 * PATTERNS key on. Returns the rewritten source plus the local names whose
 * origin could not be resolved (the fail-closed set, see scanRepo).
 *
 * Without `chain` (a resolver from createChainResolver) only a file's OWN
 * import declarations are consulted (the #1323 behaviour). With it, relative
 * and `@/` specifiers are followed through `export {..} from`, `export *`,
 * `export * as`, `export default`, `import` + re-`export`, and `const y = x`
 * hops, to any depth, with cycles reported as unresolved.
 *
 * @returns {{ content: string, unresolved: string[] }}
 */
export function analyzeIposBindings(content, ext, chain, relPath) {
  const unchanged = { content, unresolved: [] };
  if (!IMPORT_PARSEABLE_EXTENSIONS.has(ext)) return unchanged;
  if (chain) {
    if (!/\.(insert|update|delete)\(/.test(content)) return unchanged; // only write sites matter
  } else if (!content.includes('ipos')) {
    return unchanged; // cheap short-circuit
  }

  let sourceFile;
  try {
    sourceFile = parseSource(content, ext);
  } catch {
    return unchanged;
  }

  let bindings;
  if (chain) {
    bindings = chain.bindingsOf(relPath, sourceFile);
  } else {
    bindings = createChainResolver({ candidates: [], read: () => null, legacy: true }).bindingsOf('file' + ext, sourceFile);
  }

  const namedAliases = new Set();
  const namespaceAliases = new Map(); // local -> Set of member names bearing ipos
  const unresolved = [];
  for (const [local, entry] of bindings) {
    if (entry.kind === 'ipos' && local !== 'ipos') namedAliases.add(local);
    else if (entry.kind === 'ns') namespaceAliases.set(local, entry.members);
    else if (entry.kind === 'unresolved') unresolved.push(local);
  }

  if (namedAliases.size === 0 && namespaceAliases.size === 0 && unresolved.length === 0) {
    return unchanged;
  }

  let rewritten = content;
  for (const alias of namedAliases) {
    rewritten = rewritten.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'g'), 'ipos');
  }
  for (const [nsAlias, members] of namespaceAliases) {
    for (const member of members) {
      if (nsAlias === 'schema' && member === 'ipos') continue; // already the pattern's literal qualifier
      rewritten = rewritten.replace(
        new RegExp(`\\b${escapeRegExp(nsAlias)}\\.${escapeRegExp(member)}\\b`, 'g'),
        'schema.ipos'
      );
    }
  }
  return { content: rewritten, unresolved };
}

/**
 * Backwards-compatible string form of analyzeIposBindings (no chain).
 * @param {string} content
 * @param {string} ext file extension including the leading dot
 * @returns {string}
 */
export function resolveIposImportAliases(content, ext) {
  return analyzeIposBindings(content, ext).content;
}

/** @returns {string[]} sorted list of matched pattern-kind names, empty if none */
export function detectPatterns(content) {
  const hits = [];
  for (const [kind, regex] of Object.entries(PATTERNS)) {
    if (regex.test(content)) hits.push(kind);
  }
  return hits.sort();
}

/**
 * Strips comments (prose) from `source` before pattern matching, so a
 * code comment that merely QUOTES or DISCUSSES a write statement (e.g. a
 * doc comment explaining why raw SQL was rejected, per
 * docs/architecture/write-path-hardening.md) never counts as a live write
 * site. String literals are left intact — a real SQL string embedded in
 * code must still match.
 *
 * Comment replacement preserves newlines and replaces other characters
 * with a single space, so line numbers and non-comment token adjacency
 * are unaffected.
 *
 * @param {string} source
 * @param {string} ext file extension including the leading dot (e.g. '.ts', '.py')
 * @returns {string}
 */
export function stripComments(source, ext) {
  return ext === '.py' ? stripPythonComments(source) : stripCLikeComments(source);
}

/**
 * Strips `//` line comments and `/* ... *\/` block comments (this also
 * covers JSDoc `/** ... *\/` blocks — a JSDoc block is a block comment,
 * there is no separate syntax to special-case) from JS/TS/SQL-family
 * source, respecting single/double/template string literals and their
 * backslash escapes so a comment marker inside a string is never treated
 * as a real comment start.
 */
// Tokens after which a `/` is a value (start of an expression) rather than
// a division operator — the standard lexer heuristic for disambiguating
// regex literals from division without a full parser.
const REGEX_CONTEXT_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';']);

/**
 * Looks backward through what has been emitted so far to decide whether a
 * `/` at the current position starts a regex literal (true) or is a
 * division operator (false). A `/` is division only when it directly
 * follows a value-producing token: an identifier/number (`ipos`, `2`), a
 * `)` (call/paren result), or a `]` (array/index result) — the `return`
 * keyword is the one identifier-like exception that still opens a regex
 * (`return /foo/.test(x)`). Start-of-source and every other punctuator
 * (`(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `}`, `;`) are regex
 * contexts.
 */
function isRegexContext(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j -= 1;
  if (j < 0) return true;

  const ch = out[j];
  if (REGEX_CONTEXT_CHARS.has(ch)) return true;

  if (/[A-Za-z0-9_$)\]]/.test(ch)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k -= 1;
    const word = out.slice(k + 1, j + 1);
    return word === 'return';
  }

  return true;
}

/**
 * Skips over a regex literal starting at `source[i]` (the opening `/`),
 * respecting backslash escapes and `[...]` character classes (where an
 * unescaped `/` does not end the literal), and appending it to `out`
 * unchanged — a regex literal is a value, not prose, so it must never be
 * blanked or mistaken for a comment delimiter.
 * @returns {number} the index immediately after the literal (including any
 *   trailing flags), i.e. the resumed scan position
 */
function copyRegexLiteral(source, i, out) {
  const n = source.length;
  out.out += source[i];
  let j = i + 1;
  let inClass = false;
  while (j < n) {
    const c = source[j];
    out.out += c;
    if (c === '\\' && j + 1 < n) {
      out.out += source[j + 1];
      j += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j += 1;
      break;
    } else if (c === '\n') {
      // Unterminated literal (or this wasn't actually a regex) — bail
      // without consuming the newline as part of it.
      out.out = out.out.slice(0, -1);
      return j;
    }
    j += 1;
  }
  while (j < n && /[a-zA-Z]/.test(source[j])) {
    out.out += source[j];
    j += 1;
  }
  return j;
}

function stripCLikeComments(source) {
  const out = { out: '' };
  let i = 0;
  const n = source.length;
  let stringDelim = null;

  while (i < n) {
    const c = source[i];

    if (stringDelim) {
      if (c === '\\' && i + 1 < n) {
        out.out += c + source[i + 1];
        i += 2;
        continue;
      }
      out.out += c;
      if (c === stringDelim) stringDelim = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      stringDelim = c;
      out.out += c;
      i += 1;
      continue;
    }

    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') {
        out.out += ' ';
        i += 1;
      }
      continue;
    }

    if (c === '/' && source[i + 1] === '*') {
      out.out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out.out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) {
        out.out += '  ';
        i += 2;
      }
      continue;
    }

    if (c === '/' && isRegexContext(out.out)) {
      i = copyRegexLiteral(source, i, out);
      continue;
    }

    out.out += c;
    i += 1;
  }

  return out.out;
}

/**
 * Strips `#` line comments from Python source, respecting single/double
 * quoted string literals and their backslash escapes. (Triple-quoted
 * strings are not special-cased: a `#` inside one is rare enough for this
 * ratchet's purpose, and none of the scanned extensions are `.py` today —
 * this branch exists for parity/tests, not a live scan path.)
 */
function stripPythonComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let stringDelim = null;

  while (i < n) {
    const c = source[i];

    if (stringDelim) {
      if (c === '\\' && i + 1 < n) {
        out += c + source[i + 1];
        i += 2;
        continue;
      }
      out += c;
      if (c === stringDelim) stringDelim = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      stringDelim = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '#') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCAN_EXTENSIONS.has(extname(entry.name))) continue;
    out.push(join(dir, entry.name));
  }
}

/**
 * Enumerates candidate files via the walker (readdirSync). This scans the
 * WHOLE working tree, including gitignored/untracked files — which is why
 * it is only the fallback (see listCandidateRelPaths). W-69: local leftover
 * scripts (never committed) were being reported as new baseline violations.
 * @returns {string[]} relative POSIX paths, already extension-filtered
 */
function walkCandidateRelPaths(root) {
  const files = [];
  walk(root, files);
  return files.map((absPath) => toPosix(relative(root, absPath)));
}

/**
 * Enumerates candidate files via `git ls-files -z` — TRACKED files only.
 * The ratchet guards what gets COMMITTED, so gitignored/untracked leftover
 * scripts (common on a dev machine) must never be scanned (W-69). Falls
 * back to the readdirSync walker (which does not distinguish tracked from
 * ignored) when git itself is unavailable, printing a one-line warning.
 * @returns {string[]} relative POSIX paths, already extension-filtered
 */
function listCandidateRelPaths(root) {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch (err) {
    console.error(
      `[write-ratchet] WARNING: \`git ls-files\` unavailable (${err.message}); ` +
        'falling back to a full directory walk, which may also scan gitignored files.'
    );
    return walkCandidateRelPaths(root);
  }
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((relPath) => SCAN_EXTENSIONS.has(extname(relPath)));
}

/**
 * Scans the repo tree for files matching any write-ratchet pattern.
 * @returns {Map<string, string[]>} relative POSIX path -> matched pattern kinds
 */
export function scanRepo(root = ROOT, candidatesOverride = null) {
  const candidates = candidatesOverride ?? listCandidateRelPaths(root);
  const contentCache = new Map();
  const readRel = (relPath) => {
    if (contentCache.has(relPath)) return contentCache.get(relPath);
    let text = null;
    try {
      text = readFileSync(join(root, ...relPath.split('/')), 'utf8');
    } catch {
      text = null;
    }
    contentCache.set(relPath, text);
    return text;
  };
  const chain = createChainResolver({ candidates: new Set(candidates), read: readRel });
  const found = new Map();
  for (const relPath of candidates) {
    if (isExcludedPath(relPath)) continue;
    const content = readRel(relPath);
    if (content === null) continue;
    const ext = extname(relPath);
    const analysis = analyzeIposBindings(content, ext, chain, relPath);
    const stripped = stripComments(analysis.content, ext);
    const kinds = detectPatterns(stripped);
    // Fail closed (#1335): a write target whose binding came through a hop we
    // could not resolve is reported rather than silently passed.
    const writtenUnresolved = analysis.unresolved.some((local) =>
      new RegExp(`\\.(insert|update|delete)\\(\\s*${escapeRegExp(local)}\\b`).test(stripped)
    );
    if (writtenUnresolved) kinds.push(UNRESOLVED_REEXPORT_KIND);
    kinds.sort();
    if (kinds.length > 0) found.set(relPath, kinds);
  }
  return found;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return { generated_from: 'scripts/check-write-ratchet.mjs', files: [] };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function baselineToMap(baseline) {
  const map = new Map();
  for (const entry of baseline.files) {
    map.set(entry.file, [...entry.patterns].sort());
  }
  return map;
}

function writeBaseline(foundMap) {
  const files = [...foundMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, patterns]) => ({ file, patterns }));
  const baseline = {
    _comment:
      'Write-ratchet baseline (T-316/R0). Shrink-only allowlist of files that ' +
      'write to `ipos` directly or via a runtime-resolved table name. ' +
      'Regenerate with `node scripts/check-write-ratchet.mjs --update` only ' +
      'when REMOVING an entry (a file was fixed to route through the shared ' +
      'write path). NEVER add a new entry to grandfather a new violation — ' +
      'route the new write through the shared path instead. See ' +
      'docs/architecture/write-path-hardening.md.',
    generated_by: 'scripts/check-write-ratchet.mjs --update',
    count: files.length,
    files,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  return files.length;
}

/**
 * Compares the live scan (`found`, relative POSIX path -> matched pattern
 * kinds) against the baseline map (relative POSIX path -> baselined pattern
 * kinds), at BOTH the file-set level (T-316's original contract) and the
 * per-file pattern-set level: a file already in the baseline that gains a
 * write-pattern KIND the baseline never recorded is a real regression even
 * though the file itself is not new — e.g. a file baselined only for
 * `repository` writes that starts also matching `raw_sql`.
 *
 * A pattern kind disappearing from an already-baselined file (the file
 * itself still matches, just fewer kinds) is a shrink, not a regression —
 * reported as an informational note only (mirrors why STALE, a whole-file
 * shrink, still requires `--update` to commit: shrinks are good, but only
 * FAIL forces them to be committed instead of silently going stale forever;
 * per-pattern shrinks are common byproducts of unrelated edits and would
 * make the gate too noisy to fail on).
 *
 * @returns {{
 *   newFiles: string[],
 *   staleFiles: string[],
 *   newPatterns: {file: string, kinds: string[]}[],
 *   shrunkPatterns: {file: string, kinds: string[]}[],
 * }}
 */
export function diffAgainstBaseline(found, baselineMap) {
  const newFiles = [...found.keys()].filter((f) => !baselineMap.has(f)).sort();
  const staleFiles = [...baselineMap.keys()].filter((f) => !found.has(f)).sort();

  const newPatterns = [];
  const shrunkPatterns = [];
  for (const file of [...found.keys()].sort()) {
    if (!baselineMap.has(file)) continue; // already reported as NEW
    const baselineKinds = new Set(baselineMap.get(file));
    const foundKinds = found.get(file);
    const added = foundKinds.filter((k) => !baselineKinds.has(k));
    const removed = [...baselineKinds].filter((k) => !foundKinds.includes(k));
    if (added.length > 0) newPatterns.push({ file, kinds: added });
    if (removed.length > 0) shrunkPatterns.push({ file, kinds: removed });
  }

  return { newFiles, staleFiles, newPatterns, shrunkPatterns };
}

function main() {
  const args = process.argv.slice(2);
  const found = scanRepo();

  if (args.includes('--update')) {
    const count = writeBaseline(found);
    console.log(`[write-ratchet] baseline regenerated: ${count} files.`);
    return 0;
  }

  const baseline = loadBaseline();
  const baselineMap = baselineToMap(baseline);

  const diff = diffAgainstBaseline(found, baselineMap);
  const { newFiles, staleFiles, newPatterns, shrunkPatterns } = diff;

  const hasFailure = newFiles.length > 0 || staleFiles.length > 0 || newPatterns.length > 0;

  if (!hasFailure) {
    if (shrunkPatterns.length > 0) {
      console.log(
        '[write-ratchet] NOTE — baselined file(s) lost a write pattern (a shrink; run ' +
          '--update to record it, not required to pass):'
      );
      for (const { file, kinds } of shrunkPatterns) {
        console.log(`  SHRUNK: ${file}  [${kinds.join(', ')}]`);
      }
    }
    console.log(
      `[write-ratchet] PASS — ${found.size} files match baseline (config/write-ratchet-baseline.json).`
    );
    return 0;
  }

  if (newFiles.length > 0) {
    console.error('[write-ratchet] FAIL — new file(s) write to `ipos` outside the baseline:');
    for (const f of newFiles) {
      console.error(`  NEW: ${f}  [${found.get(f).join(', ')}]`);
    }
    console.error(
      '\nRoute the write through the shared write path instead of adding it here. ' +
        'See docs/architecture/write-path-hardening.md.'
    );
  }

  if (newPatterns.length > 0) {
    console.error(
      '[write-ratchet] FAIL — baselined file(s) gained a new write pattern not recorded in the ' +
        'baseline:'
    );
    for (const { file, kinds } of newPatterns) {
      console.error(`  NEW-PATTERN: ${file}  [${kinds.join(', ')}]`);
    }
    console.error(
      '\nRoute the new write through the shared write path, or if this is a reviewed and ' +
        'approved new write surface, run `node scripts/check-write-ratchet.mjs --update` and ' +
        'commit the regenerated config/write-ratchet-baseline.json.'
    );
  }

  if (staleFiles.length > 0) {
    console.error(
      '[write-ratchet] FAIL — baseline entry no longer found (the ratchet only shrinks, ' +
        'and a shrink must be committed):'
    );
    for (const f of staleFiles) {
      console.error(`  STALE: ${f}`);
    }
    console.error(
      '\nRun `node scripts/check-write-ratchet.mjs --update` and commit the regenerated ' +
        'config/write-ratchet-baseline.json.'
    );
  }

  return 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  process.exit(main());
}
