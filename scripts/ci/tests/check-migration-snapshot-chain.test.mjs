/**
 * Self-test for check-migration-snapshot-chain.
 *
 * Every case is a MUTATION: a chain that is deliberately broken in one specific
 * way, asserting the checker names that break and no other. A guard whose
 * mutation leaves the suite green is not a guard, and this checker was written
 * precisely because a whole class of merged-and-green artifacts turned out to
 * measure nothing.
 *
 * The last case is the real defect that caused this file to exist, replayed with
 * the two real snapshot ids from 2026-09-10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../check-migration-snapshot-chain.mjs';

const ROOT = '00000000-0000-0000-0000-000000000000';

/** A healthy three-link chain: root -> a -> b -> c. */
function healthy() {
  return [
    { file: '0000_snapshot.json', id: 'a', prevId: ROOT },
    { file: '0001_snapshot.json', id: 'b', prevId: 'a' },
    { file: '0002_snapshot.json', id: 'c', prevId: 'b' },
  ];
}
const journal = [
  { idx: 0, tag: '0000_first' },
  { idx: 1, tag: '0001_second' },
  { idx: 2, tag: '0002_third' },
];

const rules = problems => problems.map(p => p.rule).sort();

test('a straight chain has no problems', () => {
  assert.deepEqual(analyze(healthy(), journal), []);
});

test('the checker can actually fail — a fork is not silently accepted', () => {
  const snaps = healthy();
  snaps[2].prevId = 'a'; // c now forks off a, beside b
  assert.notEqual(analyze(snaps, journal).length, 0);
});

test('two snapshots sharing a parent are reported as unique-parent AND two heads', () => {
  const snaps = healthy();
  snaps[2].prevId = 'a';
  assert.deepEqual(rules(analyze(snaps, journal)), ['single-head', 'unique-parent']);
});

test('the unique-parent message names BOTH files, so the fix needs no further digging', () => {
  const snaps = healthy();
  snaps[2].prevId = 'a';
  const p = analyze(snaps, journal).find(x => x.rule === 'unique-parent');
  assert.match(p.detail, /0001_snapshot\.json/);
  assert.match(p.detail, /0002_snapshot\.json/);
});

test('a parent that is no snapshot at all is caught', () => {
  const snaps = healthy();
  snaps[1].prevId = 'ghost';
  const rs = rules(analyze(snaps, journal));
  assert.ok(rs.includes('parent-exists'), rs.join(','));
});

test('the root sentinel is NOT reported as a missing parent', () => {
  const problems = analyze(healthy(), journal);
  assert.equal(problems.filter(p => p.rule === 'parent-exists').length, 0);
});

test('two duplicate ids are caught even when the chain otherwise looks linear', () => {
  const snaps = healthy();
  snaps[2].id = 'b';
  const rs = rules(analyze(snaps, journal));
  assert.ok(rs.includes('unique-parent'), rs.join(','));
});

test('a dangling extra head is caught', () => {
  const snaps = healthy();
  snaps.push({ file: '0009_snapshot.json', id: 'z', prevId: ROOT });
  const rs = rules(analyze(snaps, journal));
  assert.ok(rs.includes('single-head'), rs.join(','));
  assert.ok(rs.includes('unique-parent'), rs.join(','));
});

test('a cycle does not hang the walk and is reported as zero heads', () => {
  const snaps = [
    { file: '0000_snapshot.json', id: 'a', prevId: 'c' },
    { file: '0001_snapshot.json', id: 'b', prevId: 'a' },
    { file: '0002_snapshot.json', id: 'c', prevId: 'b' },
  ];
  const rs = rules(analyze(snaps, journal));
  assert.ok(rs.includes('single-head'), rs.join(','));
});

test('a parent with a HIGHER journal idx is caught by journal-order', () => {
  // 0002 shipped at idx 2 but claims 0003 (idx 3) as its parent.
  const snaps = [
    { file: '0000_snapshot.json', id: 'a', prevId: ROOT },
    { file: '0003_snapshot.json', id: 'b', prevId: 'a' },
    { file: '0002_snapshot.json', id: 'c', prevId: 'b' },
  ];
  const j = [
    { idx: 0, tag: '0000_first' },
    { idx: 2, tag: '0002_third' },
    { idx: 3, tag: '0003_fourth' },
  ];
  const rs = rules(analyze(snaps, j));
  assert.ok(rs.includes('journal-order'), rs.join(','));
});

test('a snapshot with no journal entry is NOT reported — 20260909200044 is real and legitimate', () => {
  const snaps = healthy();
  snaps.push({ file: '9999_snapshot.json', id: 'd', prevId: 'c' });
  // d is the new head; nothing about it lacking a journal entry may fire.
  assert.deepEqual(analyze(snaps, journal), []);
});

test('a journal entry with no snapshot is NOT reported — 14 real ones have none', () => {
  const j = [...journal, { idx: 3, tag: '0099_hand_written_repair' }];
  assert.deepEqual(analyze(healthy(), j), []);
});

test('the 2026-09-10 defect, replayed with its real ids', () => {
  const snaps = [
    { file: '20260909200044_snapshot.json', id: '02d8a6d4', prevId: '17abcd02' },
    { file: '20260910043758_snapshot.json', id: '1912f30f', prevId: '02d8a6d4' },
    { file: '20260910121813_snapshot.json', id: '8553716d', prevId: '02d8a6d4' },
    { file: '20260909153933_snapshot.json', id: '17abcd02', prevId: ROOT },
  ];
  const problems = analyze(snaps, [
    { idx: 35, tag: '20260909153933_sloppy_morph' },
    { idx: 36, tag: '20260910043758_salty_shen' },
    { idx: 37, tag: '20260910121813_cooing_manta' },
  ]);
  assert.deepEqual(rules(problems), ['single-head', 'unique-parent']);
});

test('the same chain, repaired the way this PR repairs it, is clean', () => {
  const snaps = [
    { file: '20260909200044_snapshot.json', id: '02d8a6d4', prevId: '17abcd02' },
    { file: '20260910043758_snapshot.json', id: '1912f30f', prevId: '02d8a6d4' },
    { file: '20260910121813_snapshot.json', id: '8553716d', prevId: '1912f30f' },
    { file: '20260909153933_snapshot.json', id: '17abcd02', prevId: ROOT },
  ];
  assert.deepEqual(
    analyze(snaps, [
      { idx: 35, tag: '20260909153933_sloppy_morph' },
      { idx: 36, tag: '20260910043758_salty_shen' },
      { idx: 37, tag: '20260910121813_cooing_manta' },
    ]),
    []
  );
});
