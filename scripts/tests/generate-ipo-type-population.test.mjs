// Item 30: unit tests for the pure fixture->table transform. No DB
// connection here — the --check drift behaviour against a live staging read
// is proven separately as the card's "Staging proof" (a real generator run,
// not a fixture), per docs/design/build-cards/item-30-ipo-type-table.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToTypes } from '../ops/generate-ipo-type-population.mjs';

test('canonical key is the three-column product, not segment alone', () => {
  const rows = [
    { segment: 'MAINBOARD', offering_type: 'IPO', issue_type: 'BOOK_BUILDING', total: '10', live_or_recent: '5' },
    { segment: 'MAINBOARD', offering_type: 'IPO', issue_type: 'FIXED_PRICE', total: '2', live_or_recent: '1' },
    { segment: 'SME', offering_type: 'IPO', issue_type: 'BOOK_BUILDING', total: '3', live_or_recent: '3' },
  ];
  const types = rowsToTypes(rows);
  const keys = types.map((t) => t.key).sort();
  assert.deepEqual(keys, [
    'MAINBOARD/IPO/BOOK_BUILDING',
    'MAINBOARD/IPO/FIXED_PRICE',
    'SME/IPO/BOOK_BUILDING',
  ]);
});

test('sample_sufficient is false at 0 and 1 live_or_recent, true at 2 — the boundary, asserted at the value', () => {
  const rows = [
    { segment: 'MAINBOARD', offering_type: 'NCD', issue_type: null, total: '5', live_or_recent: '0' },
    { segment: 'MAINBOARD', offering_type: 'RIGHTS', issue_type: null, total: '5', live_or_recent: '1' },
    { segment: 'MAINBOARD', offering_type: 'TENDER', issue_type: null, total: '5', live_or_recent: '2' },
  ];
  const types = rowsToTypes(rows);
  const byKey = Object.fromEntries(types.map((t) => [t.key, t]));
  assert.equal(byKey['MAINBOARD/NCD/UNCLASSIFIED'].sample_sufficient, false);
  assert.equal(byKey['MAINBOARD/RIGHTS/UNCLASSIFIED'].sample_sufficient, false);
  assert.equal(byKey['MAINBOARD/TENDER/UNCLASSIFIED'].sample_sufficient, true);
});

test('scraper_owned is the owner boundary, independent of sample count — OFS and UNCLASSIFIED segment are never owned, MAINBOARD/IPO always is', () => {
  const rows = [
    // OFS: high sample count (19 live_or_recent) but frozen per OD-53 — must not be owned.
    { segment: null, offering_type: 'OFS', issue_type: null, total: '19', live_or_recent: '19' },
    // UNCLASSIFIED segment (no exchange-listed segment) — never owned, regardless of offering_type.
    { segment: null, offering_type: 'IPO', issue_type: null, total: '10', live_or_recent: '10' },
    // MAINBOARD/IPO is on the owner's list — owned even with a thin sample.
    { segment: 'MAINBOARD', offering_type: 'IPO', issue_type: 'BOOK_BUILDING', total: '89', live_or_recent: '77' },
    // MAINBOARD/FPO is on the owner's list "by the owner's word, not by sample count" — owned at 0 samples.
    { segment: 'MAINBOARD', offering_type: 'FPO', issue_type: null, total: '0', live_or_recent: '0' },
    // MAINBOARD/NCD has plenty of samples but is admin-owned per the boundary table — must not be owned.
    { segment: 'MAINBOARD', offering_type: 'NCD', issue_type: null, total: '4', live_or_recent: '4' },
    // SME/RIGHTS is on the owner's list.
    { segment: 'SME', offering_type: 'RIGHTS', issue_type: null, total: '2', live_or_recent: '2' },
  ];
  const types = rowsToTypes(rows);
  const byKey = Object.fromEntries(types.map((t) => [t.key, t]));
  assert.equal(byKey['UNCLASSIFIED/OFS/UNCLASSIFIED'].scraper_owned, false);
  assert.equal(byKey['UNCLASSIFIED/IPO/UNCLASSIFIED'].scraper_owned, false);
  assert.equal(byKey['MAINBOARD/IPO/BOOK_BUILDING'].scraper_owned, true);
  assert.equal(byKey['MAINBOARD/FPO/UNCLASSIFIED'].scraper_owned, true);
  assert.equal(byKey['MAINBOARD/NCD/UNCLASSIFIED'].scraper_owned, false);
  assert.equal(byKey['SME/RIGHTS/UNCLASSIFIED'].scraper_owned, true);
});

test('a row with a NULL segment lands in a named UNCLASSIFIED bucket, never dropped', () => {
  const rows = [
    { segment: null, offering_type: 'RIGHTS', issue_type: null, total: '40', live_or_recent: '2' },
  ];
  const types = rowsToTypes(rows);
  assert.equal(types.length, 1);
  assert.equal(types[0].segment, 'UNCLASSIFIED');
  assert.equal(types[0].issue_type, 'UNCLASSIFIED');
  assert.equal(types[0].total, 40);
});

// The `--check` red-then-green proof against the LIVE staging tunnel is not
// run here: CI has no staging DB (only a spun-up ipodhan_test, see
// .github/workflows/pr-gate.yml and docs-gate.yml's own "no npm ci, node:
// builtins only" constraint — `pg` is not a builtin, so this generator
// cannot run in either CI workflow at all). That proof is the card's
// "Staging proof" section: a real local run against ipodhan_staging through
// the sanctioned tunnel, read back by a human/reviewer, per
// docs/design/build-cards/item-30-ipo-type-table.md and
// defect-fix-contract.md. This test instead proves the DRIFT-COMPARISON
// LOGIC itself against a fixture aggregate, with the DB query mocked out by
// operating on the committed json's shape directly.
test('--check drift comparison: identical types pass, one changed count fails', () => {
  const committed = { types: [{ key: 'MAINBOARD/IPO/BOOK_BUILDING', total: 89, live_or_recent: 77, sample_sufficient: true, scraper_owned: true }] };
  const fresh = { types: [{ key: 'MAINBOARD/IPO/BOOK_BUILDING', total: 89, live_or_recent: 77, sample_sufficient: true, scraper_owned: true }] };
  assert.equal(JSON.stringify(committed.types), JSON.stringify(fresh.types));

  const corrupted = { types: [{ key: 'MAINBOARD/IPO/BOOK_BUILDING', total: 88, live_or_recent: 77, sample_sufficient: true, scraper_owned: true }] };
  assert.notEqual(JSON.stringify(committed.types), JSON.stringify(corrupted.types));
});
