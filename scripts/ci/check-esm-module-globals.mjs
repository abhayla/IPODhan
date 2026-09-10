#!/usr/bin/env node
/**
 * check-esm-module-globals — refuse CommonJS-only globals in ESM packages.
 *
 * WHY THIS EXISTS (2026-09-10). `scraper/src/config/download-allowlist-loader.ts`
 * shipped to main with a bare `__dirname` at module scope. `scraper` declares
 * `"type": "module"`, so `__dirname`, `__filename` and `require` do not exist —
 * the module threw `ReferenceError: __dirname is not defined in ES module scope`
 * the instant Node loaded it, taking the whole production scraper down at
 * startup (it is reachable from `scraper/src/index.ts`).
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

/**
 * Only genuinely-ESM code is scanned, and "ESM" is decided two ways:
 *   - every source file inside a package whose package.json says
 *     `"type": "module"` (scraper, packages/shared);
 *   - any .mjs/.mts file anywhere, which is ESM by extension regardless of the
 *     package it sits in.
 * The repo root and web/ are CommonJS, so `scripts/check-workflow-ascii.js` and
 * friends may legally use __dirname — flagging them would be a false positive,
 * and a check that cries wolf gets switched off.
 *
 * Test trees are excluded: vitest transforms modules to CJS and shims
 * __dirname, so a test helper using it genuinely works.
 */
const ROOTS = [
  { path: 'scraper', exts: ['.ts', '.mts', '.js', '.mjs'], why: '"type": "module" package' },
  { path: 'packages/shared', exts: ['.ts', '.mts', '.js', '.mjs'], why: '"type": "module" package' },
  { path: 'scripts', exts: ['.mjs', '.mts'], why: 'ESM by file extension' },
  { path: 'web', exts: ['.mjs', '.mts'], why: 'ESM by file extension' },
  { path: 'docs', exts: ['.mjs', '.mts'], why: 'ESM by file extension' },
];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tests',
  'test',
  '__tests__',
  '__mocks__',
  'fixtures',
]);
const BANNED = ['__dirname', '__filename'];

const BACKSLASH = 92;

/**
 * Blank out comments and string/template literal TEXT, preserving length and
 * newlines so reported line numbers stay true. Without this, a docblock showing
 * a `npx tsx -e "require('dotenv')..."` usage example reads as a real violation
 * (there are three such docblocks under scraper/src/scripts/).
 *
 * A `${...}` interpolation inside a template literal is CODE, not text, and is
 * deliberately left intact. Blanking it wholesale was a real hole: the first
 * Tier A review of this check proved that
 *     export const s = `path: ${__dirname}/x`;
 * — which throws ReferenceError under Node, and is the idiomatic way to write
 * the very bug this check exists for — was reported PASS. Interpolations nest
 * (a template inside a `${}` inside a template), so this is a mode stack, not a
 * pair of flags.
 *
 * Returns { code, balanced }. `balanced: false` means the scan ended inside a
 * template or interpolation, so everything after that point was blanked and
 * could be hiding a violation. The caller must NOT report a pass on that; it
 * falls back to `blankCommentsOnly` below.
 */
function blankNonCode(src) {
  const out = src.split('');
  const n = src.length;
  const blankOne = k => {
    if (k < n && out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  const blankRange = (from, to) => {
    for (let k = from; k < to; k++) blankOne(k);
  };

  // Frames: {kind:'template'} while inside a template literal's TEXT, and
  // {kind:'interp', depth} while inside a `${...}`. Braces are counted ONLY
  // inside an interpolation, never at top level: a regex literal such as /[{]/
  // or /\}/ would otherwise push a frame that never pops and leave the whole
  // file looking unparsable (three real files did exactly that).
  const stack = [];
  const top = () => (stack.length > 0 ? stack[stack.length - 1] : null);
  let i = 0;

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    const frame = top();

    if (frame && frame.kind === 'template') {
      if (src.charCodeAt(i) === BACKSLASH) { blankOne(i); blankOne(i + 1); i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && d === '{') { stack.push({ kind: 'interp', depth: 0 }); i += 2; continue; }
      blankOne(i);
      i++;
      continue;
    }

    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blankRange(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blankRange(i, j);
      i = j;
      continue;
    }
    if (c === '`') { stack.push({ kind: 'template' }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src.charCodeAt(j) === BACKSLASH) { blankOne(j); blankOne(j + 1); j += 2; continue; }
        if (src[j] === c) { j++; break; }
        // An unterminated single/double quote is far more likely a stray
        // apostrophe than a real string; stop at the newline rather than
        // blanking the rest of the file and hiding every later violation.
        if (src[j] === '\n') break;
        blankOne(j);
        j++;
      }
      i = j;
      continue;
    }
    if (frame && frame.kind === 'interp') {
      if (c === '{') { frame.depth++; i++; continue; }
      if (c === '}') {
        if (frame.depth === 0) stack.pop();
        else frame.depth--;
        i++;
        continue;
      }
    }
    i++;
  }

  return { code: out.join(''), balanced: stack.length === 0 };
}

/**
 * Fallback for files `blankNonCode` could not parse. Blanks ONLY comments and
 * leaves every string and template intact.
 *
 * Deliberately conservative: it can only ever find MORE matches than a correct
 * parse, never fewer, so it cannot hide a real violation. The cost is a
 * possible false positive when a file merely MENTIONS __dirname inside a
 * string — and the printed line shows exactly that, so it is a ten-second
 * diagnosis rather than a silent miss.
 *
 * Why this is needed: a regex literal containing a backtick or a quote
 * desynchronises any scanner that does not do full JS tokenisation (telling
 * `/re/` from division needs the previous token). `docs/design/generate-rule-
 * index.mjs:56` is a real example — a `.replace(/<backtick>([^<backtick>]*)
 * <backtick>/g, '$1')` reads as three template delimiters. Writing a JS parser
 * to close that is far more risk than this check is worth; degrading loudly is
 * not.
 */
function blankCommentsOnly(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && (d === '/' || d === '*')) {
      let j;
      if (d === '/') {
        const nl = src.indexOf('\n', i);
        j = nl === -1 ? n : nl;
      } else {
        const end = src.indexOf('*/', i + 2);
        j = end === -1 ? n : end + 2;
      }
      for (let k = i; k < j; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

function walk(dir, exts, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      walk(p, exts, acc);
      continue;
    }
    if (!exts.some(x => e.endsWith(x))) continue;
    if (/\.(test|spec)\.[cm]?[tj]s$/.test(e)) continue;
    // Tool config files (vitest.config.ts, drizzle.config.ts, next.config.mjs)
    // are read by their own tool, which bundles them to CJS before executing —
    // they never go through Node's ESM loader, so __dirname genuinely works
    // there. All four scraper/vitest.*.config.ts use it today and are correct.
    if (/\.config\.[cm]?[tj]s$/.test(e)) continue;
    acc.push(p);
  }
  return acc;
}

const rel = f => relative(process.cwd(), f).split('\\').join('/');

const ROOT_LABEL = ROOTS.map(r => r.path).join(', ');
const files = [...new Set(ROOTS.flatMap(r => walk(r.path, r.exts, [])))];

// Hollow-observable floor: a check that scanned nothing must not report PASS.
// (Renaming a root, or running from the wrong cwd, silently empties this list.)
if (files.length === 0) {
  console.error(
    'check-esm-module-globals: FAIL (check error) — scanned 0 files across ' +
      `[${ROOT_LABEL}]. Wrong working directory or a renamed root; ` +
      'this check cannot pass without evaluating something.'
  );
  process.exit(2);
}

const violations = [];
const degraded = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const parsed = blankNonCode(src);
  // If the scan ended inside a template or interpolation, the rest of the file
  // was blanked and a real violation could be hiding in it. Never report a pass
  // we cannot stand behind: fall back to the conservative comments-only scan,
  // which over-reports rather than hides, and say so out loud.
  const code = parsed.balanced ? parsed.code : blankCommentsOnly(src);
  if (!parsed.balanced) degraded.push(rel(file));
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

  // `require(` — but not `foo.require(` or `myRequire(`, and not when the file
  // builds one properly with `const require = createRequire(import.meta.url)`,
  // which is the correct ESM way to reach a CJS-only package (both
  // scripts/ops/*-db-*.mjs do this to load `pg`, and both run fine).
  const requireDeclared = /(?:const|let|var)\s+require\s*=/.test(code);
  if (!requireDeclared) {
    lines.forEach((line, idx) => {
      if (/(?:^|[^.\w])require\s*\(/.test(line)) {
        violations.push({ file: rel(file), line: idx + 1, name: 'require', text: line.trim() });
      }
    });
  }
}

console.log(`check-esm-module-globals: scanned ${files.length} file(s) under [${ROOT_LABEL}]`);

if (degraded.length > 0) {
  console.log(
    `check-esm-module-globals: ${degraded.length} file(s) could not be fully parsed (a regex ` +
      'literal holding a quote or backtick, or an unterminated template). Scanned with the ' +
      'conservative comments-only fallback instead, which over-reports rather than hides:'
  );
  for (const f of degraded) console.log(`  ${f}`);
}

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
      'For `require`, use `createRequire(import.meta.url)`, a static `import`, or `await import()`.'
  );
  process.exit(1);
}

console.log('check-esm-module-globals: PASS — no CommonJS-only globals at module scope');
