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
  // T-318: also match a schema-qualified (`public.ipos`) or double-quoted
  // (`"ipos"`) identifier — both are valid Postgres references to the same
  // table that the original bare `ipos` pattern missed.
  raw_sql: /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?"?ipos"?\b/i,
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
 * Scans the repo tree for files matching any write-ratchet pattern.
 * @returns {Map<string, string[]>} relative POSIX path -> matched pattern kinds
 */
export function scanRepo(root = ROOT) {
  const files = [];
  walk(root, files);
  const found = new Map();
  for (const absPath of files) {
    const relPath = toPosix(relative(root, absPath));
    if (isExcludedPath(relPath)) continue;
    let content;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    const kinds = detectPatterns(content);
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

  const newFiles = [...found.keys()]
    .filter((f) => !baselineMap.has(f))
    .sort();
  const staleFiles = [...baselineMap.keys()]
    .filter((f) => !found.has(f))
    .sort();

  if (newFiles.length === 0 && staleFiles.length === 0) {
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
