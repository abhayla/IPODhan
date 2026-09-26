#!/usr/bin/env node
// Deleted-file-still-referenced gate (issue #1193, class
// `deleted-file-still-referenced-by-ci`).
//
// WHY THIS EXISTS. PR #1189 (the #167 review-page retirement) hit this class
// three times: a stale count in config/scripts-typecheck-exclude-baseline.json,
// a hardcoded filename in check-drizzle-where-chaining.test.mjs that caused an
// ENOENT, and two web tests still importing/driving deleted routes that no PR
// workflow runs. A deletion PR needs a positive check that nothing tracked
// still names the file it just removed.
//
// What it does: for every path `git diff --diff-filter=D` reports deleted
// between <base> and HEAD, grep the tracked tree (via `git grep`, so it
// respects .gitignore and needs no hand-rolled walk) for two needles:
//   1. the full repo-relative path (any file naming the exact path it deleted
//      is almost certainly a live reference — an import, a fixture list, a
//      hardcoded test path);
//   2. the basename without its extension, but ONLY as a whole token
//      (word-boundary match) and only on a line that also carries a path
//      separator ('/') or a quote character — this is the "it looks like a
//      reference, not English prose" filter, tuned against real history so a
//      docs sentence like "the retired admin-reviews route" does not fire.
// Excluded from the search: docs/, *.md, node_modules, .next, dist, and
// CHANGELOG* — matches in prose/changelogs are not CI-breaking references.
// A DIRECTORY COUNT FLOOR (e.g. a test asserting `>= N` route files) is NOT a
// name reference and this check cannot see it — see the header note on the
// third #1189 occurrence below.
//
// NOTE ON COUNT FLOORS (2026-09-26, 3rd #1189 occurrence): a directory-count
// assertion such as `web/tests/unit/api/admin/admin-routes-static-guard.test.ts`
// checking `>= 31` route files breaks when a deletion drops the count, but it
// names no path and no basename, so no grep-based check (this one included)
// can flag it. That class is covered by the OTHER half of the mechanism: a
// deletion PR runs the full unit suite of every touched workspace once before
// push (see the builder brief template / defect-fix-contract.md), not by this
// script. This script is the "grep" half only.
//
// Usage:
//   node scripts/ci/check-deleted-file-references.mjs [baseRef] [headRef]
// Env:
//   BASE_REF, HEAD_REF   override the git refs to diff (default:
//                        origin/main...HEAD in CI, HEAD~1...HEAD locally)
//
// Exit 0 = no deleted file is still referenced. Exit 1 = at least one hit,
// each printed as `<deleted path> <- <referencing file>:<line>`. Exit 2 = the
// checker itself failed (bad git state, etc).

import { execFileSync } from 'node:child_process';
import { extname, basename } from 'node:path';

const EXCLUDE_DIR_RE = /(^|\/)(node_modules|\.next|dist|docs)\//;
const EXCLUDE_FILE_RE = /(^|\/)CHANGELOG(\.[^/]*)?$/i;
const MD_EXT_RE = /\.md$/i;

function sh(args, opts = {}) {
  return execFileSync(args[0], args.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  }).trim();
}

function tryFetch(base) {
  const remoteBranch = base.replace(/^origin\//, '');
  try {
    sh(['git', 'fetch', '--quiet', 'origin', remoteBranch]);
  } catch {
    // Best-effort — local dev may already have the ref, or may be offline.
  }
}

export function resolveRefs(argv, env) {
  const base = argv[0] || env.BASE_REF || 'origin/main';
  const head = argv[1] || env.HEAD_REF || 'HEAD';
  return { base, head };
}

export function getDeletedFiles(base, head, cwd) {
  const range = `${base}...${head}`;
  let out;
  try {
    out = sh(['git', 'diff', '--name-only', '--diff-filter=D', range], { cwd });
  } catch (e) {
    throw new Error(`git diff failed for range ${range}: ${e.message}`);
  }
  return out ? out.split('\n').filter(Boolean) : [];
}

function isExcludedPath(path) {
  if (EXCLUDE_DIR_RE.test(path)) return true;
  if (MD_EXT_RE.test(path)) return true;
  if (EXCLUDE_FILE_RE.test(path)) return true;
  return false;
}

// Escape a literal string for use inside a POSIX extended-regex (git grep -E).
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Run `git grep` for a pattern across tracked files at HEAD (the ref we are
// checking, i.e. head), excluding the given pathspec globs. Returns lines of
// the form "path:lineno:content".
function gitGrep(pattern, { cwd, head }) {
  const args = [
    'git', 'grep', '-n', '-I', '--extended-regexp', pattern, head,
    '--',
    '.',
    ':(exclude)node_modules',
    ':(exclude)**/node_modules/**',
    ':(exclude).next',
    ':(exclude)**/.next/**',
    ':(exclude)dist',
    ':(exclude)**/dist/**',
    ':(exclude)docs/**',
    ':(exclude)*.md',
    ':(exclude)**/*.md',
    ':(exclude)CHANGELOG*',
    ':(exclude)**/CHANGELOG*',
  ];
  try {
    const out = sh(args, { cwd });
    return out ? out.split('\n').filter(Boolean) : [];
  } catch (e) {
    // git grep exits 1 with no output on "no matches" — that's not an error.
    if (e.status === 1 && !e.stdout) return [];
    if (typeof e.status === 'number' && e.status === 1) return [];
    throw e;
  }
}

// Parse a `git grep -n <ref>:<path>` style line ("<ref>:<path>:<lineno>:<content>")
// down to { path, lineno, content } (path is the ref-relative repo path).
function parseGrepLine(line, head) {
  const prefix = `${head}:`;
  const rest = line.startsWith(prefix) ? line.slice(prefix.length) : line;
  const firstColon = rest.indexOf(':');
  const path = rest.slice(0, firstColon);
  const remainder = rest.slice(firstColon + 1);
  const secondColon = remainder.indexOf(':');
  const lineno = remainder.slice(0, secondColon);
  const content = remainder.slice(secondColon + 1);
  return { path, lineno, content };
}

// Filenames so generic (Next.js route-file conventions, or otherwise reused
// dozens of times per repo with no relation to each other) that a bare
// basename match is pure noise without directory context. Tuned against real
// history (#1189): deleting web/app/admin/reviews/page.tsx made a basename
// search for "page" hit ~28,000 unrelated lines (every other page.tsx import,
// every CSV/doc row that happens to contain the English word "page"). The
// exact-path check (a) still catches a real reference to one of these; this
// stoplist only disables the basename-only fallback (b) for them.
const GENERIC_BASENAMES = new Set([
  'index', 'page', 'layout', 'route', 'loading', 'error', 'not-found',
  'template', 'default', 'types', 'type', 'utils', 'util', 'helpers',
  'helper', 'config', 'constants', 'styles', 'style', 'test', 'spec',
  'main', 'app', 'schema', 'client', 'server', 'middleware', 'actions',
]);

// Find every real reference (in a tracked, non-excluded file) to `deletedPath`.
// A "reference" is either:
//   (a) the exact deleted path appearing verbatim somewhere in a file, or
//   (b) the basename-without-extension appearing as a whole token AND
//       directly adjacent (immediately touching, not just "somewhere on the
//       line") to a path separator or a quote character on at least one
//       side — i.e. it reads as part of a path or a quoted filename, not as
//       an English word inside prose or CSV data. Skipped for basenames in
//       GENERIC_BASENAMES, which are too common to disambiguate this way.
export function findReferences(deletedPath, { cwd, head }) {
  const hits = [];
  const seen = new Set();

  const addHits = (lines) => {
    for (const line of lines) {
      const { path, lineno, content } = parseGrepLine(line, head);
      if (path === deletedPath) continue; // can't self-reference; it's deleted anyway
      if (isExcludedPath(path)) continue;
      const key = `${path}:${lineno}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path, lineno: Number(lineno), content: content.trim() });
    }
  };

  // (a) exact repo-relative path, verbatim.
  const exactPattern = escapeRegex(deletedPath);
  addHits(gitGrep(exactPattern, { cwd, head }));

  // (b) basename without extension, whole-token, immediately touching a path
  // separator or a quote/backtick on at least one side.
  const ext = extname(deletedPath);
  const base = ext ? basename(deletedPath, ext) : basename(deletedPath);
  if (base && base.length >= 4 && !GENERIC_BASENAMES.has(base.toLowerCase())) {
    const escaped = escapeRegex(base);
    // git grep -P would allow \b directly, but -E (POSIX ERE, portable across
    // the grep this repo's CI ships) has no lookaround, so match the token
    // plus one adjacent side-marker char and re-check adjacency in JS.
    const tokenPattern = `(^|[/'"\`.]|[^A-Za-z0-9_-])${escaped}([/'"\`.]|[^A-Za-z0-9_-]|$)`;
    const lines = gitGrep(tokenPattern, { cwd, head });
    const boundaryRe = /^[/'"`.]$/;
    const filtered = lines.filter((line) => {
      const { content } = parseGrepLine(line, head);
      // Re-scan in JS with a case-sensitive whole-token match, requiring the
      // char immediately before OR immediately after the token to be a path
      // separator, quote, backtick or dot (not just "any non-word char" —
      // that includes commas/spaces/colons, which is what let CSV/prose rows
      // through before this tightened check).
      const re = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})($|[^A-Za-z0-9_-])`, 'g');
      let m;
      while ((m = re.exec(content)) !== null) {
        const before = m[1];
        const after = m[3];
        if (boundaryRe.test(before) || boundaryRe.test(after)) return true;
      }
      return false;
    });
    addHits(filtered);
  }

  return hits;
}

export function checkDeletedFileReferences({ base, head, cwd = process.cwd() } = {}) {
  const deleted = getDeletedFiles(base, head, cwd);
  const violations = [];
  for (const deletedPath of deleted) {
    if (isExcludedPath(deletedPath)) continue;
    const refs = findReferences(deletedPath, { cwd, head });
    for (const ref of refs) {
      violations.push({ deletedPath, ...ref });
    }
  }
  return { deleted, violations };
}

async function main() {
  const argv = process.argv.slice(2);
  const env = process.env;
  const inCi = !!env.CI;
  const { base: rawBase, head } = resolveRefs(
    argv,
    inCi ? env : { ...env, BASE_REF: env.BASE_REF || 'HEAD~1' }
  );
  const base = rawBase;

  if (base.startsWith('origin/')) tryFetch(base);

  let result;
  try {
    result = checkDeletedFileReferences({ base, head, cwd: process.cwd() });
  } catch (e) {
    console.error(`check-deleted-file-references: checker failed: ${e.message}`);
    process.exit(2);
    return;
  }

  if (result.deleted.length === 0) {
    console.log('check-deleted-file-references: no files deleted in this range.');
    process.exit(0);
    return;
  }

  if (result.violations.length === 0) {
    console.log(
      `check-deleted-file-references: ${result.deleted.length} file(s) deleted, no live references found.`
    );
    process.exit(0);
    return;
  }

  console.error(
    `check-deleted-file-references: ${result.violations.length} reference(s) to deleted file(s) found:\n`
  );
  for (const v of result.violations) {
    console.error(`  ${v.deletedPath} <- ${v.path}:${v.lineno}`);
    console.error(`      ${v.content}`);
  }
  console.error(
    '\nA deleted file is still named by a tracked, non-doc file. Update or remove the reference, ' +
      'or if this is a false positive (e.g. a coincidental basename collision), narrow the reference ' +
      'or add it to this script\'s exclusions with a one-line reason.'
  );
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain || process.argv[1]?.endsWith('check-deleted-file-references.mjs')) {
  main();
}
