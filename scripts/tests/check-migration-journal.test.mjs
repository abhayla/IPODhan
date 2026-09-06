// Mutation-proof self-test + live gate for the migration JOURNAL-LINT class
// (T-403 round 3, blocker 1). Run: node --test scripts/tests/check-migration-journal.test.mjs
//
// Two halves:
//   1. Fixture tests over the pure predicates in ../lib/migration-journal-lint.mjs
//      — deleting or weakening a rule turns these red.
//   2. A LIVE gate over the real web/drizzle/migrations/meta/_journal.json in
//      this repo, so a future hand-typed `when` (the exact class that caused
//      0045-0049 to sort above a real 2026-09-06 migration and get silently
//      skipped by drizzle's migrator) fails here instead of at a prod deploy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findNonMonotonicWhen,
  findFutureDatedWhen,
  findMissingArtifacts,
  lintJournal,
  snapshotKey,
  MONOTONIC_CHECK_FROM_IDX,
  FUTURE_CHECK_AFTER_IDX,
} from '../lib/migration-journal-lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'web', 'drizzle', 'migrations');
const META_DIR = join(MIGRATIONS_DIR, 'meta');

// ---- Fixture tests over the pure predicates ----

test('monotonic when values pass', () => {
  const entries = [
    { idx: 0, when: 100, tag: 'a' },
    { idx: 1, when: 200, tag: 'b' },
    { idx: 2, when: 300, tag: 'c' },
  ];
  assert.deepEqual(findNonMonotonicWhen(entries), []);
});

test('detects the EXACT shape that broke 0049 -> new-migration ordering', () => {
  // idx 32's when (1789031999000, hand-typed future date) is HIGHER than
  // idx 33's real-time when (1788685598881) before the round-3 fix — the
  // migrator would silently skip idx 33.
  const entries = [
    { idx: 32, when: 1789031999000, tag: '0049_ipo_details_ad_fields' },
    { idx: 33, when: 1788685598881, tag: '20260906090638_icy_firelord' },
  ];
  const violations = findNonMonotonicWhen(entries);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /idx 33/);
  assert.match(violations[0], /silently skipped/);
});

test('equal when values also fail (strictly-greater is the real invariant)', () => {
  const entries = [
    { idx: MONOTONIC_CHECK_FROM_IDX - 1, when: 500, tag: 'a' },
    { idx: MONOTONIC_CHECK_FROM_IDX, when: 500, tag: 'b' },
  ];
  assert.equal(findNonMonotonicWhen(entries).length, 1);
});

test('future-dated when fails for a NEW entry (idx > FUTURE_CHECK_AFTER_IDX)', () => {
  const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days out
  const entries = [{ idx: FUTURE_CHECK_AFTER_IDX + 1, when: farFuture, tag: 'x' }];
  const violations = findFutureDatedWhen(entries, Date.now());
  assert.equal(violations.length, 1);
  assert.match(violations[0], /24h in the future/);
});

test('future-dated when is ALLOWED up to and including idx 33 (0045-0049 + the forced-above-them repair entry)', () => {
  const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const entries = [
    { idx: FUTURE_CHECK_AFTER_IDX - 1, when: farFuture, tag: '0049_ipo_details_ad_fields' },
    { idx: FUTURE_CHECK_AFTER_IDX, when: farFuture, tag: '20260906090638_icy_firelord' },
  ];
  assert.deepEqual(findFutureDatedWhen(entries, Date.now()), []);
});

test('a when within 24h of now is fine for a new entry', () => {
  const soon = Date.now() + 60 * 60 * 1000; // 1h out — clock skew tolerance
  const entries = [{ idx: FUTURE_CHECK_AFTER_IDX + 1, when: soon, tag: 'x' }];
  assert.deepEqual(findFutureDatedWhen(entries, Date.now()), []);
});

test('missing .sql file fails unconditionally', () => {
  const entries = [{ idx: 0, when: 1, tag: 'ghost_migration' }];
  const violations = findMissingArtifacts(entries, new Set(), new Set());
  assert.ok(violations.some((v) => /no matching \.sql/.test(v)));
});

test('missing snapshot fails for a NEW entry (idx >= grandfather boundary)', () => {
  const entries = [
    { idx: MONOTONIC_CHECK_FROM_IDX, when: 1, tag: '99999999999999_new_thing' },
  ];
  const sqlTags = new Set(['99999999999999_new_thing']);
  const violations = findMissingArtifacts(entries, sqlTags, new Set());
  assert.ok(violations.some((v) => /no matching snapshot/.test(v)));
});

test('missing snapshot is ALLOWED for a grandfathered old entry (real repo history has gaps)', () => {
  const entries = [
    { idx: MONOTONIC_CHECK_FROM_IDX - 1, when: 1, tag: '0048_ipo_valuation_share_legs' },
  ];
  const sqlTags = new Set(['0048_ipo_valuation_share_legs']);
  const violations = findMissingArtifacts(entries, sqlTags, new Set());
  assert.deepEqual(violations, []);
});

test('snapshotKey extracts the numeric/timestamp prefix, not the full tag', () => {
  assert.equal(snapshotKey('0047_intermediary_role_sub_syndicate'), '0047');
  assert.equal(snapshotKey('20260906090638_icy_firelord'), '20260906090638');
});

test('lintJournal composes all three rules', () => {
  const entries = [
    { idx: MONOTONIC_CHECK_FROM_IDX - 1, when: 100, tag: 'a' },
    { idx: MONOTONIC_CHECK_FROM_IDX, when: 50, tag: 'b' }, // non-monotonic, in the checked range
  ];
  const violations = lintJournal(entries, {
    nowMs: Date.now(),
    sqlTags: new Set(['a', 'b']),
    snapshotKeys: new Set(),
  });
  assert.ok(violations.some((v) => new RegExp(`idx ${MONOTONIC_CHECK_FROM_IDX}\\b`).test(v)));
});

// ---- Live gate over the real journal in this repo ----

test('LIVE: the real journal is monotonic, not hand-typed into the future, and has its artifacts', () => {
  const journal = JSON.parse(readFileSync(join(META_DIR, '_journal.json'), 'utf8'));
  const entries = journal.entries ?? [];
  const sqlTags = new Set(
    readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
  );
  const snapshotKeys = new Set(
    readdirSync(META_DIR)
      .filter((f) => f.endsWith('_snapshot.json'))
      .map((f) => f.replace(/_snapshot\.json$/, ''))
  );

  const violations = lintJournal(entries, { nowMs: Date.now(), sqlTags, snapshotKeys });
  assert.deepEqual(violations, [], violations.join('\n'));
});
