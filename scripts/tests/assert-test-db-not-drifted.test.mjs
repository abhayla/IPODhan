// #558 — self-test for scripts/assert-test-db-not-drifted.mjs's URL
// resolution (the pure, injectable part; the drift check itself is
// scripts/assert-schema-drift.ts's own, already self-tested in
// scripts/tests/assert-schema-drift.test.ts — this file does not
// re-implement it).
//
// Run: node --test scripts/tests/assert-test-db-not-drifted.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDatabaseUrl, decideOutcome, OVERRIDE_ENV_VAR } from '../assert-test-db-not-drifted.mjs';

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

// --- round 1 (Tier B REVISE): the unconditional refusal locked out every
// local test:integration run against the real ipodhan_test (15 real drift
// findings on 2026-09-25, none fixable by a developer without the owner's
// DB-change approval). decideOutcome() is the pure three-way branch that
// fixes it; each case is injected directly, no DB, no subprocess.

test('#558 decideOutcome: drift + NO override -> exit 1, message names the override var', () => {
  const outcome = decideOutcome({
    hadDrift: true,
    findingsText: '[UNIQUE_CONSTRAINT_COLUMN_MISMATCH] "field_sources.unique_field_source_per_ipo" expects columns (ipo_id, table_name, field_name), live constraint covers (ipo_id, table_name, row_key, field_name)',
    overrideSet: false,
  });
  assert.equal(outcome.exitCode, 1);
  const text = outcome.lines.join('\n');
  assert.match(text, /unique_field_source_per_ipo/); // the actual finding is quoted, not summarized away
  assert.match(text, new RegExp(OVERRIDE_ENV_VAR)); // the exact override var is named
  assert.equal(OVERRIDE_ENV_VAR, 'IPODHAN_ACCEPT_TEST_DB_DRIFT');
});

test('#558 decideOutcome: drift + override SET -> exit 0, findings still printed plus an ACCEPTED DRIFT line', () => {
  const outcome = decideOutcome({
    hadDrift: true,
    findingsText: '[COLUMN_TYPE_MISMATCH] "gmp_records.gmp" expects numeric(10,2), live column is numeric(32,0)',
    overrideSet: true,
  });
  assert.equal(outcome.exitCode, 0);
  const text = outcome.lines.join('\n');
  assert.match(text, /gmp_records\.gmp/); // every finding is still printed, never swallowed
  assert.match(text, /ACCEPTED DRIFT \(override\)/);
  assert.match(text, new RegExp(OVERRIDE_ENV_VAR));
});

test('#558 decideOutcome: no drift -> exit 0, no refusal or override language at all', () => {
  const outcome = decideOutcome({ hadDrift: false, findingsText: '', overrideSet: false });
  assert.equal(outcome.exitCode, 0);
  const text = outcome.lines.join('\n');
  assert.doesNotMatch(text, /REFUSING/);
  assert.doesNotMatch(text, /ACCEPTED DRIFT/);
  assert.match(text, /OK/);
});

test('#558 decideOutcome: no drift + override set is irrelevant — override only matters when there IS drift', () => {
  const outcome = decideOutcome({ hadDrift: false, findingsText: '', overrideSet: true });
  assert.equal(outcome.exitCode, 0);
  assert.doesNotMatch(outcome.lines.join('\n'), /ACCEPTED DRIFT/);
});

test('#558 mutation guard: an inverted overrideSet branch would flip exit codes — confirms the fixture can fail', () => {
  const withOverride = decideOutcome({ hadDrift: true, findingsText: 'x', overrideSet: true });
  const withoutOverride = decideOutcome({ hadDrift: true, findingsText: 'x', overrideSet: false });
  assert.notEqual(withOverride.exitCode, withoutOverride.exitCode);
});
