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
 * WHAT IT DOES NOT COVER, named rather than implied, because two adversarial
 * review rounds wrote each of these and watched them pass:
 *   - HELPER INDIRECTION. Move the env-file read into `tests/helpers/` and
 *     import it, and nothing here sees it. Closing that needs a scan of the
 *     helper directory too, or a rule on the import graph.
 *   - `import 'dotenv/config'`. Confirmed mechanism: `readsIt` matches the word
 *     dotenv, but the env-file pattern needs a quoted string containing `.env`
 *     with a dot, and `'dotenv/config'` has none - so the AND never fires. It
 *     can overwrite DATABASE_URL AFTER the setup file has already vetted it.
 *   - `web/tests/integration`, a second integration directory with its own
 *     guard, which also keeps its own PRIVATE copy of the production host
 *     markers (`web/tests/helpers/db-safety-guard.ts`). Importing the scraper
 *     list below removes drift on THIS side only; web still drifts on its own.
 *     Checked by hand 2026-09-11: all seven web files go through `getDb()`,
 *     none builds a Pool or reads an env file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { KNOWN_PROD_HOST_MARKERS } from '../helpers/db-safety-guard';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_DIR = path.resolve(HERE, '..', 'integration');

// RECURSIVE, and that is load-bearing. The integration config includes every
// .test.ts BELOW tests/integration, so a flat readdirSync scans a STRICTLY
// SMALLER set than the suite it guards: a file one directory down would run and
// go unchecked. A review proved that bypass by landing a file in a subdirectory.
function integrationEntries(): string[] {
  return readdirSync(INTEGRATION_DIR, { recursive: true, encoding: 'utf8' });
}

function integrationFiles(): string[] {
  return integrationEntries()
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(INTEGRATION_DIR, f));
}

/**
 * Strips comments using TYPESCRIPT'S OWN SCANNER, not a hand-written one.
 *
 * This is the second rewrite of this function and the reason is worth keeping.
 * The first version filtered whole comment LINES, which left trailing comments
 * in the text and turned the gate red on prose. I replaced it with a
 * hand-written character scanner tracking strings and comments - and an
 * adversarial review broke it in one line, because a hand-written scanner does
 * not know what a REGEX LITERAL is:
 *
 *     const IS_URL = /^https?:\/\//;
 *
 * The scanner saw `//` inside that regex, entered line-comment state, and
 * deleted the rest of the line. A regex containing a slash-star did worse - it
 * opened block-comment state and blanked the file to the next `* /` or EOF. Two
 * probe files carrying literal production connection strings passed all four
 * checks clean. That idiom is not exotic: `bse-document-scraper.integration.
 * test.ts` already contains `toMatch(/^https?:\/\//)` today, so a future file
 * that reaches production would have been invisible if it happened to contain
 * an ordinary URL regex.
 *
 * The lesson is not "handle regexes too". It is that hand-rolling a JavaScript
 * lexer is the defect class, and the repo already ships a correct one.
 */
function code(text: string): string {
  // The PARSER, not the bare scanner. `ts.createScanner` alone still gets this
  // wrong: a lone scanner has no parser context, so it cannot tell a regex from
  // a division, scans the `/` in `/a\/*b/` as a slash, then reads `/*` as the
  // start of a block comment and eats the rest of the file. I wrote that version
  // first and my own regex-literal case below caught it - which is the entire
  // argument for pinning the stripper's behaviour directly instead of only
  // through the checks that use it.
  //
  // `createSourceFile` parses, so regex literals are literals. Walking to the
  // leaf tokens and taking each one's text yields the code with comments gone:
  // comments are leading trivia, and `getText()` excludes trivia by definition.
  // Nothing is ever deleted by a state machine, which is what makes a false
  // GREEN impossible by construction rather than by careful branch handling.
  const sourceFile = ts.createSourceFile(
    'probe.ts',
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );
  const parts: string[] = [];
  const walk = (node: ts.Node): void => {
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      parts.push(node.getText(sourceFile));
      return;
    }
    for (const child of children) walk(child);
  };
  walk(sourceFile);
  return parts.join(' ');
}

describe('an integration test may only take its connection string from the guarded environment', () => {
  it('is looking at the right directory, and looking recursively', () => {
    // Guards the guard, twice over. A bare length check does NOT pin the
    // directory: any wrong-but-populated folder satisfies it while the real
    // cases scan the wrong place and report zero offenders - a check that passes
    // having measured nothing. Naming a file pins the directory.
    const names = integrationFiles().map((f) => path.basename(f));
    expect(names).toContain('consolidation-dedup.integration.test.ts');
    expect(names.length).toBeGreaterThan(5);

    // And this pins RECURSION independently. Without it, `recursive: true` could
    // silently regress and every case below would still pass while nested files
    // went unscanned - which is exactly the bypass a review demonstrated. There
    // are no nested .ts files today (tests/integration/oracle holds JSON), so
    // asserting on .ts alone would prove nothing; the raw listing is what shows
    // the walk actually descends.
    const nested = integrationEntries().filter((e) => e.includes(path.sep));
    expect(nested.length, 'the scan is not descending into subdirectories').toBeGreaterThan(0);
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
  // carries no postgres:// for the case above to find. A review wrote exactly
  // that and watched it pass. The marker list is IMPORTED from the guard rather
  // than copied, so these two cannot drift apart.
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

  // The comment stripper is itself the thing most likely to break this check, in
  // both directions, and both directions have already happened. These cases pin
  // its behaviour directly rather than only through the checks above.
  describe('the comment stripper', () => {
    it('does not let a regex literal swallow the code after it (the false-GREEN class)', () => {
      const src = [
        'const IS_URL = /^https?:\\/\\//;',
        "const CONN = 'postgresql://user:pw@103.118.16.189:5432/ipodhan';",
      ].join(String.fromCharCode(10));
      const stripped = code(src);
      expect(stripped).toContain('103.118.16.189');
      expect(stripped).toContain('postgres');
    });

    it('does not let a slash-star regex blank the rest of the file (the worse false-GREEN class)', () => {
      const src = [
        'const RX = /a\\/*b/;',
        "const CONN = 'postgresql://user:pw@103.118.16.189:5432/ipodhan';",
      ].join(String.fromCharCode(10));
      expect(code(src)).toContain('103.118.16.189');
    });

    it('still removes real comments, so prose cannot turn the gate red (the false-RED class)', () => {
      const src = [
        'const STRIP = /[' + String.fromCharCode(39, 34, 96) + ']/g;',
        '// history: this once read ".env.local" with readFileSync; it no longer does.',
        '/*',
        '  and this block also mentions .env.local and readFileSync',
        '*/',
        'const x = 1;',
      ].join(String.fromCharCode(10));
      const stripped = code(src);
      expect(stripped).not.toContain('.env.local');
      expect(stripped).not.toContain('readFileSync');
      expect(stripped).toContain('const x = 1');
    });
  });
});
