#!/usr/bin/env node
// #715 class sweep (Tier B review, PR #1070): the #715/#1070 Redis
// fail-closed guard (`guardCacheInvalidation`,
// scraper/scripts/lib/repair-tool.ts) was wired into only 3 of ~26
// scraper/scripts tools that call getRedisClient()/invalidateIPOCaches()/
// dropIpoCacheKeys() after an --apply write. An unguarded tool can silently
// invalidate THIS BOX's own loopback Redis instead of the target slot's
// (staging/prod) — the exact class #1070 fixed for 3 tools and left open for
// the rest, with nothing to stop a NEW unguarded call site from landing.
//
// This lint requires every scraper/scripts/*.ts tool that calls one of those
// three functions to ALSO import and CALL `guardCacheInvalidation` from
// scraper/scripts/lib/repair-tool.ts — or be listed in the baseline file
// (cache-invalidation-guard-baseline.json, each entry with a dated reason)
// while it is migrated in a follow-up PR.
//
// Modeled directly on scripts/ci/require-repair-tool-module.mjs (T-490):
// same TypeScript-AST classifier shape (ts.createSourceFile — never a regex
// comment/string stripper, which #694 showed misreads a regex literal as a
// string and silently drops a real call from view).
//
// Usage:
//   node scripts/ci/require-cache-invalidation-guard.mjs [rootDir]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export const SCRIPTS_DIR = path.join('scraper', 'scripts');
export const MODULE_PATH = path.join('scraper', 'scripts', 'lib', 'repair-tool.ts');
export const BASELINE_PATH = path.join('scripts', 'ci', 'cache-invalidation-guard-baseline.json');

/** Only direct .ts files under scraper/scripts — never scraper/scripts/lib/** or test files. */
export const TOOL_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.ts$/;

/** Call names that mean "this tool invalidates cache". */
export const CACHE_CALL_NAMES = new Set(['getRedisClient', 'invalidateIPOCaches', 'dropIpoCacheKeys']);

/** The shared module's import specifier ends with this (relative or deep), ignoring an optional `.js` suffix. */
const MODULE_SPECIFIER_SUFFIX = /lib\/repair-tool(\.js)?$/;

/** The guard entry point that must actually be CALLED (not just imported). */
const GUARD_CALL_NAME = 'guardCacheInvalidation';

/** `// repair-tool-exempt: YYYY-MM-DD <reason of 10+ chars>` — same marker require-repair-tool-module.mjs uses. */
export const EXEMPTION_PATTERN = /\/\/\s*repair-tool-exempt:\s*(\d{4}-\d{2}-\d{2})\s+(\S.{9,})/;

export function parseSource(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.TS);
}

/** True iff the file calls any of CACHE_CALL_NAMES anywhere as real code (walks the whole AST). */
export function callsCacheInvalidationFn(sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CACHE_CALL_NAMES.has(node.expression.text)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** True iff the file has a top-level `import { guardCacheInvalidation, ... } from '<spec ending in lib/repair-tool(.js)?>'`. */
export function importsGuardFn(sourceFile) {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteralLike(stmt.moduleSpecifier) &&
      MODULE_SPECIFIER_SUFFIX.test(stmt.moduleSpecifier.text) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      const named = stmt.importClause.namedBindings.elements.map((e) => e.name.text);
      if (named.includes(GUARD_CALL_NAME)) return true;
    }
  }
  return false;
}

/** True iff `guardCacheInvalidation(...)` is called anywhere as real code. */
export function callsGuardEntryPoint(sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === GUARD_CALL_NAME) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function loadBaseline(baselinePath) {
  try {
    const raw = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    return {};
  } catch {
    return {};
  }
}

/**
 * Pure classifier — the unit under test. Returns the verdict for ONE file, so
 * a mutation (dropping the call check, or accepting an unreasoned baseline
 * entry) turns a named test red.
 */
export function classifyToolFile(fileName, source, baseline = {}) {
  if (!TOOL_FILENAME_PATTERN.test(fileName)) return { verdict: 'not-a-tool' };
  if (fileName === 'lib') return { verdict: 'not-a-tool' };

  const sourceFile = parseSource(fileName, source);
  if (!callsCacheInvalidationFn(sourceFile)) return { verdict: 'no-cache-call' };

  const imported = importsGuardFn(sourceFile);
  const guardCalled = callsGuardEntryPoint(sourceFile);
  if (imported && guardCalled) return { verdict: 'ok' };

  const exemption = source.match(EXEMPTION_PATTERN);
  if (exemption) return { verdict: 'exempt', date: exemption[1], reason: exemption[2].trim() };

  const baselineEntry = baseline[fileName];
  if (baselineEntry && typeof baselineEntry.reason === 'string' && baselineEntry.reason.trim().length >= 10) {
    return { verdict: 'baselined', reason: baselineEntry.reason.trim() };
  }
  if (baselineEntry) {
    return {
      verdict: 'violation',
      message:
        `${fileName} has a baseline entry in ${BASELINE_PATH} but its "reason" is missing or under 10 ` +
        'characters — a baseline entry with no real reason is the same silent gap this lint exists to close.',
    };
  }

  const missing = !imported
    ? 'does not import guardCacheInvalidation from scraper/scripts/lib/repair-tool.ts'
    : 'imports guardCacheInvalidation but never calls it — importing the guard is not using it';
  return {
    verdict: 'violation',
    imported,
    guardCalled,
    message:
      `${fileName} calls getRedisClient()/invalidateIPOCaches()/dropIpoCacheKeys() but ${missing}. ` +
      'Wrap the call with guardCacheInvalidation() (scraper/scripts/lib/repair-tool.ts) so a resolved-loopback ' +
      'Redis target blocks instead of silently invalidating the wrong slot (#715/#1070), or add a dated entry to ' +
      `${BASELINE_PATH}, or declare "// repair-tool-exempt: YYYY-MM-DD <reason>" for a tool that never writes.`,
  };
}

export function listToolFiles(scriptsDir) {
  let entries;
  try {
    entries = readdirSync(scriptsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => TOOL_FILENAME_PATTERN.test(name))
    .filter((name) => statSync(path.join(scriptsDir, name)).isFile())
    .sort();
}

function main() {
  const root = process.argv[2] || process.cwd();
  const scriptsDir = path.join(root, SCRIPTS_DIR);
  const baseline = loadBaseline(path.join(root, BASELINE_PATH));
  const files = listToolFiles(scriptsDir);
  const violations = [];
  const exempt = [];
  const baselined = [];
  let checked = 0;
  for (const name of files) {
    const source = readFileSync(path.join(scriptsDir, name), 'utf-8');
    const result = classifyToolFile(name, source, baseline);
    if (result.verdict === 'no-cache-call' || result.verdict === 'not-a-tool') continue;
    checked++;
    if (result.verdict === 'violation') violations.push(result.message);
    if (result.verdict === 'exempt') exempt.push(`${name} (exempt ${result.date}: ${result.reason})`);
    if (result.verdict === 'baselined') baselined.push(`${name} (baselined: ${result.reason})`);
  }

  console.log(`[require-cache-invalidation-guard] ${checked} cache-invalidating tool(s) checked in ${SCRIPTS_DIR}`);
  for (const line of exempt) console.log(`  exempt: ${line}`);
  for (const line of baselined) console.log(`  baselined (follow-up owed): ${line}`);
  if (violations.length > 0) {
    console.error(`[require-cache-invalidation-guard] ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('[require-cache-invalidation-guard] OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
