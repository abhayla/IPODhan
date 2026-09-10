// Item 1 slice s14: pins the FORM of the bare @ipodhan/shared alias entry in
// scraper/vitest.config.ts.
//
// The trap this guards: vite/rollup alias matching on a STRING `find` matches
// the specifier itself AND anything under `<find>/`. So writing the bare
// entry as an object key -- or as `{ find: '@ipodhan/shared' }` -- also
// captures '@ipodhan/shared/db/schema' and rewrites it to
// '<...>/packages/shared/src/index.ts/db/schema', a path that does not exist.
// Only an ANCHORED regex (/^@ipodhan\/shared$/) matches the bare specifier
// and nothing else.
//
// The alias array is EVALUATED, not pattern-matched in the file text: the
// config is imported in a subprocess (via the print-scraper-vitest-alias
// fixture, with __dirname shimmed since vite normally provides it), so a
// "simplification" back to the object form -- which changes no text this
// test could grep for -- still turns it red.
//
// The subprocess runs under tsx, not node's --experimental-strip-types:
// that flag needs Node >= 22.6, and pr-gate.yml pins Node 20 for the step
// this test runs under (.github/workflows/pr-gate.yml), so a
// --experimental-strip-types subprocess is red on every CI run and green
// only on a laptop with a newer Node -- exactly the local-green/CI-red gap
// this file must never reintroduce. See
// scripts/tests/no-experimental-strip-types-in-tests.test.mjs, which fails
// the whole scripts/tests/ directory the moment that flag comes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRAPER = join(REPO_ROOT, 'scraper');
const BARE = '@ipodhan/shared';
const FIXTURE = join(__dirname, 'fixtures', 'print-scraper-vitest-alias.mts');

const require = createRequire(import.meta.url);
// Resolve tsx's own CLI entry point rather than shelling out to `npx tsx`:
// npx needs a shell on Windows (npx.cmd) and re-resolves the package on
// every call, both avoidable failure modes for a check that must be
// identical on a Windows laptop and an ubuntu-latest CI runner.
const TSX_CLI = require.resolve('tsx/package.json').replace(/package\.json$/, 'dist/cli.mjs');

function readAliasTable() {
  const r = spawnSync(process.execPath, [TSX_CLI, FIXTURE, join(SCRAPER, 'vitest.config.ts')], {
    cwd: SCRAPER,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `could not evaluate scraper/vitest.config.ts via tsx:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('the bare @ipodhan/shared alias exists and is an ANCHORED REGEX, not a string key', () => {
  const { isArray, entries } = readAliasTable();

  // The object form cannot hold a regex key at all, so the array form is a
  // precondition of getting this right, not a style preference.
  assert.ok(isArray, 'resolve.alias must be the ARRAY form -- the object form cannot express a regex `find`');

  const stringBare = entries.find((e) => !e.isRegExp && e.find === BARE);
  assert.equal(
    stringBare,
    undefined,
    `a string '${BARE}' entry also captures '${BARE}/db/schema' and rewrites it to ` +
      `'${stringBare?.replacement}/db/schema'. Use an anchored regex find instead.`
  );

  // Behaviour, not spelling: the entry must match the bare specifier and must
  // NOT match a subpath under it. That is the whole difference between the
  // two forms, and it survives any reformatting of the config.
  const bare = entries.find(
    (e) => e.isRegExp && new RegExp(e.source).test(BARE) && !new RegExp(e.source).test(`${BARE}/db/schema`)
  );
  assert.ok(
    bare,
    `no anchored-regex entry for the bare '${BARE}' specifier. Without it the bare ` +
      'specifier falls through to node resolution, which in an un-re-pointed worktree ' +
      `reads the MAIN checkout. Found: ${JSON.stringify(entries.map((e) => e.find))}`
  );
  assert.match(bare.replacement.split(sep).join('/'), /packages[/]shared[/]src[/]index[.]ts$/);
});

test('the subpath entries that predate this slice are still present, and still ahead of the bare one', () => {
  const { entries } = readAliasTable();
  const finds = entries.map((e) => e.find);
  for (const sub of [`${BARE}/cache/redis-client`, `${BARE}/repositories/listing-performance-repository`]) {
    assert.ok(finds.includes(sub), `alias entry for ${sub} was dropped`);
  }
  for (const legacy of ['@web', '@shared', '@scraper']) {
    assert.ok(finds.includes(legacy), `alias entry for ${legacy} was dropped`);
  }
  // Order is load-bearing: rollup takes the FIRST match.
  const bareIdx = entries.findIndex((e) => e.isRegExp && new RegExp(e.source).test(BARE));
  const subIdx = finds.indexOf(`${BARE}/cache/redis-client`);
  assert.ok(subIdx >= 0 && bareIdx > subIdx, 'the explicit subpath entries must come before the bare-specifier entry');
});
