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

test('idx 31 -> idx 32 (real journal shape) is why MONOTONIC_CHECK_FROM_IDX cannot go below 33', () => {
  // idx 31 (0048_ipo_valuation_share_legs) carries a hand-typed `when`
  // (1788945600000) that is HIGHER than idx 32's honest, corrected `when`
  // (1788685590000) — 0049 was actually authored two days before 0048's
  // synthetic date. Fixing idx 31 is out of scope for this change, so this
  // pair must stay below MONOTONIC_CHECK_FROM_IDX or every CI run on the
  // real journal fails on an entry this change was never asked to touch.
  const entries = [
    { idx: 31, when: 1788945600000, tag: '0048_ipo_valuation_share_legs' },
    { idx: 32, when: 1788685590000, tag: '0049_ipo_details_ad_fields' },
  ];
  assert.deepEqual(
    findNonMonotonicWhen(entries),
    [],
    'idx 32 must not be flagged against idx 31 while MONOTONIC_CHECK_FROM_IDX = 33'
  );
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
  assert.match(violations[0], /in the future/);
});

test('there is no idx-based grandfather any more — a LOW idx is checked exactly like a high one', () => {
  // Before this fix round, FUTURE_CHECK_AFTER_IDX = 33 meant nothing at or
  // below idx 33 was ever checked here, which is exactly the gap that let
  // GitHub #442's three hand-typed future `when` values (idx 32-34) sit in
  // the journal undetected. FUTURE_CHECK_AFTER_IDX = -1 removes that
  // exemption entirely — this fixture proves it with an idx far below the
  // old boundary.
  const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const violations = findFutureDatedWhen([{ idx: 5, when: farFuture, tag: 'x' }], Date.now());
  assert.equal(violations.length, 1);
  assert.match(violations[0], /idx 5/);
});

test('the exact idx 32-34 shape GitHub #442 shipped is no longer grandfathered', () => {
  // A regression test pinned to the real entries: if 0049/icy_firelord/
  // left_loners were ever hand-typed back into the future, the tightened
  // check must catch it — this is the precise scenario the old
  // FUTURE_CHECK_AFTER_IDX = 33 boundary let through.
  const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const entries = [
    { idx: 32, when: farFuture, tag: '0049_ipo_details_ad_fields' },
    // Far beyond the minimum needed to stay monotonic past idx 32, so idx 33
    // is flagged in its own right and not merely as "the minimum ceiling".
    { idx: 33, when: farFuture + 10 * 24 * 60 * 60 * 1000, tag: '20260906090638_icy_firelord' },
  ];
  const violations = findFutureDatedWhen(entries, Date.now());
  const violatedIdx = violations.map((v) => Number(/^idx (\d+)/.exec(v)[1]));
  assert.ok(violatedIdx.includes(32), `expected idx 32 to be flagged, got: ${violations.join('\n')}`);
  assert.ok(violatedIdx.includes(33), `expected idx 33 to be flagged, got: ${violations.join('\n')}`);
});

test('a when within the clock-skew tolerance of now is fine for a new entry', () => {
  const soon = Date.now() + 60 * 1000; // 1min out — inside CLOCK_SKEW_TOLERANCE_MS (5min)
  const entries = [{ idx: FUTURE_CHECK_AFTER_IDX + 1, when: soon, tag: 'x' }];
  assert.deepEqual(findFutureDatedWhen(entries, Date.now()), []);
});

test('a when just past the clock-skew tolerance of now fails for a new entry', () => {
  const tooFar = Date.now() + 60 * 60 * 1000; // 1h out — beyond CLOCK_SKEW_TOLERANCE_MS (5min)
  const entries = [{ idx: FUTURE_CHECK_AFTER_IDX + 1, when: tooFar, tag: 'x' }];
  const violations = findFutureDatedWhen(entries, Date.now());
  assert.equal(violations.length, 1);
});

test('a when just above a far-future predecessor is ALLOWED (minimum needed to stay monotonic)', () => {
  const now = Date.now();
  const farFuturePrev = now + 30 * 24 * 60 * 60 * 1000;
  const entries = [
    { idx: FUTURE_CHECK_AFTER_IDX, when: farFuturePrev, tag: '20260906090638_icy_firelord' },
    { idx: FUTURE_CHECK_AFTER_IDX + 1, when: farFuturePrev + 1000, tag: 'new_migration' },
  ];
  assert.deepEqual(findFutureDatedWhen(entries, now), []);
});

test('a when far beyond a far-future predecessor is REJECTED (more than the minimum needed)', () => {
  const now = Date.now();
  const farFuturePrev = now + 30 * 24 * 60 * 60 * 1000;
  const entries = [
    { idx: FUTURE_CHECK_AFTER_IDX, when: farFuturePrev, tag: '20260906090638_icy_firelord' },
    { idx: FUTURE_CHECK_AFTER_IDX + 1, when: farFuturePrev + 10 * 24 * 60 * 60 * 1000, tag: 'new_migration' },
  ];
  const violations = findFutureDatedWhen(entries, now);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /beyond the minimum needed to stay monotonic/);
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

test('LIVE: idx 31 -> idx 32 (plus the pre-existing idx 11 -> idx 12) are the ONLY monotonic violations anywhere in the real journal', () => {
  // MONOTONIC_CHECK_FROM_IDX = 33 exempts everything below it from
  // findNonMonotonicWhen, which is exactly why running that function against
  // the real journal (as the live gate above does) can never see either drop
  // by itself. This test removes the exemption and checks the WHOLE journal,
  // so both known violations — idx 11 -> 12 (pre-existing, already-deployed,
  // predates this lint) and idx 31 -> 32 (this change's residue) — stay a
  // pinned, bounded pair instead of an unbounded blind spot: if fixing idx
  // 31, editing the ladder at idx 25-31, or any future change introduces a
  // THIRD monotonic violation anywhere in the journal, this test goes red
  // even though the live gate above (scoped to idx >= 33) would stay green.
  const journal = JSON.parse(readFileSync(join(META_DIR, '_journal.json'), 'utf8'));
  const entries = journal.entries ?? [];
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  const violations = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.when <= prev.when) {
      violations.push({ idx: cur.idx, prevIdx: prev.idx });
    }
  }
  assert.deepEqual(
    violations,
    [
      { idx: 12, prevIdx: 11 },
      { idx: 32, prevIdx: 31 },
    ],
    `expected exactly the two known drops (idx 11->12, idx 31->32), got: ${JSON.stringify(violations)}`
  );
});

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
