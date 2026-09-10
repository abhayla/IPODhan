#!/usr/bin/env node
/**
 * check-security-boundary-wired — a security control with no caller is not a control.
 *
 * WHY THIS EXISTS (2026-09-10). Three security mechanisms shipped this week,
 * each reviewed, each with unit tests, each green in CI, and each connected to
 * nothing:
 *
 *   1. `isResolvedAddressPrivate` (#487) — the DNS-rebinding refusal. Merged in
 *      the morning with ZERO callers; the hole it closes stayed open on every
 *      fetch the scraper makes until it was wired that night.
 *   2. `slotAwareFlagDefault` (#476) — merged with zero PRODUCTION callers, so
 *      every flag added after it was OFF on staging, and a staging proof that
 *      depended on one could only ever have come back empty.
 *   3. `isTrustedDocumentHost(url, registrarHosts)` — the loader and the cache
 *      for `registrarHosts` both exist and work; both real call sites pass ONE
 *      argument, so the set is always the empty default and registrar-hosted
 *      documents are still refused. Its own docblock says "not wired here".
 *
 * The common shape: the tests covered the FUNCTION and nothing covered its
 * WIRING. A function with no caller is perfectly testable and perfectly
 * useless, and it looks exactly like a function that works.
 *
 * Two rules, both deliberately crude and both mechanical:
 *
 *   `referenced-somewhere` — something other than its own declaration must
 *       reference the name, in non-test code, with comments stripped. A
 *       reference, not necessarily a call: a resolver wired as
 *       `deps.resolveIsPrivate ?? isResolvedAddressPrivate` is properly wired
 *       and has no parentheses. And in its own module counts: the FEATURE_FLAGS
 *       object uses `slotAwareFlagDefault` beside it, which is correct.
 *   `min-args` — at least one call site must pass at least N arguments. This is
 *       the case a caller count cannot catch: the function IS called, but the
 *       parameter carrying the security set is never supplied, so its default
 *       (an empty allow-list, a permissive fallback) is the only value it ever
 *       takes.
 *
 * Known-unwired entries live in a SHRINK-ONLY baseline, the same pattern the
 * write-ratchet and module-boundary checks use: today's gaps are recorded and
 * frozen, and no NEW one can be added. Removing an entry is the fix landing;
 * adding one requires editing a file whose name makes the intent obvious.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const REGISTRY = 'docs/reviews/security-boundary-wiring.json';
const BASELINE = 'config/security-boundary-wiring-baseline.json';
const ROOTS = ['scraper/src', 'packages/shared/src', 'web/lib', 'web/app'];
const EXTS = ['.ts', '.mts', '.tsx', '.js', '.mjs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'tests', 'test', '__tests__', '__mocks__']);

function walk(dir, acc) {
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
      walk(p, acc);
      continue;
    }
    if (!EXTS.some(x => e.endsWith(x))) continue;
    if (/\.(test|spec)\.[cm]?[tj]sx?$/.test(e)) continue;
    acc.push(p);
  }
  return acc;
}

const rel = f => relative(process.cwd(), f).split('\\').join('/');

/**
 * Count the arguments of a call, balancing brackets and skipping quoted text so
 * a comma inside a string or a nested call is not read as an argument
 * separator. Returns null when the call is not closed in the file (a truncated
 * read), which is reported rather than counted as zero.
 */
function countArgs(src, openParenIdx) {
  let depth = 0;
  let args = 0;
  let seenNonSpace = false;
  let quote = null;
  for (let i = openParenIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; seenNonSpace = true; continue; }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      if (depth > 1) seenNonSpace = true;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return seenNonSpace ? args + 1 : 0;
      continue;
    }
    if (c === ',' && depth === 1) { args++; continue; }
    if (!/\s/.test(c)) seenNonSpace = true;
  }
  return null;
}

/** Blank comment bodies so a name merely DISCUSSED in a docblock is not a use. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

/**
 * True when `name` is genuinely USED somewhere — not merely declared, imported,
 * or mentioned in a comment.
 *
 * Two corrections the gate made to its own first design, both found by running
 * it against real wiring rather than by reasoning about it:
 *
 *  - A use is not always a CALL. `document-discovery-runner.ts` wires the
 *    resolver as `this.deps.resolveIsPrivate ?? isResolvedAddressPrivate` — a
 *    bare reference, no parentheses. Requiring `name(` reported that correct
 *    wiring as unwired.
 *  - A use is not always in ANOTHER module. `slotAwareFlagDefault` is used by
 *    the `FEATURE_FLAGS` object in its own defining file, which is exactly
 *    correct. Requiring a different module reported that as unwired too.
 *
 * So the question is narrower and truer: does anything reference this name
 * other than the line that declares it?
 */
function isReferenced(text, name) {
  const code = stripComments(text);
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let m;
  while ((m = re.exec(code)) !== null) {
    const lineStart = code.lastIndexOf('\n', m.index) + 1;
    const lineEnd = code.indexOf('\n', m.index);
    const line = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd);
    // The declaration itself, and any import/export-from line, are not uses.
    if (new RegExp(`\\b(function|const|let|var|class)\\s+${name}\\b`).test(line)) continue;
    if (/^\s*import\b/.test(line)) continue;
    if (/^\s*export\b/.test(line) && /\bfrom\b|[{,]\s*$|^\s*export\s*\{/.test(line)) continue;
    return true;
  }
  return false;
}

function loadJson(path, what) {
  if (!existsSync(path)) {
    console.error(`check-security-boundary-wired: FAIL (check error) — ${what} not found at ${path}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`check-security-boundary-wired: FAIL (check error) — ${what} at ${path} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
}

const registry = loadJson(REGISTRY, 'the boundary registry');
const baseline = loadJson(BASELINE, 'the shrink-only baseline');
const entries = Array.isArray(registry.boundaries) ? registry.boundaries : [];
const baselined = new Set((baseline.unwired ?? []).map(b => b.id));

// Hollow-observable floors. This check exists BECAUSE controls that evaluate
// nothing report success, so it must not be able to do that itself.
if (entries.length === 0) {
  console.error(
    `check-security-boundary-wired: FAIL (check error) — ${REGISTRY} lists zero boundaries. ` +
      'An empty registry makes this check unable to fail; that is the defect it was written to stop.'
  );
  process.exit(2);
}
const files = ROOTS.flatMap(r => walk(r, []));
if (files.length === 0) {
  console.error(
    `check-security-boundary-wired: FAIL (check error) — scanned 0 files across [${ROOTS.join(', ')}]. ` +
      'Wrong working directory or a renamed root.'
  );
  process.exit(2);
}

const sources = files.map(f => ({ path: rel(f), text: readFileSync(f, 'utf8') }));

const violations = [];
const fixedButStillBaselined = [];

for (const entry of entries) {
  const { id, export: exportName, module, rule } = entry;
  let satisfied = false;
  let detail = '';

  if (rule === 'referenced-somewhere') {
    // A DECLARATION is not a caller. `web/lib/config/feature-flags.ts` holds a
    // SECOND copy of `slotAwareFlagDefault`, and matching the bare name made
    // `export function slotAwareFlagDefault(` in that file read as a call — so
    // this check reported PASS on a boundary that had no callers at all. That
    // is precisely the defect it was written to catch, occurring inside itself.
    const users = sources.filter(s => isReferenced(s.text, exportName));
    satisfied = users.length > 0;
    detail = satisfied
      ? `referenced by ${users.length} file(s): ${users.slice(0, 3).map(u => u.path).join(', ')}`
      : `NOTHING references it outside its own declaration — it is dead code wearing a security label`;
  } else if (rule === 'min-args') {
    const needed = entry.minArgs;
    let best = 0;
    let unterminated = 0;
    for (const s of sources) {
      const re = new RegExp(`\\b${exportName}\\s*\\(`, 'g');
      let m;
      while ((m = re.exec(s.text)) !== null) {
        // The definition itself is not a call site.
        const before = s.text.slice(Math.max(0, m.index - 30), m.index);
        if (/\b(function|const|let|var|export)\s*$/.test(before)) continue;
        const n = countArgs(s.text, m.index + m[0].length - 1);
        if (n === null) { unterminated++; continue; }
        if (n > best) best = n;
      }
    }
    satisfied = best >= needed;
    detail = satisfied
      ? `a call site passes ${best} argument(s), meeting the required ${needed}`
      : `every call site passes at most ${best} argument(s); ${needed} are required, so ` +
        `the security parameter only ever takes its own default` +
        (unterminated ? ` (${unterminated} call site(s) could not be parsed and were not counted)` : '');
  } else {
    console.error(`check-security-boundary-wired: FAIL (check error) — entry "${id}" has unknown rule "${rule}"`);
    process.exit(2);
  }

  if (!satisfied && !baselined.has(id)) {
    violations.push({ id, exportName, rule, detail, why: entry.why });
  }
  if (satisfied && baselined.has(id)) {
    fixedButStillBaselined.push({ id, detail });
  }
}

console.log(
  `check-security-boundary-wired: ${entries.length} boundary/boundaries checked against ` +
    `${files.length} source file(s); ${baselined.size} baselined`
);

// Shrink-only: an entry that now passes must LEAVE the baseline, or the baseline
// silently keeps permitting a gap that no longer exists and stops shrinking.
if (fixedButStillBaselined.length > 0) {
  console.error(
    `check-security-boundary-wired: FAIL — ${fixedButStillBaselined.length} baselined boundary/boundaries ` +
      `are now WIRED and must be removed from ${BASELINE} (the baseline shrinks, never lingers):`
  );
  for (const f of fixedButStillBaselined) console.error(`  ${f.id}  —  ${f.detail}`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error(
    `check-security-boundary-wired: FAIL — ${violations.length} security boundary/boundaries exist but are NOT WIRED. ` +
      'Each has tests and passes CI; none of them does anything.'
  );
  for (const v of violations) {
    console.error(`  ${v.id} (${v.exportName}, rule ${v.rule})`);
    console.error(`      ${v.detail}`);
    if (v.why) console.error(`      why it matters: ${v.why}`);
  }
  console.error(
    `\nFix by wiring it, not by editing ${REGISTRY}. If the gap is real and cannot be closed in this ` +
      `slice, add it to ${BASELINE} with the slice that will close it — that list may only shrink.`
  );
  process.exit(1);
}

console.log('check-security-boundary-wired: PASS — every registered security boundary has a real caller');
