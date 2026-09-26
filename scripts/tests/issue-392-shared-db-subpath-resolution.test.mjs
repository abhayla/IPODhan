// #392: `@ipodhan/shared/db` resolves, under the scraper's tsconfig `paths`
// mapping, to the sibling FILE `packages/shared/src/db.ts` rather than the
// directory `packages/shared/src/db/index.ts` when run via `npx tsx` from
// `scraper/` -- exactly how every `scraper/scripts/*.ts` file is invoked.
// `db.ts` re-exports only a subset of `db/index.ts`'s names, so any script
// that statically imports a name `db.ts` does not re-export (regardless of
// whether it also imports anything else) throws at load time.
//
// Exercised as a SUBPROCESS (real `tsx`, real module resolution) against a
// checked-in fixture, not a re-implementation of the resolver: the fixture
// (`scraper/tests/fixtures/issue-392-shared-db-subpath-import.ts`) does the
// exact static import from the issue's repro and prints a marker on success.
// It lives under `scraper/tests/` (excluded from `tsconfig.scripts.json`'s
// `include`, same as every other fixture there) rather than
// `scraper/scripts/`, specifically so it is exercised only at runtime by
// this test, not by `npm run type-check:scripts` — a script under
// `scripts/**/*.ts` importing a name `db.ts` doesn't re-export would also
// fail `tsc`, and that shrink-only gate is #1198/#434's to fix, not this
// issue's regression guard's to trip.
//
// Mutation-proof: revert `packages/shared/src/db.ts`'s re-export of
// `configureUtcTimestampParsing` (or drop it again) and this test goes red
// with the exact `SyntaxError` from #392.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRAPER_DIR = join(REPO_ROOT, 'scraper');
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const FIXTURE = join(SCRAPER_DIR, 'tests', 'fixtures', 'issue-392-shared-db-subpath-import.ts');

test('#392: static import of configureUtcTimestampParsing from @ipodhan/shared/db resolves under tsx', () => {
  const result = spawnSync(process.execPath, [TSX_CLI, FIXTURE], {
    cwd: SCRAPER_DIR,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `expected tsx to exit 0; got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(result.stdout, /ISSUE-392-OK function/);
});
