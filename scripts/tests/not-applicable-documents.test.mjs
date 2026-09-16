import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summariseNotApplicableDocuments,
  collectNotApplicableDocuments,
  EXTRACTABLE_DOC_TYPES_MIRROR,
} from '../lib/not-applicable-documents.mjs';

/**
 * Lane B, NOT_APPLICABLE reporting slice (2026-09-16). This module replaced
 * `ratios-extraction-yield.mjs`'s UNVERIFIABLE-forever ratio check (which
 * measured a population, RATIOS_BASIS_ISSUE_PRICE, that has no extractor and
 * can never move) with an honest PASS-always report naming which PENDING
 * document types have no extractor and how many sit there. The exact detail
 * string matters: it is what stops a human from reading "documents PENDING"
 * as a stuck queue.
 */

test('no PENDING not-applicable documents is a plain PASS', () => {
  const r = summariseNotApplicableDocuments({ byType: [] });
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /nothing to name/);
});

test('zero-count rows are dropped before naming', () => {
  const r = summariseNotApplicableDocuments({
    byType: [{ type: 'RATIOS_BASIS_ISSUE_PRICE', pending: 0 }],
  });
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /nothing to name/);
});

test('the detail names each type and count, and says this is not a queue', () => {
  const r = summariseNotApplicableDocuments({
    byType: [
      { type: 'RATIOS_BASIS_ISSUE_PRICE', pending: 34 },
      { type: 'CORRIGENDUM', pending: 2 },
    ],
  });
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /36 document\(s\)/);
  assert.match(r.detail, /RATIOS_BASIS_ISSUE_PRICE 34/);
  assert.match(r.detail, /CORRIGENDUM 2/);
  assert.match(r.detail, /no extractor exists for them/);
  assert.match(r.detail, /this is not a queue/);
});

test('never FAILs — the type having no extractor is a design fact, not a defect', () => {
  const r = summariseNotApplicableDocuments({
    byType: [{ type: 'RATIOS_BASIS_ISSUE_PRICE', pending: 1000 }],
  });
  assert.equal(r.status, 'PASS');
});

test('the collector excludes every extractable type, mirroring AUTO_PERSIST_DOC_TYPES', async () => {
  const asked = [];
  const q = async (sql, params) => {
    asked.push({ sql, params });
    return [{ type: 'RATIOS_BASIS_ISSUE_PRICE', pending: 34 }];
  };
  const r = await collectNotApplicableDocuments(q);
  assert.equal(r.status, 'PASS');
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].params, EXTRACTABLE_DOC_TYPES_MIRROR);
  assert.match(asked[0].sql, /extraction_status\s*=\s*'PENDING'/);
  assert.match(asked[0].sql, /type not in/);
});
