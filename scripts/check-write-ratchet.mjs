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
function stripCLikeComments(source) {
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

    if (c === '"' || c === "'" || c === '`') {
      stringDelim = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (c === '/' && source[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
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
export function scanRepo(root = ROOT) {
  const candidates = listCandidateRelPaths(root);
  const found = new Map();
  for (const relPath of candidates) {
    if (isExcludedPath(relPath)) continue;
    let content;
    try {
      content = readFileSync(join(root, ...relPath.split('/')), 'utf8');
    } catch {
      continue;
    }
    const kinds = detectPatterns(stripComments(content, extname(relPath)));
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
