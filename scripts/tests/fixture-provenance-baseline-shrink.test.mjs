// T-518 round 2 review, MAJOR 3: the fixture-provenance baseline must be
// shrink-only like config/write-ratchet-baseline.json — same
// diffAgainstBaseline() model: a NEW failing file not already listed FAILs,
// and a STALE entry (listed but no longer failing) ALSO FAILs, forcing the
// shrink to be committed via --update rather than silently rotting forever
// (this is what stops a stale entry becoming cover for a bad file re-added
// at the same path — check-write-ratchet.mjs's own header explains the
// same risk). Imports the real exported diffAgainstBaseline() from the CLI
// script, so weakening it turns this red before the gate can silently stop
// enforcing the shrink-only rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffAgainstBaseline, checkSkipRatchet } from '../ci/require-fixture-provenance.mjs';

test('dropping a baseline entry (the fixture was fixed) is a clean diff', () => {
  const result = diffAgainstBaseline(['a.html'], ['a.html', 'b.html']);
  assert.deepEqual(result.newFiles, []);
  assert.deepEqual(result.staleFiles, ['b.html']);
});

test('a NEW failing file not in the baseline is reported as newFiles (FAIL)', () => {
  const result = diffAgainstBaseline(['a.html', 'c.html'], ['a.html']);
  assert.deepEqual(result.newFiles, ['c.html']);
  assert.deepEqual(result.staleFiles, []);
});

test('a baseline entry that no longer fails is STALE (FAIL) — the shrink must be committed, not left invisible', () => {
  const result = diffAgainstBaseline(['a.html'], ['a.html', 'z.html']);
  assert.deepEqual(result.staleFiles, ['z.html']);
});

test('exact match (found set === baseline set) is clean on both sides', () => {
  const result = diffAgainstBaseline(['a.html', 'b.html'], ['b.html', 'a.html']);
  assert.deepEqual(result.newFiles, []);
  assert.deepEqual(result.staleFiles, []);
});

test('a hand-added baseline entry for a file that currently is NOT failing is caught as stale on the very next run', () => {
  // Simulates someone hand-editing the baseline JSON to grandfather a file
  // that already has valid provenance (round 2 review MAJOR 3 concern) —
  // the next plain run treats it as staleFiles and FAILs until removed.
  const currentlyFailing = ['a.html'];
  const handEditedBaseline = ['a.html', 'already-fixed.html'];
  const result = diffAgainstBaseline(currentlyFailing, handEditedBaseline);
  assert.deepEqual(result.staleFiles, ['already-fixed.html']);
});

// Round 3 review, MAJOR 1: pageType:true (or the narrow filename-check skip)
// growing silently is exactly the same class of hole the file-list ratchet
// above closes -- these lock the SKIP COUNT itself.
test('checkSkipRatchet: same or shrunk count passes', () => {
  assert.equal(checkSkipRatchet(5, 5).ok, true);
  assert.equal(checkSkipRatchet(5, 3).ok, true);
});

test('checkSkipRatchet: a grown count FAILs, naming both numbers', () => {
  const result = checkSkipRatchet(5, 6);
  assert.equal(result.ok, false);
  assert.equal(result.recorded, 5);
  assert.equal(result.current, 6);
});
