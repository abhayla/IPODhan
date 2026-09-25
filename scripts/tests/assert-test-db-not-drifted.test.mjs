// #558 — self-test for scripts/assert-test-db-not-drifted.mjs's URL
// resolution (the pure, injectable part; the drift check itself is
// scripts/assert-schema-drift.ts's own, already self-tested in
// scripts/tests/assert-schema-drift.test.ts — this file does not
// re-implement it).
//
// Run: node --test scripts/tests/assert-test-db-not-drifted.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDatabaseUrl } from '../assert-test-db-not-drifted.mjs';

test('#558 resolveDatabaseUrl prefers an explicit DATABASE_URL env var over the .env.test file', () => {
  const result = resolveDatabaseUrl(
    { DATABASE_URL: 'postgresql://x/explicit' },
    '/repo',
    () => 'DATABASE_URL=postgresql://x/from-file\n',
    () => true
  );
  assert.deepEqual(result, { url: 'postgresql://x/explicit', source: 'DATABASE_URL env var' });
});

test('#558 resolveDatabaseUrl falls back to scraper/.env.test when no env var is set', () => {
  let readPath = null;
  const result = resolveDatabaseUrl(
    {},
    '/repo',
    (p) => {
      readPath = p;
      return 'DATABASE_HOST=localhost\nDATABASE_URL=postgresql://ipodhan_app:pw@localhost:15432/ipodhan_test\nDATABASE_PORT=15432\n';
    },
    () => true
  );
  assert.deepEqual(result, { url: 'postgresql://ipodhan_app:pw@localhost:15432/ipodhan_test', source: 'scraper/.env.test' });
  // Path-separator-agnostic: joins repoRoot/scraper/.env.test regardless of OS.
  assert.match(readPath.replace(/\\/g, '/'), /\/repo\/scraper\/\.env\.test$/);
});

test('#558 resolveDatabaseUrl returns null when neither the env var nor the file exist — a no-op, never a refusal', () => {
  const result = resolveDatabaseUrl({}, '/repo', () => '', () => false);
  assert.equal(result, null);
});

test('#558 resolveDatabaseUrl returns null when scraper/.env.test exists but carries no DATABASE_URL line', () => {
  const result = resolveDatabaseUrl({}, '/repo', () => 'DATABASE_HOST=localhost\nDATABASE_PORT=15432\n', () => true);
  assert.equal(result, null);
});

test('#558 resolveDatabaseUrl trims trailing whitespace/CR from a .env.test line (CRLF-saved file)', () => {
  const result = resolveDatabaseUrl({}, '/repo', () => 'DATABASE_URL=postgresql://x/y\r\n', () => true);
  assert.equal(result.url, 'postgresql://x/y');
});
