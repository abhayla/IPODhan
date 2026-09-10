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
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_DIR = path.resolve(HERE, '..', 'integration');

function integrationFiles(): string[] {
  return readdirSync(INTEGRATION_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(INTEGRATION_DIR, f));
}

// Comments are stripped before matching. The rule is about what the CODE does.
// A file is allowed to describe this very incident in prose, and one of them
// does - a grep that did not strip comments reported that file as an offender
// when it is in fact the fix for the first occurrence.
function code(text: string): string {
  return text
    .split(String.fromCharCode(10))
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    })
    .join(String.fromCharCode(10));
}

describe('an integration test may only take its connection string from the guarded environment', () => {
  it('finds the integration files it is supposed to be checking', () => {
    // Guards the guard. A wrong directory here would make every case below pass
    // while examining nothing - the hollow-check failure this repo has hit before.
    const files = integrationFiles();
    expect(files.length, `expected integration tests under ${INTEGRATION_DIR}`).toBeGreaterThan(5);
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
});
