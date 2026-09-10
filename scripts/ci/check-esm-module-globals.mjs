#!/usr/bin/env node
/**
 * check-esm-module-globals — refuse CommonJS-only globals in ESM packages.
 *
 * WHY THIS EXISTS (2026-09-10). `scraper/src/config/download-allowlist-loader.ts`
 * shipped to main with a bare `__dirname` at module scope. Both packages scanned
 * here declare `"type": "module"`, so `__dirname`, `__filename` and `require` do
 * not exist — the module threw `ReferenceError: __dirname is not defined in ES
 * module scope` the instant Node loaded it, taking the whole production scraper
 * down at startup (it is reachable from `scraper/src/index.ts`).
 *
 * Nothing caught it, because every bench SHIMS the missing global:
 *   - vitest transforms modules to CJS, so `__dirname` is defined in tests;
 *   - `tsx -e "..."` shims it too;
 *   - `tsc --noEmit` type-checks against @types/node, which DECLARES `__dirname`
 *     globally regardless of module system, so the type-check is green.
 * The runtime companion to this check is `tsx src/index.ts --smoke-import`,
 * which loads the real production import graph under the real ESM runtime.
 *
 * The two checks cover different halves of the class and BOTH are needed:
 *   - the smoke import catches anything REACHABLE from the entry point;
 *   - this static check catches modules nothing imports YET — the landmine that
 *     detonates on the day a caller appears. `field-manifest-loader.ts` was
 *     exactly that: zero importers, and unimportable, for as long as it existed.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOTS = ['scraper/src', 'packages/shared/src'];
const EXTS = ['.ts', '.mts', '.js', '.mjs'];
const BANNED = ['__dirname', '__filename'];

const BACKSLASH = 92;

/**
 * Blank out comments and string/template literal bodies, preserving length and
 * newlines so reported line numbers stay true. Without this, a docblock showing
 * a `npx tsx -e "require('dotenv')..."` usage example reads as a real violation
 * (there are three such docblocks under scraper/src/scripts/).
 */
function blankNonCode(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src.charCodeAt(j) === BACKSLASH) { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        // An unterminated single/double quote is far more likely a stray
        // apostrophe than a real string; stop at the newline rather than
        // blanking the rest of the file and hiding every later violation.
        if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      blank(i + 1, Math.max(j - 1, i + 1));
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      walk(p, acc);
      continue;
    }
    if (!EXTS.some(x => e.endsWith(x))) continue;
    if (/\.(test|spec)\.[cm]?[tj]s$/.test(e)) continue;
    acc.push(p);
  }
  return acc;
}

const rel = f => relative(process.cwd(), f).split('\\').join('/');

const files = ROOTS.flatMap(r => walk(r, []));

// Hollow-observable floor: a check that scanned nothing must not report PASS.
// (Renaming a root, or running from the wrong cwd, silently empties this list.)
if (files.length === 0) {
  console.error(
    'check-esm-module-globals: FAIL (check error) — scanned 0 files across ' +
      `[${ROOTS.join(', ')}]. Wrong working directory or a renamed root; ` +
      'this check cannot pass without evaluating something.'
  );
  process.exit(2);
}

const violations = [];
for (const file of files) {
  const code = blankNonCode(readFileSync(file, 'utf8'));
  const lines = code.split(/\r?\n/);

  for (const name of BANNED) {
    // Declaring it in-file (const __dirname = dirname(fileURLToPath(...))) is a
    // correct fix, and is what index.ts and feature-flags.ts already do. Only
    // USES with no in-file declaration are violations.
    const declared = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).test(code);
    if (declared) continue;
    const use = new RegExp(`\\b${name}\\b`);
    lines.forEach((line, idx) => {
      if (use.test(line)) {
        violations.push({ file: rel(file), line: idx + 1, name, text: line.trim() });
      }
    });
  }

  // `require(` — but not `foo.require(` or `myRequire(`.
  lines.forEach((line, idx) => {
    if (/(?:^|[^.\w])require\s*\(/.test(line)) {
      violations.push({ file: rel(file), line: idx + 1, name: 'require', text: line.trim() });
    }
  });
}

console.log(`check-esm-module-globals: scanned ${files.length} file(s) under [${ROOTS.join(', ')}]`);

if (violations.length > 0) {
  console.error(
    `check-esm-module-globals: FAIL — ${violations.length} CommonJS-only global(s) at module scope ` +
      'in a "type": "module" package. These throw at import time under Node, even though vitest, ' +
      '`tsx -e` and `tsc --noEmit` all report green.'
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.name}  |  ${v.text}`);
  }
  console.error(
    '\nFix: derive it from import.meta.url —\n' +
      "  import { fileURLToPath } from 'url';\n" +
      "  import { dirname } from 'path';\n" +
      '  const MODULE_DIR = dirname(fileURLToPath(import.meta.url));\n' +
      'For `require`, use a static `import` or `await import()`.'
  );
  process.exit(1);
}

console.log('check-esm-module-globals: PASS — no CommonJS-only globals at module scope');
