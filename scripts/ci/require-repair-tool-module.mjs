#!/usr/bin/env node
// T-490: every data-repair / backfill tool under scraper/scripts must use the
// ONE shared guard module (scraper/scripts/lib/repair-tool.ts) rather than
// re-implementing the prod guard, the field_sources upsert and the per-field
// idempotency check from memory.
//
// Why: on 2026-09-07 three tools each re-typed that pattern and each got a
// DIFFERENT part of it wrong (no provenance row; an env-based prod guard the
// host-based pool bypasses; a direct `ipos` writer). An adversarial review
// caught all three — detection after the fact. This lint is the detection
// BEFORE the fact for the next member of that class.
//
// #694 (never-hand-roll-a-lexer, memory 2026-09-11): the original
// implementation stripped comments/strings with a single hand-written regex
// alternation. That scanner has no concept of a REGEX LITERAL, so a source
// file containing e.g. `/<a\s+href="([^"]+)"/i` reads the literal's `"` as a
// string opener and desynchronises everything after it, silently dropping a
// real `openRepairDb()` call from view (false VIOLATION on a compliant
// tool). Replaced with TypeScript's own parser (`ts.createSourceFile`),
// which is already a dependency of this monorepo and disambiguates a regex
// literal from a string/divide correctly because it understands the
// GRAMMATICAL position of each token — something no regex-based tokenizer
// can do without re-implementing a parser.
//
// A tool that legitimately needs none of the module (a read-only report, a
// non-DB migration) declares it:
//     // repair-tool-exempt: 2026-09-07 read-only report, never writes
//
// Usage:
//   node scripts/ci/require-repair-tool-module.mjs [rootDir]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Files that must import the module (basename match), relative to SCRIPTS_DIR. */
// Review round 3, MINOR-1: "requeue" added — requeue-exhausted-plan-rows.ts
// (and the earlier requeue-anchor-zero-rows.ts) reset rows for another pass,
// the same class of write this gate exists to guard (--expect-db, dry-run
// default, prod refused without --allow-prod).
export const TOOL_FILENAME_PATTERN = /^(repair|backfill|refresh|requeue)-.*\.ts$/;

/** The shared module's import specifier ends with this (relative or deep), ignoring an optional `.js` suffix. */
const MODULE_SPECIFIER_SUFFIX = /lib\/repair-tool(\.js)?$/;

/** The guard ENTRY POINT that must actually be CALLED (not just imported). */
const GUARD_CALL_NAME = 'openRepairDb';

/** `// repair-tool-exempt: YYYY-MM-DD <reason of 10+ chars>` */
export const EXEMPTION_PATTERN = /\/\/\s*repair-tool-exempt:\s*(\d{4}-\d{2}-\d{2})\s+(\S.{9,})/;

export const SCRIPTS_DIR = path.join('scraper', 'scripts');
export const MODULE_PATH = path.join('scraper', 'scripts', 'lib', 'repair-tool.ts');

/**
 * Parse a source file with TypeScript's own parser. Real AST, not a regex
 * approximation — comments are never part of it, and a string/template
 * literal is a distinct node kind from an Identifier/CallExpression, so
 * neither can be mistaken for real code.
 */
export function parseSource(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.TS);
}

/** True iff the file has a top-level `import ... from '<spec ending in lib/repair-tool(.js)?>'`. */
export function importsRepairToolModule(sourceFile) {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteralLike(stmt.moduleSpecifier) &&
      MODULE_SPECIFIER_SUFFIX.test(stmt.moduleSpecifier.text)
    ) {
      return true;
    }
  }
  return false;
}

/** True iff `openRepairDb(...)` is called anywhere as real code (walks the whole AST). */
export function callsGuardEntryPoint(sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === GUARD_CALL_NAME
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Pure classifier — the unit under test. Returns the verdict for ONE file, so
 * a mutation (dropping the import check, or accepting an undated exemption)
 * turns a named test red.
 */
export function classifyToolFile(fileName, source) {
  if (!TOOL_FILENAME_PATTERN.test(fileName)) return { verdict: 'not-a-tool' };

  const sourceFile = parseSource(fileName, source);
  const imported = importsRepairToolModule(sourceFile);
  const guardCalled = callsGuardEntryPoint(sourceFile);
  if (imported && guardCalled) return { verdict: 'ok' };

  // The exemption marker IS a comment (never real code), so it is matched
  // against the ORIGINAL source text, not the AST.
  const exemption = source.match(EXEMPTION_PATTERN);
  if (exemption) return { verdict: 'exempt', date: exemption[1], reason: exemption[2].trim() };

  const missing = !imported
    ? 'does not import scraper/scripts/lib/repair-tool.ts'
    : 'imports scraper/scripts/lib/repair-tool.ts but never calls openRepairDb() — importing the module is not using it (a tool that pulls in only writeLedgerFile still writes prod unguarded)';
  return {
    verdict: 'violation',
    imported,
    guardCalled,
    message:
      `${fileName} is a data-repair/backfill tool but ${missing}. Open the ` +
      `database through openRepairDb() and use the shared guards ` +
      `(decideProdWriteRefusal / upsertFieldSource / buildAlreadyRepairedSet) ` +
      `instead of re-implementing them, or declare ` +
      `"// repair-tool-exempt: YYYY-MM-DD <reason>" at the top of the file.`,
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
  const files = listToolFiles(scriptsDir);
  const violations = [];
  const exempt = [];
  for (const name of files) {
    const source = readFileSync(path.join(scriptsDir, name), 'utf-8');
    const result = classifyToolFile(name, source);
    if (result.verdict === 'violation') violations.push(result.message);
    if (result.verdict === 'exempt') exempt.push(`${name} (exempt ${result.date}: ${result.reason})`);
  }

  console.log(`[require-repair-tool-module] ${files.length} repair/backfill tool(s) checked in ${SCRIPTS_DIR}`);
  for (const line of exempt) console.log(`  exempt: ${line}`);
  if (violations.length > 0) {
    console.error(`[require-repair-tool-module] ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('[require-repair-tool-module] OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
