import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOffenders, ALLOWED_FACTORIES, BOX_WIDE_CALLERS } from '../ci/check-redis-client-factories.mjs';

const read = (map) => (f) => map[f];

test('a new Redis( outside the factories is refused, with file:line', () => {
  const files = { 'scraper/src/jobs/rogue.ts': "import Redis from 'ioredis';\nconst r = new Redis(process.env.REDIS_URL);\n" };
  assert.deepEqual(findOffenders(Object.keys(files), read(files)), [
    'scraper/src/jobs/rogue.ts:2: const r = new Redis(process.env.REDIS_URL);',
  ]);
});

test('new IORedis( is caught too', () => {
  const files = { 'scripts/x.mjs': 'const c = new IORedis({ host });' };
  assert.equal(findOffenders(Object.keys(files), read(files)).length, 1);
});

test('the four factories, test files and comments pass', () => {
  const files = Object.fromEntries([...ALLOWED_FACTORIES].map((f) => [f, 'x = new Redis(url);']));
  files['scraper/src/a.test.ts'] = 'new Redis()';
  files['web/lib/b.ts'] = '// new Redis( in a comment\n * new Redis( in a docblock\nconst ok = getRedisClient();';
  assert.deepEqual(findOffenders(Object.keys(files), read(files)), []);
});

test('#151 round 1: the box-wide (cross-slot) client is used only by its allow-listed callers', () => {
  const files = {
    'scraper/src/services/document-cycle.ts': 'const l = new DistributedLock(getBoxWideRedisClient());',
    'web/lib/rogue-cache.ts': 'const c = getBoxWideRedisClient();\nawait c.set("ipo:1", v);',
  };
  assert.deepEqual(findOffenders(Object.keys(files), read(files)), [
    'web/lib/rogue-cache.ts:1: const c = getBoxWideRedisClient();',
  ]);
  assert.ok(BOX_WIDE_CALLERS.has('scraper/src/services/document-cycle.ts'));
});
