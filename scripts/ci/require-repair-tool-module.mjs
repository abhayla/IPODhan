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
export const MODULE_IMPORT_PATTERN = /from\s+['"][^'"]*lib\/repair-tool(\.js)?['"]/;

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
  if (MODULE_IMPORT_PATTERN.test(source)) return { verdict: 'ok' };
  const exemption = source.match(EXEMPTION_PATTERN);
  if (exemption) return { verdict: 'exempt', date: exemption[1], reason: exemption[2].trim() };
  return {
    verdict: 'violation',
    message:
      `${fileName} is a data-repair/backfill tool but does not import ` +
      `scraper/scripts/lib/repair-tool.ts. Import the shared guards ` +
      `(openRepairDb / decideProdWriteRefusal / upsertFieldSource / ` +
      `buildAlreadyRepairedSet) instead of re-implementing them, or declare ` +
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
