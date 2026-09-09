#!/usr/bin/env node
// docs/design/probes/amount-columns.mjs — OD-20's evidence.
//
// WHY. The owner's words are "crore should be the default for every amount column." Acting on that
// needs a list of which columns ARE amount columns, and that list must not be a sentence somebody
// typed: `schema.ts` has 160 numeric/bigint columns and the difference between an amount, a
// per-share price, a percentage, a ratio, a subscription multiple and a share count is exactly the
// difference between a correct conversion and a 10,000,000x error on the public site. This probe
// reads the schema and classifies EVERY one of them, refusing to finish if a single column falls
// through the rules.
//
//   node docs/design/probes/amount-columns.mjs                 report + write the .out.json
//   node docs/design/probes/amount-columns.mjs --markdown       print the design's inventory table
//
// EXIT: 0 all columns classified · 1 at least one unclassified · 2 the probe itself broke.
//
// Read-only: it opens one source file and writes its own output beside itself. No database, no
// network, no server.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(HERE, '../../../packages/shared/src/db/schema.ts');
const OUT = path.join(HERE, 'amount-columns.out.json');

// ---------------------------------------------------------------------------
// The classes. Only CRORE is in scope for OD-20's conversion.
// ---------------------------------------------------------------------------
//   CRORE        an aggregate rupee amount at company or issue scale -> stored in crore
//   RUPEES_KEPT  a rupee amount at retail scale -> stays in rupees, and WHY is stated per column
//   PER_SHARE    a rupee value per share (a price, a per-share cost, a per-share gain)
//   PERCENT      a percentage
//   RATIO        a dimensionless ratio (P/E, D/E, current ratio, a confidence)
//   MULTIPLE     a times-covered figure (subscription, face-value multiple)
//   SHARE_COUNT  a count of shares or bids
//   NON_MONEY    everything else that happens to be numeric (file size)

// Explicit per-column rulings come first: a rule that has to be argued belongs here, by name,
// not hidden inside a suffix match.
const BY_NAME = {
  'ipos.issue_size':                       ['CRORE',       'the headline issue size — the single most-read amount on the site'],
  'ipos.listing_gain_amount':              ['PER_SHARE',   'listing price minus issue price, per share, not an aggregate'],
  'ipos.current_gain_amount':              ['PER_SHARE',   'current price minus issue price, per share'],
  'ipos.gmp_price':                        ['PER_SHARE',   'grey-market premium is quoted per share'],
  'ipo_details.fresh_issue':               ['CRORE',       'the fresh-issue amount'],
  'ipo_details.ofs_issue':                 ['CRORE',       'the offer-for-sale amount'],
  'ipo_details.min_investment':            ['RUPEES_KEPT', 'a retail application amount (about 15,000 rupees). In crore it reads 0.0015 — see O-12'],
  'ipo_details.max_retail_subscription':   ['RUPEES_KEPT', 'the retail application ceiling in rupees (2 lakh), a regulatory threshold read in rupees'],
  'ipo_details.max_employee_subscription': ['RUPEES_KEPT', 'the employee application ceiling in rupees (5 lakh), a regulatory threshold read in rupees'],
  'ipo_details.employee_discount':         ['PER_SHARE',   'a discount per share, in rupees'],
  'ipo_details.cut_off_price':             ['PER_SHARE',   'a price per share'],
  'ipo_details.face_value':                ['PER_SHARE',   'a price per share'],
  'ipo_details.tick_size':                 ['PER_SHARE',   'the bid increment, in rupees per share'],
  'anchor_investors.total_amount_raised':  ['CRORE',       'the anchor book total — already stored in crore, and the reference the rest converges on'],
  'financial_statements.rent_expense':     ['CRORE',       'an expense line from the financial statements'],
  'financial_statements.op_cash_flow':     ['CRORE',       'a cash-flow line from the financial statements'],
  'financial_statements.dscr':             ['RATIO',       'debt service coverage ratio'],
  'financial_statements.eps_basic':        ['PER_SHARE',   'earnings per share'],
  'financial_statements.eps_diluted':      ['PER_SHARE',   'earnings per share'],
  'financial_data.market_cap':             ['CRORE',       'market capitalisation'],
  'financial_data.net_worth':              ['CRORE',       'a balance-sheet aggregate'],
  'financial_data.reserves_and_surplus':   ['CRORE',       'a balance-sheet aggregate'],
  'financial_data.total_assets':           ['CRORE',       'a balance-sheet aggregate'],
  'financial_data.total_borrowing':        ['CRORE',       'a balance-sheet aggregate'],
  'financial_data.total_borrowings':       ['CRORE',       'a balance-sheet aggregate (the duplicate spelling of the column above)'],
  'financial_data.inventory_turnover':     ['RATIO',       'a turnover ratio, not an amount'],
  'ipo_valuation.mcap_at_floor':           ['CRORE',       'market capitalisation at the floor price'],
  'ipo_valuation.mcap_at_cap':             ['CRORE',       'market capitalisation at the cap price'],
  'ipo_valuation.ronw_weighted_3y':        ['PERCENT',     'a weighted three-year return on net worth'],
  'ipo_valuation.price_floor':             ['PER_SHARE',   'a price per share'],
  'ipo_valuation.price_cap':               ['PER_SHARE',   'a price per share'],
  'promoters.waca':                        ['PER_SHARE',   'weighted average cost of ACQUISITION, per share'],
  'promoters.waca_last_year':              ['PER_SHARE',   'weighted average cost of acquisition, per share'],
  'promoter_acquisition_ranges.waca':      ['PER_SHARE',   'weighted average cost of acquisition, per share'],
  'promoter_acquisition_ranges.price_low': ['PER_SHARE',   'a price per share'],
  'promoter_acquisition_ranges.price_high':['PER_SHARE',   'a price per share'],
  'promoter_acquisition_ranges.cap_multiple': ['MULTIPLE', 'cap price divided by the acquisition cost'],
  'peer_companies.nav':                    ['PER_SHARE',   'net asset value per share'],
  'gmp_records.gmp':                       ['PER_SHARE',   'grey-market premium, per share'],
  'gmp_records.expected_listing_price':    ['PER_SHARE',   'a price per share'],
  'gmp_records.kostak_rate':               ['RUPEES_KEPT', 'a per-APPLICATION grey-market rate, quoted in rupees (hundreds), never in crore'],
  'gmp_records.subject_rate':              ['RUPEES_KEPT', 'a per-application grey-market rate, quoted in rupees'],
  'documents.file_size':                   ['NON_MONEY',   'bytes'],
  'documents.extraction_confidence':       ['RATIO',       'a 0-1 confidence score'],
  'ipo_demand_graph.price_point':          ['PER_SHARE',   'a bid price per share'],
  'ipo_demand_graph.cumulative_quantity':  ['SHARE_COUNT', 'a share quantity'],
  'ipo_financials.industry_pe':            ['RATIO',       'an industry price-to-earnings ratio'],
};

// Then the name-shape rules, in order. Each returns [class, why].
const BY_SHAPE = [
  [/_percent(age)?(_|$)|^roe$|^ronw$|_pct$|holding_(pre|post)_issue$|^roe_percentage$|^roce_percentage$/, 'PERCENT', 'a percentage by name'],
  [/^pe_|_pe$|^pe$|ratio$|^debt_to_equity$|^pb_ratio$|^pbv_ratio$|^pe_at_|^current_ratio$|^quick_ratio$/, 'RATIO', 'a dimensionless ratio by name'],
  [/subscription(_|$)|^face_value_multiple_/, 'MULTIPLE', 'a times-covered multiple by name'],
  [/shares?(_|$)|_shares$|_bid$|_bids_|^total_bids_|quantity$|shares_held$|shares_bid$|shares_offered$/, 'SHARE_COUNT', 'a count of shares or bids by name'],
  [/^eps|_eps$|price(_|$)|^nav$/, 'PER_SHARE', 'a per-share rupee value by name'],
  [/^(revenue|profit|pat|ebitda|total_income|net_worth)(_fy\d+|_fy\d|$)/, 'CRORE', 'a financial-statement aggregate by name'],
];

try {
  const src = fs.readFileSync(SCHEMA, 'utf8');

  // Table blocks: `export const x = pgTable('name', {`
  const heads = [...src.matchAll(/export const \w+ = pgTable\(\s*'([a-z_0-9]+)'/g)]
    .map((m) => ({ at: m.index, table: m[1] }));
  heads.push({ at: src.length, table: null });

  const cols = [];
  for (let i = 0; i < heads.length - 1; i++) {
    const blk = src.slice(heads[i].at, heads[i + 1].at);
    for (const m of blk.matchAll(/(\w+):\s*(numeric|bigint)\(\s*'([a-z_0-9]+)'/g)) {
      cols.push({ table: heads[i].table, col: m[3], ts: m[1], type: m[2] });
    }
  }

  const unclassified = [];
  for (const c of cols) {
    const key = `${c.table}.${c.col}`;
    if (BY_NAME[key]) { [c.cls, c.why] = BY_NAME[key]; c.rule = 'by-name'; continue; }
    const hit = BY_SHAPE.find(([re]) => re.test(c.col));
    if (hit) { c.cls = hit[1]; c.why = hit[2]; c.rule = 'by-shape'; continue; }
    unclassified.push(key);
  }

  const byClass = cols.reduce((a, c) => (a[c.cls || 'UNCLASSIFIED'] = (a[c.cls || 'UNCLASSIFIED'] || 0) + 1, a), {});
  const crore = cols.filter((c) => c.cls === 'CRORE').sort((a, b) =>
    a.table === b.table ? a.col.localeCompare(b.col) : a.table.localeCompare(b.table));

  if (process.argv.includes('--markdown')) {
    console.log('| Table | Column | Stored as today | Becomes |');
    console.log('|---|---|---|---|');
    for (const c of crore) console.log(`| \`${c.table}\` | \`${c.col}\` | ${c.type} | \`numeric(12,2)\` crore |`);
    process.exit(unclassified.length ? 1 : 0);
  }

  const out = {
    probe: 'amount-columns',
    generated_at: new Date().toISOString(),
    source: 'packages/shared/src/db/schema.ts',
    total_numeric_bigint_columns: cols.length,
    by_class: byClass,
    unclassified,
    columns: cols.map(({ table, col, type, cls, why, rule }) => ({ table, col, type, cls, why, rule })),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  console.log(`schema: ${cols.length} numeric/bigint columns`);
  console.log('by class: ' + JSON.stringify(byClass));
  console.log(`CRORE (OD-20 conversion scope): ${crore.length} columns across ` +
    `${new Set(crore.map((c) => c.table)).size} tables`);
  console.log(`written: ${path.relative(process.cwd(), OUT)}`);
  if (unclassified.length) {
    console.log('UNCLASSIFIED — every column must have a ruling: ' + unclassified.join(', '));
    process.exit(1);
  }
  console.log('every numeric/bigint column carries a ruling.');
  process.exit(0);
} catch (err) {
  console.error('amount-columns: the probe itself failed —', err.message);
  process.exit(2);
}
