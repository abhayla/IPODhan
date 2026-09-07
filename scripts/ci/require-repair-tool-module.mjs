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
// A tool that legitimately needs none of the module (a read-only report, a
// non-DB migration) declares it:
//     // repair-tool-exempt: 2026-09-07 read-only report, never writes
//
// Usage:
//   node scripts/ci/require-repair-tool-module.mjs [rootDir]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Files that must import the module (basename match), relative to SCRIPTS_DIR. */
export const TOOL_FILENAME_PATTERN = /^(repair|backfill)-.*\.ts$/;

/** Any import specifier that resolves to the shared module. */
export const MODULE_IMPORT_PATTERN = /^[ 	]*import\s[\s\S]{0,400}?from\s+['"][^'"]*lib\/repair-tool(\.js)?['"]/m;

/**
 * The guard ENTRY POINT must actually be called. Round 2 (Tier A MODERATE): a
 * tool that imports only `writeLedgerFile` satisfied the import check while
 * writing prod completely unguarded — importing the module is not using it.
 */
export const GUARD_CALL_PATTERN = /\bopenRepairDb\s*\(/;

/**
 * Strip comments and string literals so an import or a guard call that only
 * APPEARS inside a comment or a quoted string never satisfies the lint.
 * Regex-only (no tokenizer): one alternation matches a string OR a comment, so
 * a `//` inside a string and a quote inside a comment both behave correctly.
 * Strings collapse to `""` (keeps the code syntactically readable), comments
 * to nothing.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

export function stripCommentsAndStrings(source) {
  const BS = String.fromCharCode(92); // one backslash, built rather than escaped
  // A quoted literal: opening quote, then escaped chars or non-quote/non-backslash, then close.
  const quoted = (q) => `${q}(?:${BS}${BS}.|[^${q}${BS}${BS}])*${q}`;
  const STRING_LITERAL = new RegExp([quoted('"'), quoted("'"), quoted('`')].join('|'), 'g');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments first (a quote inside one is not a string)
    .replace(/\/\/[^\n]*/g, '') // then line comments (an apostrophe in prose is not a string)
    .replace(STRING_LITERAL, '""'); // finally string bodies
}

/** `// repair-tool-exempt: YYYY-MM-DD <reason of 10+ chars>` */
export const EXEMPTION_PATTERN = /\/\/\s*repair-tool-exempt:\s*(\d{4}-\d{2}-\d{2})\s+(\S.{9,})/;

export const SCRIPTS_DIR = path.join('scraper', 'scripts');
export const MODULE_PATH = path.join('scraper', 'scripts', 'lib', 'repair-tool.ts');

/**
 * Pure classifier — the unit under test. Returns the verdict for ONE file, so
 * a mutation (dropping the import check, or accepting an undated exemption)
 * turns a named test red.
 */
export function classifyToolFile(fileName, source) {
  if (!TOOL_FILENAME_PATTERN.test(fileName)) return { verdict: 'not-a-tool' };

  // The import and the call must be REAL code, not text inside a comment or a
  // string literal. The exemption marker IS a comment, so it is matched
  // against the original source below.
  // The import specifier IS a string literal, so it is matched against a
  // comment-stripped (strings intact) copy and must sit at statement position;
  // the guard CALL is matched against the fully stripped code.
  const imported = MODULE_IMPORT_PATTERN.test(stripComments(source));
  const guardCalled = GUARD_CALL_PATTERN.test(stripCommentsAndStrings(source));
  if (imported && guardCalled) return { verdict: 'ok' };

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
