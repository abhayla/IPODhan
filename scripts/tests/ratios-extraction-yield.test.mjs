import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summariseRatiosYield,
  collectRatiosYield,
  RATIOS_DOCUMENT_TYPE,
} from '../lib/ratios-extraction-yield.mjs';

/**
 * The whole point of these tests is the EMPTY case.
 *
 * The check this file guards was specified as "current_ratio non-null for every
 * COMPLETED Ratios document". Measured on staging: 34 such documents exist and
 * every one is PENDING, so a literal reading is true of the empty set and the
 * check would page green forever while the feature had never once run.
 */

test('an empty population is UNVERIFIABLE, never PASS', () => {
  const r = summariseRatiosYield({ completed: [], pendingCount: 34, totalCount: 34 });
  assert.equal(r.status, 'UNVERIFIABLE');
  assert.notEqual(r.status, 'PASS');
});

test('the unverifiable detail carries the number a human can act on', () => {
  const r = summariseRatiosYield({ completed: [], pendingCount: 34, totalCount: 34 });
  // "0 violations" would be worse than useless here. The actionable fact is
  // that 34 documents exist and not one has ever been read.
  assert.match(r.detail, /34 Ratios/);
  assert.match(r.detail, /NOT ONE has been extracted/);
  assert.match(r.detail, /measured nothing/);
});

test('no documents at all is still UNVERIFIABLE, with a different reason', () => {
  const r = summariseRatiosYield({ completed: [], pendingCount: 0, totalCount: 0 });
  assert.equal(r.status, 'UNVERIFIABLE');
  assert.match(r.detail, /no Ratios.*document exists at all/);
});

test('a COMPLETED document that produced no ratio FAILS', () => {
  const r = summariseRatiosYield({
    completed: [
      { documentId: 'd1', ipoId: 'i1', companyName: 'Vinod Texworld', currentRatio: null },
    ],
    pendingCount: 33,
    totalCount: 34,
  });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.offenders.length, 1);
  assert.match(r.offenders[0], /Vinod Texworld/);
  assert.match(r.offenders[0], /current_ratio is null/);
});

test('an empty string counts as no ratio, the way numeric columns come back', () => {
  const r = summariseRatiosYield({
    completed: [{ documentId: 'd1', ipoId: 'i1', companyName: 'X', currentRatio: '' }],
    pendingCount: 0,
    totalCount: 1,
  });
  assert.equal(r.status, 'FAIL');
});

test('a COMPLETED document that produced a ratio PASSES', () => {
  const r = summariseRatiosYield({
    completed: [{ documentId: 'd1', ipoId: 'i1', companyName: 'X', currentRatio: '1.42' }],
    pendingCount: 0,
    totalCount: 1,
  });
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.offenders, []);
});

test('the PASS detail still names how many were never examined', () => {
  // A pass over 1 of 34 documents is not the same claim as a pass over 34,
  // and a verdict that hides its own coverage is how a 8.7%-coverage check
  // once reported a confident "0 violations" on this repository.
  const r = summariseRatiosYield({
    completed: [{ documentId: 'd1', ipoId: 'i1', companyName: 'X', currentRatio: '1.42' }],
    pendingCount: 33,
    totalCount: 34,
  });
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /33 more still PENDING/);
});

test('a zero ratio is a real value, not an absence', () => {
  const r = summariseRatiosYield({
    completed: [{ documentId: 'd1', ipoId: 'i1', companyName: 'X', currentRatio: 0 }],
    pendingCount: 0,
    totalCount: 1,
  });
  assert.equal(r.status, 'PASS');
});

test('the collector asks for the RATIOS type and nothing else', async () => {
  const asked = [];
  const q = async (sql, params) => {
    asked.push({ sql, params });
    if (/count\(\*\)/.test(sql)) return [{ total: 34, pending: 34 }];
    return [];
  };
  const r = await collectRatiosYield(q);
  assert.equal(r.status, 'UNVERIFIABLE');
  assert.equal(asked.length, 2);
  for (const a of asked) {
    assert.deepEqual(a.params, [RATIOS_DOCUMENT_TYPE]);
  }
  // The population query must be scoped to COMPLETED; without that scope the
  // check would count PENDING documents as failures and page every night for a
  // feature that simply has not run yet.
  assert.match(asked[1].sql, /extraction_status\s*=\s*'COMPLETED'/);
});
