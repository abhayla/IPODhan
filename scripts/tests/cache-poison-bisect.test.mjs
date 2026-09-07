// Self-test for scripts/lib/cache-poison-bisect.mjs (T-463 / issue #189).
//
// Imports the ACTUAL predicate under test — not a re-implementation — so
// weakening/deleting the check turns this fixture RED. Run:
//   node --test scripts/tests/cache-poison-bisect.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bisectDefaultParameter, issuePriceNullRate, buildSample } from '../lib/cache-poison-bisect.mjs';

function healthySample(n, count) {
  return {
    n,
    total: count,
    leadingIds: ['a', 'b', 'c'],
    nullRate: issuePriceNullRate(Array.from({ length: n }, () => ({ issuePrice: 100 }))),
  };
}

test('FAILS on a poisoned N sample (blank issuePrice) while N-1/N+1 are healthy — the incident shape', () => {
  const below = { n: 19, total: 243, leadingIds: ['a', 'b', 'c'], nullRate: 0 };
  const poisonedAt = { n: 20, total: 240, leadingIds: ['a', 'b', 'c'], nullRate: 1 }; // all null issuePrice — the T-268 shape
  const above = { n: 21, total: 243, leadingIds: ['a', 'b', 'c'], nullRate: 0 };

  const violation = bisectDefaultParameter(below, poisonedAt, above);
  assert.ok(violation, 'expected a violation string, got null');
  assert.match(violation, /total mismatch|null-rate divergence/);
});

test('PASSES when N-1/N/N+1 agree on total, leading ids, and null rate', () => {
  const below = healthySample(19, 243);
  const at = healthySample(20, 243);
  const above = healthySample(21, 243);

  assert.equal(bisectDefaultParameter(below, at, above), null);
});

test('PASSES when leading ids and totals agree but null rate drifts within tolerance', () => {
  const below = { n: 19, total: 243, leadingIds: ['a', 'b'], nullRate: 0.05 };
  const at = { n: 20, total: 243, leadingIds: ['a', 'b'], nullRate: 0.1 };
  const above = { n: 21, total: 243, leadingIds: ['a', 'b'], nullRate: 0.08 };

  assert.equal(bisectDefaultParameter(below, at, above), null);
});

test('FAILS on a wholesale leading-id swap at N even though totals and null rate agree (the T-268 incident shape)', () => {
  const below = { n: 19, total: 243, leadingIds: ['a', 'b', 'c'], nullRate: 0 };
  const at = { n: 20, total: 243, leadingIds: ['x', 'y', 'z'], nullRate: 0 };
  const above = { n: 21, total: 243, leadingIds: ['a', 'b', 'c'], nullRate: 0 };

  const violation = bisectDefaultParameter(below, at, above);
  assert.ok(violation);
  assert.match(violation, /leading id overlap below/);
});

test('PASSES when leading ids are reordered or one boundary row differs (tied secondary sort key jitter — real prod shape 2026-09-07)', () => {
  const below = { n: 19, total: 235, leadingIds: ['a', 'b', 'c', 'd', 'e'], nullRate: 0 };
  const at = { n: 20, total: 235, leadingIds: ['b', 'a', 'c', 'd', 'f'], nullRate: 0 }; // reordered + 1 boundary swap
  const above = { n: 21, total: 235, leadingIds: ['c', 'a', 'b', 'd', 'e'], nullRate: 0 };

  assert.equal(bisectDefaultParameter(below, at, above), null);
});

test('buildSample: a 200 with a non-JSON body is httpOk=false, not a trivial total=-1 agreement (round-3 finding)', () => {
  const s = buildSample(20, 200, undefined, 'Internal Server Error (not json)');
  assert.equal(s.httpOk, false);
  assert.equal(s.total, -1);
  assert.equal(s.n, 20);
  assert.match(s.bodySnippet, /not json/);
});

test('buildSample: a 200 whose json lacks a data array is httpOk=false', () => {
  const s = buildSample(21, 200, { pagination: { total: 5 } }, '{"pagination":{"total":5}}');
  assert.equal(s.httpOk, false);
});

test('buildSample: a healthy 200 JSON array response is httpOk=true', () => {
  const s = buildSample(19, 200, { data: [{ id: 'a', issuePrice: 100 }], pagination: { total: 1 } }, '{}');
  assert.equal(s.httpOk, true);
  assert.equal(s.total, 1);
  assert.deepEqual(s.leadingIds, ['a']);
});

test('issuePriceNullRate: computes fraction of rows with null/undefined issuePrice', () => {
  assert.equal(issuePriceNullRate([{ issuePrice: 100 }, { issuePrice: null }, { issuePrice: undefined }, { issuePrice: 50 }]), 0.5);
  assert.equal(issuePriceNullRate([]), 0);
});
