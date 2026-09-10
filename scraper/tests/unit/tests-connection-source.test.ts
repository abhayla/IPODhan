/**
 * The integration safety guard only sees `process.env`. A test that gets its
 * connection string from anywhere else reaches whatever that source points at,
 * and `vitest.integration.setup.ts`'s assertSafeIntegrationTargets never gets a
 * chance to refuse.
 *
 * That is not hypothetical and it is not new. `normalizer-sql-agreement`'s own
 * header records the first occurrence: "the previous TS-vs-SQL test in the repo
 * read `web/.env.local` and reached production". It was fixed for that one file.
 * `consolidation-dedup.integration.test.ts` then did the same thing on a
 * different file - read `web/.env.local`, opened its own Pool, and ran an
 * INSERT INTO ipos against it. Anyone running `npm run test:integration` in
 * `scraper/` with the tunnel up wrote a test row into production. (The paired
 * DELETE is scoped to that fixture's own name, so real IPOs were never at risk;
 * the defect is the write, and that the scoping is a convention rather than an
 * enforced property.)
 *
 * A fix on one file stops one call site. Only a check that reads every file
 * stops the next one - which is why this lives in the UNIT suite, so it runs on
 * every PR rather than only when someone has a database.
 *
 * WHAT THIS KEYS ON, deliberately: "a connection string that did not come from
 * the guarded environment". NOT "constructs a Pool" - that property would flag
 * a correct fix that routes through a shared helper, and a check that fails on
 * the fix is a check someone switches off.
 *
 * WHAT IT DOES NOT COVER, named rather than implied, because an adversarial
 * review wrote each of these and watched them pass the first version:
 *   - HELPER INDIRECTION. Move the env-file read into `tests/helpers/` and
 *     import it, and nothing here sees it. Closing that needs a scan of the
 *     helper directory too, or a rule on the import graph.
 *   - `import 'dotenv/config'`, which loads `.env` from the cwd and can
 *     overwrite DATABASE_URL AFTER the setup file has already vetted it.
 *   - `web/tests/integration`, a second integration directory with its own
 *     guard. Checked by hand 2026-09-11: all seven files go through `getDb()`,
 *     none builds a Pool or reads an env file. Clean today, unwatched tomorrow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_PROD_HOST_MARKERS } from '../helpers/db-safety-guard';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_DIR = path.resolve(HERE, '..', 'integration');

// RECURSIVE, and that is load-bearing. The integration config includes every
// .test.ts BELOW tests/integration, so a flat readdirSync scans a STRICTLY
// SMALLER set than the suite it guards: a file one directory down would run and
// go unchecked. `tests/integration/oracle/` already exists, so the nesting habit
// is present, and the review proved the bypass by landing a file there.
function integrationFiles(): string[] {
  return readdirSync(INTEGRATION_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(INTEGRATION_DIR, f));
}

// Strips block comments and trailing tail comments, not merely whole-line ones.
// A prefix-only filter leaves a trailing comment, and the unstarred middle lines
// of a block comment, in the text - which turns this gate RED on prose. That is
// concrete, not theoretical: three innocent files already import readFileSync
// for fixtures, so one explanatory sentence mentioning an env file would have
// failed the PR gate for them. A check that fails on innocent code is the other
// way a check gets switched off.
function code(text: string): string {
  const SLASH = String.fromCharCode(47);
  const STAR = String.fromCharCode(42);
  const NL = String.fromCharCode(10);
  const ESC = String.fromCharCode(92);
  const QUOTES = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)];
  let out = '';
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inBlock) {
      if (c === STAR && next === SLASH) {
        inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inLine) {
      if (c === NL) {
        inLine = false;
        out += c;
      }
      i += 1;
      continue;
    }
    if (quote) {
      out += c;
      if (c === ESC) {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === SLASH && next === STAR) {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === SLASH && next === SLASH) {
      inLine = true;
      i += 2;
      continue;
    }
    if (QUOTES.includes(c)) {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

describe('an integration test may only take its connection string from the guarded environment', () => {
  it('is looking at the right directory, not merely at some directory', () => {
    // Guards the guard. A bare length check does NOT do this: any wrong-but-
    // populated folder (tests/unit, tests/helpers) satisfies it while the real
    // cases scan the wrong place and report zero offenders - a check that passes
    // having measured nothing, which is a failure class this repo has hit before.
    // Naming a file that must be present is what actually pins the directory.
    const names = integrationFiles().map((f) => path.basename(f));
    expect(names).toContain('consolidation-dedup.integration.test.ts');
    expect(names.length).toBeGreaterThan(5);
  });

  it('none of them reads an env file off disk', () => {
    const offenders: string[] = [];
    for (const file of integrationFiles()) {
      const src = code(readFileSync(file, 'utf8'));
      const touchesEnvFile = /['"`][^'"`]*\.env(\.[A-Za-z0-9_-]+)?['"`]/.test(src);
      const readsIt = /readFileSync|readFile\s*\(|dotenv/.test(src);
      if (touchesEnvFile && readsIt) offenders.push(path.basename(file));
    }
    expect(
      offenders,
      'these read an env file directly, so the safety guard cannot see their target: ' +
        offenders.join(', ')
    ).toEqual([]);
  });

  it('none of them hard-codes a database URL', () => {
    const offenders: string[] = [];
    for (const file of integrationFiles()) {
      const src = code(readFileSync(file, 'utf8'));
      if (/['"`]postgres(ql)?:\/\//.test(src)) offenders.push(path.basename(file));
    }
    expect(
      offenders,
      'these carry a literal connection string, which the guard cannot vet: ' + offenders.join(', ')
    ).toEqual([]);
  });

  // A URL is not the only way to name a host. A Pool built from discrete host
  // and database fields is ordinary pg usage, aims straight at production, and
  // carries no postgres:// for the case above to find. The review wrote exactly
  // that and watched it pass. The marker list is IMPORTED from the guard rather
  // than copied, so the two can never drift apart.
  it('none of them names a production host in discrete fields', () => {
    const offenders: string[] = [];
    for (const file of integrationFiles()) {
      const src = code(readFileSync(file, 'utf8'));
      const hit = KNOWN_PROD_HOST_MARKERS.find((m) => src.includes(m));
      if (hit) offenders.push(path.basename(file) + ' (' + hit + ')');
    }
    expect(
      offenders,
      'these name a production/staging host as a literal in code: ' + offenders.join(', ')
    ).toEqual([]);
  });
});
