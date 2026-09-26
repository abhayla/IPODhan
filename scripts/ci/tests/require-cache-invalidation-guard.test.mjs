// #715 class sweep: mutation-proof self-test for the cache-invalidation-guard
// lint. Imports the REAL predicates from
// scripts/ci/require-cache-invalidation-guard.mjs, so weakening the call
// check or accepting a reasonless baseline entry turns a named test red
// before the lint can silently stop catching the class.
//
//   node --test scripts/ci/tests/require-cache-invalidation-guard.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_PATH,
  callsCacheInvalidationFn,
  callsGuardEntryPoint,
  classifyToolFile,
  EXEMPTION_PATTERN,
  importsGuardFn,
  loadBaseline,
  parseSource,
  TOOL_FILENAME_PATTERN,
} from '../require-cache-invalidation-guard.mjs';

const FIXTURE_UNGUARDED = `import { db, getRedisClient } from '@ipodhan/shared';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';

async function main() {
  const redis = getRedisClient();
  await invalidateIPOCaches(redis, 'some-slug');
}
`;

const FIXTURE_GUARDED = `import { db, getRedisClient } from '@ipodhan/shared';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';
import { guardCacheInvalidation } from './lib/repair-tool.js';

async function main() {
  const guard = guardCacheInvalidation({ dbName: 'x', toolName: 'y', keys: ['a'] });
  if (!guard.blocked) {
    const redis = getRedisClient();
    await invalidateIPOCaches(redis, 'some-slug');
  }
}
`;

// Round-1 miss class this lint targets: importing the module without ever
// CALLING the guard leaves the write completely unguarded.
const FIXTURE_IMPORTED_NOT_CALLED = `import { getRedisClient } from '@ipodhan/shared';
import { guardCacheInvalidation } from './lib/repair-tool.js';

async function main() {
  const redis = getRedisClient();
}
`;

const FIXTURE_NO_CACHE_CALL = `import { db } from '@ipodhan/shared';
async function main() {
  await db.select().from({});
}
`;

test('RED: a tool calling getRedisClient()/invalidateIPOCaches() with no guard is a violation', () => {
  const r = classifyToolFile('repair-fixture-t000.ts', FIXTURE_UNGUARDED);
  assert.equal(r.verdict, 'violation');
  assert.match(r.message, /does not import guardCacheInvalidation/);
});

test('GREEN: the same fixture passes once it imports and calls guardCacheInvalidation', () => {
  const r = classifyToolFile('repair-fixture-t000.ts', FIXTURE_GUARDED);
  assert.equal(r.verdict, 'ok');
});

test('RED: importing guardCacheInvalidation without calling it is still a violation', () => {
  const r = classifyToolFile('repair-fixture-t000.ts', FIXTURE_IMPORTED_NOT_CALLED);
  assert.equal(r.verdict, 'violation');
  assert.match(r.message, /imports guardCacheInvalidation but never calls it/);
});

test('a file with none of the three cache calls is not a violation', () => {
  const r = classifyToolFile('read-only-report.ts', FIXTURE_NO_CACHE_CALL);
  assert.equal(r.verdict, 'no-cache-call');
});

test('a dated exemption comment is honored (mirrors require-repair-tool-module.mjs)', () => {
  const withExemption = `// repair-tool-exempt: 2026-09-07 pre-T-490 tool, migrate before next run\n${FIXTURE_UNGUARDED}`;
  const r = classifyToolFile('backfill-anchor-investors.ts', withExemption);
  assert.equal(r.verdict, 'exempt');
});

test('a reasoned baseline entry (10+ chars) is honored', () => {
  const r = classifyToolFile('legacy-tool.ts', FIXTURE_UNGUARDED, {
    'legacy-tool.ts': { reason: 'not migrated in this PR, tracked in #715 follow-up' },
  });
  assert.equal(r.verdict, 'baselined');
});

// The class this whole lint exists to close: a baseline entry with no real
// reason is the same silent gap as no baseline at all.
test('RED: a baseline entry with an empty/short reason is STILL a violation', () => {
  const r1 = classifyToolFile('legacy-tool.ts', FIXTURE_UNGUARDED, { 'legacy-tool.ts': { reason: '' } });
  assert.equal(r1.verdict, 'violation');
  const r2 = classifyToolFile('legacy-tool.ts', FIXTURE_UNGUARDED, { 'legacy-tool.ts': { reason: 'todo' } });
  assert.equal(r2.verdict, 'violation');
  const r3 = classifyToolFile('legacy-tool.ts', FIXTURE_UNGUARDED, { 'legacy-tool.ts': {} });
  assert.equal(r3.verdict, 'violation');
});

test('TOOL_FILENAME_PATTERN matches a flat scraper/scripts/*.ts file, not a nested path', () => {
  assert.equal(TOOL_FILENAME_PATTERN.test('repair-merge-duplicate-ipo.ts'), true);
  assert.equal(TOOL_FILENAME_PATTERN.test('persist-filing.ts'), true);
  assert.equal(TOOL_FILENAME_PATTERN.test('lib/repair-tool.ts'), false);
  assert.equal(TOOL_FILENAME_PATTERN.test('index.d.ts'), false);
});

// #694: regex literal false-positive class — a real regex literal containing
// a quote character must never be misread as a string delimiter that then
// desynchronizes the parse and hides a real call. TypeScript's own AST
// (ts.createSourceFile) sidesteps this entirely; pin it so a future
// regression back to a hand-rolled stripper is caught here.
test('a regex literal containing a quote does not hide a real guardCacheInvalidation call', () => {
  const fixture = `import { getRedisClient } from '@ipodhan/shared';
import { guardCacheInvalidation } from './lib/repair-tool.js';
const RE = /<a\\s+href="([^"]+)"/i;
async function main() {
  const guard = guardCacheInvalidation({ dbName: 'x', toolName: 'y', keys: [] });
  if (!guard.blocked) getRedisClient();
}
`;
  const r = classifyToolFile('repair-fixture-t000.ts', fixture);
  assert.equal(r.verdict, 'ok');
});

test('parseSource / callsCacheInvalidationFn / importsGuardFn / callsGuardEntryPoint agree on the guarded fixture', () => {
  const sf = parseSource('x.ts', FIXTURE_GUARDED);
  assert.equal(callsCacheInvalidationFn(sf), true);
  assert.equal(importsGuardFn(sf), true);
  assert.equal(callsGuardEntryPoint(sf), true);
});

test('EXEMPTION_PATTERN requires a date and a 10+ char reason', () => {
  assert.equal(EXEMPTION_PATTERN.test('// repair-tool-exempt: 2026-09-07 short reason here'), true);
  assert.equal(EXEMPTION_PATTERN.test('// repair-tool-exempt: 2026-09-07 x'), false);
  assert.equal(EXEMPTION_PATTERN.test('// not-an-exemption: 2026-09-07 whatever reason'), false);
});

test('loadBaseline tolerates a missing file (never throws, returns {})', () => {
  assert.deepEqual(loadBaseline('does/not/exist.json'), {});
});

test('BASELINE_PATH points at the committed baseline file used by main()', () => {
  assert.match(BASELINE_PATH, /cache-invalidation-guard-baseline\.json$/);
});
