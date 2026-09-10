// Anti-regression guard for the class fixed in scraper-vitest-alias-table.test.mjs
// (item 1 slice s14 CI-portability fix): a test under scripts/tests/ that
// shells out to `process.execPath` with `--experimental-strip-types` is
// green on any laptop with Node >= 22.6 and red on every pr-gate run,
// because pr-gate.yml pins Node 20 for the step scripts/tests run under
// (.github/workflows/pr-gate.yml, "Setup Node.js 20") — that flag does not
// exist before Node 22.6. The fix for the one known member of this class
// (scraper-vitest-alias-table.test.mjs) was to evaluate the target file
// under tsx (already a devDependency, works on Node 20) instead; this test
// makes the underlying mistake -- spawning a subprocess with that flag --
// impossible to reintroduce silently, in that file or any new one.
//
// Deliberately narrow: it flags the flag being passed as a literal argv
// item to a spawned process (the shelling-out pattern), not every mention
// of the string "--experimental-strip-types" anywhere in a file -- a test
// is allowed to name the flag in an error message or comment (see
// generate-ipo-slug-parity.test.mjs, which imports a .ts file directly via
// Node's built-in erasable-TypeScript stripping and only ever *mentions*
// the flag in a skip/error message, never passes it to a spawned process).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = __dirname;

// Matches the flag written as a quoted argv element, e.g. '--experimental-strip-types'
// or "--experimental-strip-types" inside an array literal passed to spawn /
// spawnSync / execFile / execFileSync -- the shape a real shell-out takes.
// A bare mention inside a longer sentence (e.g. `node --experimental-strip-types`
// as part of a human-readable message) does not match because it is not
// wrapped in its own quotes as a standalone token.
const FLAG_AS_ARG = /['"]--experimental-strip-types['"]/;

function listTestFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(mjs|ts|mts|cjs)$/.test(e.name))
    .map((e) => join(dir, e.name));
}

test('no scripts/tests/*.{mjs,ts,mts} file shells out to a subprocess with --experimental-strip-types', () => {
  const offenders = [];
  for (const file of listTestFiles(TESTS_DIR)) {
    if (file === fileURLToPath(import.meta.url)) continue; // this guard itself names the flag in prose above
    const text = readFileSync(file, 'utf8');
    if (FLAG_AS_ARG.test(text)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files pass --experimental-strip-types as a spawned-process argument, which needs ` +
      `Node >= 22.6 and is therefore red on every pr-gate run (pinned to Node 20): ` +
      `${offenders.join(', ')}. Evaluate the target file under tsx instead (see ` +
      `scripts/tests/scraper-vitest-alias-table.test.mjs + scripts/tests/fixtures/print-scraper-vitest-alias.mts).`
  );
});
