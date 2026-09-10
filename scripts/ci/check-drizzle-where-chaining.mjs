#!/usr/bin/env node
// #488 detection gate: Drizzle's `.where()` REPLACES the previous where
// clause rather than ANDing it, so `query = query.where(a); query =
// query.where(b);` on the same builder silently drops `a`. This is a
// class-level heuristic scan, not a type-checker or AST parser: it flags a
// variable that is re-assigned from `<ident>.where(` more than once within
// one function body, UNLESS every occurrence but the first sits inside an
// `else` branch (the one shape that's provably safe — see
// web/app/api/tools/lot-calculator/route.ts:64-73).
//
// Usage:
//   node scripts/ci/check-drizzle-where-chaining.mjs [--root <repoRoot>]
// Exit codes:
//   0  clean — no re-assigning `.where()` chain found outside an if/else pair
//   1  a re-assigning `.where()` chain was found — a real finding
//   2  the check itself failed (bad root, zero files scanned)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// #488: files with a KNOWN, already-tracked pending fix, excluded here so
// this new gate does not block pr-gate on a defect being fixed elsewhere.
// This lives in the checker (not as an in-file marker) because the task
// fixing it — lane C's open slice — must not have its file touched by this
// PR. Remove an entry the same day its PR lands; a stale entry here hides a
// real regression the next time someone edits that file.
//   scraper/src/jobs/ipo-reviews-job.ts — already fixed on lane C's branch
//     fix/pm-c-item02-s3a-segment-honest-null (see issue #488); not yet
//     merged to main at the time of this PR.
const KNOWN_PENDING_EXEMPTIONS = new Set([join('scraper', 'src', 'jobs', 'ipo-reviews-job.ts')]);

const SCAN_ROOTS = [
  'packages/shared/src',
  'web/lib',
  'web/app',
  'scraper/src',
  'scraper/scripts',
];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.git']);
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = argv[++i];
  }
  return args;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.has(extnameOf(entry)) && !TEST_FILE_PATTERN.test(entry)) {
      out.push(full);
    }
  }
}

function extnameOf(name) {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx);
}

/**
 * Split a file's lines into function-body blocks using brace-depth tracking
 * from each line matching a function/method opener. This is intentionally
 * coarse (no real parser) — it is a detection heuristic, not a compiler.
 * Returns an array of { startLine, endLine, lines } (1-indexed, inclusive).
 */
function splitIntoFunctionBlocks(lines) {
  const blocks = [];
  // Three independent shapes (kept as separate alternatives, each anchored
  // its own way, rather than one shared `\b(async\s+)?` prefix — combining
  // them behind one shared prefix broke the `^`-anchored method-shorthand
  // alternative: consuming "async " first shifts the match position past
  // index 0, so `^` (no /m flag; each entry is already a single line) can
  // never match inside that alternative again).
  const FUNCTION_DECL = /^\s*(export\s+)?(default\s+)?(async\s+)?function\b/;
  const ARROW_BLOCK = /\)\s*(:\s*[^={]+)?\s*=>\s*\{/;
  const METHOD_SHORTHAND = /^\s*(private\s+|protected\s+|public\s+|static\s+|readonly\s+|async\s+|\*\s*)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(:\s*[^{]+)?\{/;
  const FUNCTION_OPENER = { test: (line) => FUNCTION_DECL.test(line) || ARROW_BLOCK.test(line) || METHOD_SHORTHAND.test(line) };

  for (let i = 0; i < lines.length; i++) {
    if (!FUNCTION_OPENER.test(lines[i])) continue;
    // Find the opening brace for this construct, then track depth to its close.
    let depth = 0;
    let started = false;
    let j = i;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') {
          depth--;
        }
      }
      if (started && depth <= 0) break;
    }
    if (started) {
      blocks.push({ startLine: i + 1, endLine: Math.min(j + 1, lines.length), lines: lines.slice(i, j + 1) });
    }
  }
  return blocks;
}

/**
 * Within one function block, find every `<ident> = <ident2>.where(` (or
 * `let/const <ident> = ... .where(` at declaration) re-assignment of the SAME
 * identifier. Returns findings when a second+ occurrence exists and it is
 * NOT immediately preceded (skipping blank/comment lines) by an `else` (or
 * `} else {`) — the one shape proven safe (mutually exclusive branches).
 */
function findReassigningWhereChains(block, filePath) {
  const WHERE_ASSIGN = /^\s*(?:let\s+|const\s+)?([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.]*\.where\(/;
  const occurrencesByIdent = new Map();

  block.lines.forEach((line, idx) => {
    const m = WHERE_ASSIGN.exec(line);
    if (!m) return;
    const ident = m[1];
    const absoluteLine = block.startLine + idx;
    if (!occurrencesByIdent.has(ident)) occurrencesByIdent.set(ident, []);
    occurrencesByIdent.get(ident).push({ line: absoluteLine, idx, text: line.trim() });
  });

  const findings = [];
  for (const [ident, occs] of occurrencesByIdent) {
    if (occs.length < 2) continue;

    // Check whether every occurrence after the first is guarded by an
    // immediately-preceding `else` (safe: mutually exclusive branches).
    let allElseGuarded = true;
    for (let k = 1; k < occs.length; k++) {
      const occIdx = occs[k].idx;
      let safe = false;
      for (let back = occIdx - 1; back >= 0 && back >= occIdx - 6; back--) {
        const prevLine = block.lines[back].trim();
        if (prevLine === '' || prevLine.startsWith('//')) continue;
        if (/^\}?\s*else\b/.test(prevLine)) {
          safe = true;
        }
        break; // only look at the nearest non-blank line
      }
      if (!safe) {
        allElseGuarded = false;
        break;
      }
    }

    if (!allElseGuarded) {
      findings.push({
        file: filePath,
        identifier: ident,
        lines: occs.map((o) => o.line),
      });
    }
  }
  return findings;
}

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const blocks = splitIntoFunctionBlocks(lines);
  const findings = [];
  for (const block of blocks) {
    findings.push(...findReassigningWhereChains(block, filePath));
  }
  return findings;
}

export function runCheck(root) {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    walk(join(root, scanRoot), files);
  }

  if (files.length === 0) {
    return { ok: false, error: `zero files scanned under ${SCAN_ROOTS.join(', ')} (root=${root})`, findings: [] };
  }

  const findings = [];
  const seen = new Set();
  for (const file of files) {
    const relPath = relative(root, file);
    if (KNOWN_PENDING_EXEMPTIONS.has(relPath)) continue;
    for (const finding of scanFile(file)) {
      // The coarse (non-AST) block splitter can find the same re-assignment
      // chain from more than one overlapping "function-shaped" opener line
      // (e.g. an `if (...) {` line incidentally matches the method-shorthand
      // pattern too) — de-dupe by identity so one real defect is one finding.
      const key = `${finding.file}::${finding.identifier}::${finding.lines.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }

  return { ok: findings.length === 0, findings, filesScanned: files.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const result = runCheck(root);

  if (result.error) {
    console.error(`[check-drizzle-where-chaining] ${result.error}`);
    process.exit(2);
  }

  if (result.findings.length === 0) {
    console.log(`[check-drizzle-where-chaining] PASS — ${result.filesScanned} files scanned, no re-assigning .where() chain found.`);
    process.exit(0);
  }

  console.error(`[check-drizzle-where-chaining] FAIL — ${result.findings.length} re-assigning .where() chain(s) found (Drizzle's .where() REPLACES, not ANDs):`);
  for (const f of result.findings) {
    console.error(`  ${relative(root, f.file)}: '${f.identifier}' re-assigned from .where() on lines ${f.lines.join(', ')} (not else-guarded)`);
  }
  console.error('Fix: collect conditions into an array and apply ONE .where(and(...conds)).');
  process.exit(1);
}

const isMain = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
if (isMain) {
  main();
}
