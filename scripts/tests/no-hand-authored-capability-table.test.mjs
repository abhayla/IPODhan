// #739 (independent review of PR #738, finding 6): scripts/generate-field-manifest.mjs carried
// HAND_AUTHORED_CAPABILITY, a hand-written table reproducing the 10 original rows' capability
// `reason` texts byte-for-byte, with nothing cross-checking it against
// docs/design/field-source-resolution.spec.mjs (the one source table) — so the two could disagree
// on WHY a source is capable/incapable without any gate noticing.
//
// This test proves the generator source has NO such hand-written table, and that every field which
// used to have a hand-authored capability reason now reads it from the spec's own `o.capability`.
// Red before the #739 fix (the table existed); green after (table deleted, spec carries the text).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR_PATH = join(ROOT, 'scripts', 'generate-field-manifest.mjs');
const SPEC_PATH = join(ROOT, 'docs', 'design', 'field-source-resolution.spec.mjs');

// The 10 fields item 2 / S0b hand-authored capability reasons for (git show, pre-#739 fix).
const FIELDS_THAT_HAD_HAND_AUTHORED_CAPABILITY = [
  'ipos.issue_size',
  'ipo_details.fresh_issue',
  'financial_statements.revenue',
  'ipo_details.ofs_issue',
  'ipo_details.min_investment',
  'subscriptions.total_subscription',
  'subscriptions.retail_subscription',
  'subscriptions.qib_subscription',
  'subscriptions.nii_subscription',
  'listing_performance.listing_price',
];

test('generator source has no HAND_AUTHORED_CAPABILITY table', () => {
  const src = fs.readFileSync(GENERATOR_PATH, 'utf8');
  assert.ok(
    !src.includes('HAND_AUTHORED_CAPABILITY'),
    'generate-field-manifest.mjs must not carry a hand-written capability-reason table — ' +
      'capability reasons belong on the spec rows (docs/design/field-source-resolution.spec.mjs), ' +
      'never duplicated in the generator (#739)'
  );
});

test('every field that had a hand-authored capability reason now carries it in the spec', async () => {
  const specModule = await import(pathToFileURL(SPEC_PATH).href);
  const F = specModule.F;
  assert.ok(Array.isArray(F) && F.length > 0, 'spec must export F');

  for (const key of FIELDS_THAT_HAD_HAND_AUTHORED_CAPABILITY) {
    const [t, c] = key.split('.');
    const row = F.find((f) => f.t === t && f.c === c);
    assert.ok(row, `spec must have a row for ${key}`);
    assert.ok(
      row.o && row.o.capability && typeof row.o.capability === 'object',
      `spec row ${key} must carry an o.capability map (moved from the generator's hand-authored table, #739)`
    );
  }
});
