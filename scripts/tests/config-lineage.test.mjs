// #793 M3 — tests for scripts/ops/config-lineage.mjs.
//
// The defect that made this script necessary (found in adversarial review): the
// in-cycle check in deploy-drift-monitor.ts runs inside the scraper's main(),
// which is reached only AFTER the startup config validators — the very calls
// that throw during this incident. A detector killed by the failure it detects
// is not a detector, so this one runs from outside the process entirely.
//
// The load-bearing assertions: a real drift is DRIFT (exit 3), a matching
// 8-char-vs-40-char pair is IN-SYNC, and the "release" seed marker is UNKNOWN
// rather than in-sync — that last one is the blind spot that would otherwise
// exempt exactly the slots most at risk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, shasMatch } from '../ops/config-lineage.mjs';

const SERVED = 'b12c9d28';
const SAME_40 = 'b12c9d28' + 'f'.repeat(32);
const OLD_40 = '9c20b4d0' + 'e'.repeat(32);

test('a config from a different commit than the code is DRIFT', () => {
  const r = classify(SERVED, OLD_40);
  assert.equal(r.status, 'drift');
  assert.match(r.detail, /b12c9d28/);
  assert.match(r.detail, /9c20b4d0/);
});

test('an 8-char served sha matching a 40-char CONFIG_SHA by prefix is IN-SYNC', () => {
  assert.equal(classify(SERVED, SAME_40).status, 'in-sync');
});

test('the "release" seed marker is UNKNOWN, never in-sync (the C2 blind spot)', () => {
  const r = classify(SERVED, 'release');
  assert.equal(r.status, 'unknown', 'a slot seeded once and never config-deployed is the MOST drift-prone, not the safest');
  assert.match(r.detail, /never been config-deployed/);
});

test('an unreadable served sha or CONFIG_SHA is UNKNOWN, never in-sync', () => {
  assert.equal(classify(null, OLD_40).status, 'unknown');
  assert.equal(classify(SERVED, null).status, 'unknown');
  assert.equal(classify(SERVED, '').status, 'unknown');
});

test('shasMatch refuses non-hex rather than matching it', () => {
  assert.equal(shasMatch(SERVED, 'main'), false);
  assert.equal(shasMatch(SERVED, 'release'), false);
  assert.equal(shasMatch('', OLD_40), false);
  // and it does not match on a too-short prefix
  assert.equal(shasMatch('b12', SAME_40), false);
});

test('two genuinely different shas never match', () => {
  assert.equal(shasMatch('aaaaaaaa', 'b'.repeat(40)), false);
});
