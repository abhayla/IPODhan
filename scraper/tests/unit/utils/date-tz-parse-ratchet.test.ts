/**
 * Static grep-based ratchet (T-327, round-7 P1-1 class sweep) — mirrors the
 * repo-root R0 write ratchet (T-316, scripts/check-write-ratchet.mjs):
 * shrink-only baseline gate against a specific anti-pattern, not an
 * ESLint/AST rule (the risky shape spans a var assignment + a later method
 * call, which is easy to grep and awkward to express as a single AST rule).
 *
 * Anti-pattern: `const/let X = new Date(<bareIdentifier>); ... X.toISOString()`.
 * This is exactly the shape that shifted NSE/BSE/Moneycontrol/anchor-investor
 * dates a day early in prod (Asia/Kolkata, PM2 does not propagate TZ — see
 * .claude/rules/utc-naive-timestamp-normalization.md): `new Date(rawString)`
 * builds at LOCAL midnight, then `.toISOString()` reads it back in UTC.
 *
 * It does NOT match:
 *   - `new Date(Date.UTC(...))` (arg is not a bare identifier)
 *   - `new Date('...T...Z')` / a literal with an explicit offset
 *   - a Date built from a bare identifier that is only used for `.getTime()`
 *     / `.getFullYear()` / `.getMonth()` / `.getDate()` (LOCAL-getter reads
 *     are TZ-self-consistent by construction — see chittorgarh-scraper.ts)
 *
 * T-327F item "RATCHET GAP" (checker T-327C): the original RISKY_CHAIN only
 * matched the const/let-BOUND form (`const d = new Date(x); ...; d.toISOString()`)
 * and stayed GREEN on the INLINE form with no intermediate binding
 * (`return new Date(cells[0]).toISOString()` — exactly the shape at
 * backfill-gmp-historical.ts:193). INLINE_RISKY_CHAIN below closes that gap:
 * it matches `new Date(<expr>).toISOString()` / `.getTime()` chained directly,
 * where `<expr>` is a non-literal, non-Date.UTC(...) operand (a raw scraped
 * value), while still treating the local-getter reads (`getFullYear`/
 * `getMonth`/`getDate`) as SAFE, same as the bound form.
 *
 * KNOWN RESIDUAL (8 entries — see BASELINE below, cross-referenced in
 * D:\Abhay\GetWorkDone\evidence\2026-08-26-T-327\06-class-sweep.md and
 * class-sweep-item3.md): six files keep a last-resort
 * `new Date(cleaned).toISOString()` fallback for date STRINGS that don't
 * match any of the known DD-MMM-YYYY / DD/MMM/YYYY / DD MMM YY / DD/MM/YYYY /
 * DD-MM-YYYY shapes (all of which are now handled by explicit
 * string-arithmetic branches BEFORE the fallback is ever reached), plus two
 * sites the INLINE_RISKY_CHAIN pass surfaced (T-327F checker remediation
 * item 4) that were already reviewed-safe in the sweep docs but missing from
 * this file's BASELINE: `backfill-listing-performance.ts` (manual CLI
 * script, unverified third-party field, out of scope) and
 * `freshness-monitor.ts` (reads a full DB timestamptz for an epoch-ms diff,
 * not a raw date-only string — TZ-agnostic by construction). This ratchet
 * does not re-fix the six string-parsing fallbacks (out of this pass's
 * budget) — it freezes the count so a NEW instance of the class cannot be
 * added silently. Shrinking the baseline (fixing one of them) requires
 * updating BASELINE below in the same commit as the fix.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC_ROOT = join(__dirname, '..', '..', '..', 'src');

// Scoped to PARSING a raw source string, not date ARITHMETIC or an epoch
// number — both of those are different (and, in this codebase, already
// UTC-safe) patterns that would otherwise false-positive on this grep:
//   - `(?!function)` stops the window crossing into the NEXT function — an
//     unrelated `date.toISOString()` in a sibling function reusing the
//     conventional name `date` would otherwise match an assignment it has
//     nothing to do with.
//   - `(?!\.set(?:Date|Month|FullYear)\()` excludes the "compute a derived
//     date via setDate/getDate arithmetic" idiom (moneycontrol-scraper.ts,
//     chittorgarh-scraper.ts, investorgain-gmp-orchestrator*.ts) — a
//     TZ-consistency question about mutation, not a raw-string PARSE.
//   - `(?!timestamp\b)` excludes `new Date(timestamp)` where the identifier
//     is a numeric epoch (ms/seconds since epoch) — timezone-agnostic by
//     construction, not a wall-clock string parse.
const RISKY_CHAIN =
  /(?:const|let)\s+(\w+)\s*=\s*new Date\(\s*(?!timestamp\b)(\w+)\s*\)(?:(?!function|\.set(?:Date|Month|FullYear)\()[\s\S]){0,400}?\1\.toISOString\(\)/g;

// INLINE (non-bound) form: `new Date(<expr>).toISOString()` / `.getTime()`
// chained directly with no intermediate `const/let` — the shape RISKY_CHAIN
// above cannot see. `<expr>` is restricted to a non-parenthesized, non-quoted
// operand so it naturally excludes `Date.UTC(...)` (its argument list contains
// parens, which the character class below rejects) and explicit string
// literals (`new Date('2025-01-01T00:00:00Z')`), leaving only raw
// identifiers/member-expressions (`cells[0]`, `raw`, `row.date`) — exactly
// the scraped-value shape this ratchet exists to catch.
const INLINE_RISKY_CHAIN =
  /new Date\(\s*(?!timestamp\b)(?!['"`])([^()'"`]+?)\s*\)\s*\.\s*(?:toISOString|getTime)\(\)/g;

// Baseline: files with a KNOWN, reviewed instance of the residual fallback
// pattern above, and how many instances each currently has. Shrink-only —
// a file dropping out of this list (or its count decreasing) is fine; a
// file gaining a NEW instance, or a file NOT in this list gaining one, fails.
const BASELINE: Record<string, number> = {
  'scrapers/bse-scraper.ts': 1,
  'scrapers/nse-api-client.ts': 1,
  'scrapers/nse-scraper.ts': 1,
  'utils/transform-past-ipo.ts': 1,
  'services/normalization-engine.ts': 1,
  'utils/scraper-utils.ts': 1,
  // T-327F (checker T-327C remediation item 4): INLINE_RISKY_CHAIN surfaced
  // two more real, already-reviewed-safe sites documented in
  // D:\Abhay\GetWorkDone\evidence\2026-08-26-T-327\06-class-sweep.md before
  // this ratchet gained the inline-form check —
  'scripts/backfill-listing-performance.ts': 1, // `new Date(data.Data[0].TDate).toISOString()` on an unverified BSE LTP-API field; manual, non-scheduled CLI backfill, not on the automated write path (06-class-sweep.md:71).
  'services/freshness-monitor.ts': 1, // `new Date(lastSuccess.createdAt).getTime()` reads a full DB timestamptz column (not a raw scraped date-only string) purely for an epoch-ms staleness diff — TZ-agnostic by construction (06-class-sweep.md:50).
  // T-327F fix round 5: landed on main as T-324 (6080fdc6) AFTER this
  // baseline was written, so the PR merge commit — not this branch's tree —
  // is where CI first saw it. Same reviewed-safe class as
  // freshness-monitor.ts above: `new Date(existing.firstSeenAt).getTime()`
  // re-reads a value THIS module itself wrote as `now.toISOString()` (a
  // full UTC instant with an explicit `Z`), purely for an epoch-ms
  // grace-period diff. An explicit-offset string parses identically in
  // every process TZ, so no local-midnight shift is possible.
  'services/deploy-drift-monitor.ts': 1,
};

/**
 * Strip comments before scanning so prose that DESCRIBES the anti-pattern
 * (e.g. "NEVER `new Date(dateOnlyString).toISOString()`" in a doc comment
 * explaining why a site was fixed) doesn't self-match as a NEW instance.
 *
 * A regex-only `/\*...\*\//` strip is UNSAFE here: a plain string literal
 * containing `/*` (e.g. an HTTP `Accept` header value like
 * `'...,image/webp,*\/*;q=0.8'`) makes the non-greedy block-comment pattern
 * swallow everything up to the NEXT unrelated block-comment terminator — silently
 * deleting real code (verified against nse-scraper.ts, whose `Accept:
 * '.../webp,*\/*;q=0.8'` header string ate the rest of the function and
 * made a genuine baselined instance vanish). This is a minimal
 * string-literal-aware scanner instead: `//` / `/* ... *\/` are only
 * treated as comments OUTSIDE a quoted string/template literal.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function countRiskyChains(rawContent: string): number {
  const content = stripComments(rawContent);
  RISKY_CHAIN.lastIndex = 0;
  let count = 0;
  while (RISKY_CHAIN.exec(content)) count++;
  INLINE_RISKY_CHAIN.lastIndex = 0;
  while (INLINE_RISKY_CHAIN.exec(content)) count++;
  return count;
}

describe('date-tz-parse ratchet — no NEW local-TZ Date().toISOString() chain on a raw date string', () => {
  it('every risky chain in scraper/src is an already-baselined, reviewed instance', () => {
    const files = walk(SRC_ROOT);
    const found: Record<string, number> = {};

    for (const file of files) {
      const relPath = relative(SRC_ROOT, file).split(sep).join('/');
      const content = readFileSync(file, 'utf-8');
      const count = countRiskyChains(content);
      if (count > 0) found[relPath] = count;
    }

    const newFiles = Object.keys(found).filter((f) => !(f in BASELINE));
    const grownFiles = Object.keys(found).filter(
      (f) => f in BASELINE && found[f] > BASELINE[f]
    );

    if (newFiles.length > 0 || grownFiles.length > 0) {
      const details = [
        ...newFiles.map((f) => `  NEW file: ${f} (${found[f]} instance(s))`),
        ...grownFiles.map(
          (f) => `  GROWN file: ${f} (baseline ${BASELINE[f]} -> found ${found[f]})`
        ),
      ].join('\n');
      throw new Error(
        `New local-TZ Date().toISOString() chain(s) detected on a raw date string ` +
          `(T-327 class — see .claude/rules/utc-naive-timestamp-normalization.md):\n${details}\n` +
          `Use scraper/src/utils/date-string-parsing.ts (or an equivalent Date.UTC(...)/` +
          `string-arithmetic construction) instead. If this is a reviewed, intentionally-safe ` +
          `pattern, update BASELINE in this test file in the same commit.`
      );
    }

    expect(newFiles).toEqual([]);
    expect(grownFiles).toEqual([]);
  });

  it('baseline files still exist and their counts have not silently drifted down without being updated here', () => {
    // Guards against the baseline going stale in the OTHER direction (a fix
    // landing without shrinking BASELINE) — same "no phantom baseline entry"
    // discipline as the write ratchet's --update requirement.
    for (const [relPath, expectedCount] of Object.entries(BASELINE)) {
      const full = join(SRC_ROOT, ...relPath.split('/'));
      const content = readFileSync(full, 'utf-8');
      const actual = countRiskyChains(content);
      expect(
        actual,
        `${relPath}: baseline says ${expectedCount}, file actually has ${actual}. ` +
          `If you fixed this site, shrink BASELINE in this test in the same commit.`
      ).toBe(expectedCount);
    }
  });
});

describe('INLINE_RISKY_CHAIN — the non-bound new Date(expr).toISOString()/.getTime() shape', () => {
  it('flags an inline new Date(expr).toISOString() with no intermediate binding (the backfill-gmp-historical.ts:193 shape)', () => {
    const risky = `export function parse(cells) {\n  return { date: new Date(cells[0]).toISOString() };\n}`;
    expect(countRiskyChains(risky)).toBeGreaterThan(0);
  });

  it('flags an inline new Date(expr).getTime() with no intermediate binding', () => {
    const risky = `export function parse(raw) {\n  return new Date(raw).getTime();\n}`;
    expect(countRiskyChains(risky)).toBeGreaterThan(0);
  });

  it('does NOT flag the SAFE local-getter pattern (bound Date read via getFullYear/getMonth/getDate)', () => {
    const safe = `export function parse(raw) {\n  const d = new Date(raw);\n  return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };\n}`;
    expect(countRiskyChains(safe)).toBe(0);
  });

  it('does NOT flag an inline new Date(Date.UTC(...)).toISOString() construction', () => {
    const safe = `export function parse(y, m, day) {\n  return new Date(Date.UTC(y, m, day)).toISOString();\n}`;
    expect(countRiskyChains(safe)).toBe(0);
  });

  it('does NOT flag an inline new Date("2025-01-01T00:00:00Z").toISOString() explicit-offset literal', () => {
    const safe = `export function parse() {\n  return new Date('2025-01-01T00:00:00Z').toISOString();\n}`;
    expect(countRiskyChains(safe)).toBe(0);
  });
});
