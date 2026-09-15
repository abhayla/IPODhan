// Item 12 slice F. The duplicate-row invariant grouped on fold + EXACT open date, so a twin
// pair whose two sources disagree about the open day split into two groups and the invariant
// reported "no duplicate" over a real duplicate. Measured on ipodhan_staging 2026-09-16:
// "H R Hygiene Products" @2026-07-26 vs its three twins @2026-07-29, and "Shree Balaji Mala
// Textiles" @2026-07-19 vs its three @2026-07-22 — a 3-day spread in both cases.
//
// These tests drive the REAL exported invariant through a fake pg pool, so they exercise the
// shipped grouping, not a re-implementation of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import duplicateIpoRowsInvariant, { foldName } from '../lib/repair-invariants/duplicate-ipo-rows.mjs';

const poolOf = (rows) => ({ query: async () => ({ rows }) });
const row = (slug, company_name, open_date) =>
  ({ id: slug, slug, company_name, open_date, status: 'LISTED', issue_size: null });

test('two rows of one company three days apart are ONE violation group', async () => {
  const { count, details } = await duplicateIpoRowsInvariant(poolOf([
    row('h-r-hygiene-products-ltd', 'H R Hygiene Products', '2026-07-26'),
    row('h-r-hygiene-products-ltd-ipo', 'H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO)', '2026-07-29'),
  ]));
  assert.equal(count, 1, `expected one group, got ${JSON.stringify(details)}`);
  assert.deepEqual(details[0].slugs.sort(), ['h-r-hygiene-products-ltd', 'h-r-hygiene-products-ltd-ipo']);
});

test('the same company FOUR days apart stays two groups — the tolerance is 3, not "near enough"', async () => {
  const { count } = await duplicateIpoRowsInvariant(poolOf([
    row('a', 'H R Hygiene Products', '2026-07-25'),
    row('b', 'H.R.Hygiene Products Ltd.', '2026-07-29'),
  ]));
  assert.equal(count, 0);
});

test('the twelve real staging rows collapse to exactly three violation groups', async () => {
  const { count, details } = await duplicateIpoRowsInvariant(poolOf([
    row('gv-1', 'G.V.Electricals Ltd.', '2026-07-31'),
    row('gv-2', 'G.V.Electricals Ltd. (G.V. Electricals IPO) CT', '2026-07-31'),
    row('gv-3', 'G.V.Electricals Ltd. (G.V. Electricals IPO) LT', '2026-07-31'),
    row('gv-4', 'G.V.Electricals Ltd. (G.V. Electricals IPO) P', '2026-07-31'),
    row('hr-1', 'H R Hygiene Products', '2026-07-26'),
    row('hr-2', 'H.R.Hygiene Products Ltd.', '2026-07-29'),
    row('hr-3', 'H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO)', '2026-07-29'),
    row('hr-4', 'H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO) CT', '2026-07-29'),
    row('sb-1', 'Shree Balaji (Mala) Textiles Ltd.', '2026-07-22'),
    row('sb-2', 'Shree Balaji (Mala) Textiles Ltd. (Shree Balaji Mala IPO) CT', '2026-07-22'),
    row('sb-3', 'Shree Balaji (Mala) Textiles Ltd. (Shree Balaji Mala IPO) P', '2026-07-22'),
    row('sb-4', 'Shree Balaji Mala Textiles', '2026-07-19'),
  ]));
  assert.equal(count, 3, `expected 3 groups, got ${JSON.stringify(details, null, 2)}`);
  assert.deepEqual(details.map((d) => d.slugs.length).sort(), [4, 4, 4]);
  assert.deepEqual(
    details.map((d) => d.fold).sort(),
    ['gvelectricals', 'hrhygieneproducts', 'shreebalajimalatextiles'],
  );
});

test('two genuinely different companies opening the same day are NOT a group', async () => {
  const { count } = await duplicateIpoRowsInvariant(poolOf([
    row('sun', 'Sun Pharmaceutical Industries Ltd', '2026-07-22'),
    row('sunrise', 'Sunrise Pharmaceutical Industries Ltd', '2026-07-22'),
  ]));
  assert.equal(count, 0);
});

test('the issue-size agreement the invariant prints survives the regrouping', async () => {
  const { details } = await duplicateIpoRowsInvariant(poolOf([
    { ...row('x', 'Acme Widgets Ltd', '2026-07-22'), issue_size: '10.00' },
    { ...row('y', 'Acme Widgets Ltd. (Acme Widgets IPO) CT', '2026-07-24'), issue_size: '20.00' },
  ]));
  assert.deepEqual(details[0].issueSizes.sort(), [10, 20]);
});

test('DUPLICATE_INVARIANT_FOLDS still narrows to the named folds', async () => {
  const rows = [
    row('gv-1', 'G.V.Electricals Ltd.', '2026-07-31'),
    row('gv-2', 'G.V.Electricals Ltd. (G.V. Electricals IPO) CT', '2026-07-31'),
    row('hr-1', 'H R Hygiene Products', '2026-07-26'),
    row('hr-2', 'H.R.Hygiene Products Ltd.', '2026-07-29'),
  ];
  process.env.DUPLICATE_INVARIANT_FOLDS = 'gvelectricals';
  try {
    const { count, details } = await duplicateIpoRowsInvariant(poolOf(rows));
    assert.equal(count, 1);
    assert.equal(details[0].fold, 'gvelectricals');
  } finally { delete process.env.DUPLICATE_INVARIANT_FOLDS; }
});

test('foldName strips the bracketed IPO tail but not a bare trailing token', () => {
  assert.equal(foldName('G.V.Electricals Ltd. (G.V. Electricals IPO) CT'), foldName('G.V.Electricals Ltd.'));
  assert.notEqual(foldName('Jay Bee Laminations Ltd. O'), foldName('Jay Bee Laminations Ltd.'));
});

// Found while running the invariant read-only against ipodhan_staging on 2026-09-16: the label
// printed "Sun Jul 26..Wed Jul 29" because open_date arrives as a Date on this path and
// String(date).slice(0,10) yields the weekday. The same truncation fed the day-difference maths.
test('open_date as a Date object groups and LABELS by the ISO calendar day', async () => {
  const { count, details } = await duplicateIpoRowsInvariant(poolOf([
    { ...row('hr-a', 'H R Hygiene Products', new Date('2026-07-26T00:00:00Z')) },
    { ...row('hr-b', 'H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO)', new Date('2026-07-29T00:00:00Z')) },
  ]));
  assert.equal(count, 1);
  assert.equal(details[0].openDate, '2026-07-26..2026-07-29');
});

test('Date objects respect the same 3-day ceiling as date strings', async () => {
  const { count } = await duplicateIpoRowsInvariant(poolOf([
    { ...row('a', 'H R Hygiene Products', new Date('2026-07-25T00:00:00Z')) },
    { ...row('b', 'H.R.Hygiene Products Ltd.', new Date('2026-07-29T00:00:00Z')) },
  ]));
  assert.equal(count, 0);
});

// F-104. node-pg parses a bare `date` into a Date at LOCAL midnight, so a UTC projection of it
// prints the day BEFORE the one the server sent. Measured 2026-09-16: the invariant printed
// 2026-07-30 for rows whose open_date is 2026-07-31.
test('a Date at local midnight labels as the day the server sent, not the UTC day before', async () => {
  const localMidnight = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const { details } = await duplicateIpoRowsInvariant(poolOf([
    { ...row('gv-1', 'G.V.Electricals Ltd.', localMidnight('2026-07-31')) },
    { ...row('gv-2', 'G.V.Electricals Ltd. (G.V. Electricals IPO) CT', localMidnight('2026-07-31')) },
  ]));
  assert.equal(details[0].openDate, '2026-07-31');
});

// Tier A review of #667, blocker 2. Clustering on the gap between CONSECUTIVE sorted rows is
// transitive: a chain of rows 2 days apart each never breaks, so five rows could span 8 days —
// and a longer chain 15 — inside one "3-day" group. The tolerance must bound the WHOLE cluster,
// not each step, or the invariant claims a spread it never checked.
test('a chain of rows two days apart does NOT collapse into one group past the bound', async () => {
  const { count, details } = await duplicateIpoRowsInvariant(poolOf([
    row('c1', 'Chainco Ltd', '2026-07-01'),
    row('c2', 'Chainco Ltd. (Chainco IPO)', '2026-07-03'),
    row('c3', 'Chainco Ltd. (Chainco IPO) CT', '2026-07-05'),
    row('c4', 'Chainco Ltd. (Chainco IPO) LT', '2026-07-07'),
    row('c5', 'Chainco Ltd. (Chainco IPO) P', '2026-07-09'),
  ]));
  // 2026-07-01..07-09 is an 8-day span: it must NOT be one group.
  for (const d of details) {
    const [first, last] = d.openDate.includes('..') ? d.openDate.split('..') : [d.openDate, d.openDate];
    const span = (new Date(`${last}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / 86400000;
    assert.ok(span <= 3, `group ${d.fold} spans ${span} days, above the 3-day bound: ${d.openDate}`);
  }
  assert.ok(count >= 2, `an 8-day chain must split into at least two groups, got ${count}`);
});

// Positive control for the bound: it must not be so tight that it breaks the real twins.
test('the bound still keeps the real 3-day twin pair in ONE group', async () => {
  const { count, details } = await duplicateIpoRowsInvariant(poolOf([
    row('h1', 'H R Hygiene Products', '2026-07-26'),
    row('h2', 'H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO)', '2026-07-29'),
  ]));
  assert.equal(count, 1, `expected one group, got ${JSON.stringify(details)}`);
  assert.equal(details[0].openDate, '2026-07-26..2026-07-29');
});
