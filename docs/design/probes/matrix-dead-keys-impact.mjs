#!/usr/bin/env node
// docs/design/probes/matrix-dead-keys-impact.mjs — #1186: what would change if the 13 dead
// snake_case priority-matrix rules were switched on (renamed to the camelCase name the writers use).
//
// WHY. `probes/matrix-dead-keys.mjs` counts the dead keys from source. This probe answers the
// question that decides between "rename" and "delete": for each dead key, does any real write ever
// reach the consolidator under the camelCase field name, and of the source decisions already
// recorded (`data_conflicts`), how many would the dead rule have decided DIFFERENTLY from the rule
// that actually ran (the matrix default, or the manifest resolver for a flipped group)?
//
// Read-only: `openReadOnlyPool` sets `default_transaction_read_only=on` server side and refuses a
// connection that is not read-only. The database name is asserted with `current_database()`.
// Usage: node docs/design/probes/matrix-dead-keys-impact.mjs [--db ipodhan_staging]

import fs from 'node:fs';
import path from 'node:path';
import { openReadOnlyPool, HERE } from './_lib.mjs';

const dbArg = process.argv.indexOf('--db');
const DB = dbArg > -1 ? process.argv[dbArg + 1] : 'ipodhan_staging';

// The matrix default (field-priority-matrix.ts getFieldRules fallback) — what runs today for every
// camelCase field with no entry.
const DEFAULT_SOURCES = ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'];

// Each dead key, the camelCase field names a writer could use for the same column, the table the
// column lives on (packages/shared/src/db/schema.ts), and the dead rule's source order / timeBased.
const DEAD = [
  { key: 'revenue_fy1', names: ['revenueFy1'], table: 'ipo_financials', sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: false },
  { key: 'fresh_issue_size', names: ['freshIssueSize', 'freshIssue'], table: 'ipo_details', sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: false },
  { key: 'offer_for_sale_size', names: ['offerForSaleSize', 'ofsIssue'], table: 'ipo_details', sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: false },
  { key: 'issue_price', names: ['issuePrice'], table: 'listing_performance', sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: false },
  { key: 'min_investment', names: ['minInvestment'], table: 'ipo_details', sources: ['ADMIN', 'DRHP', 'BSE', 'NSE', 'MONEYCONTROL'], timeBased: false },
  { key: 'total_subscription', names: ['totalSubscription'], table: 'subscriptions', sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: true },
  { key: 'retail_subscription', names: ['retailSubscription'], table: 'subscriptions', sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: true },
  { key: 'qib_subscription', names: ['qibSubscription'], table: 'subscriptions', sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: true },
  { key: 'nii_subscription', names: ['niiSubscription'], table: 'subscriptions', sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: true },
  { key: 'gmp_percentage', names: ['gmpPercentage'], table: 'gmp_records', sources: ['ADMIN', 'INVESTORGAIN_GMP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'], timeBased: true },
  { key: 'expected_listing_price', names: ['expectedListingPrice'], table: 'gmp_records', sources: ['ADMIN', 'INVESTORGAIN_GMP', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'], timeBased: true },
  { key: 'listing_price', names: ['listingPrice'], table: 'listing_performance', sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: true },
  { key: 'listing_gain_percentage', names: ['listingGainPercentage'], table: 'ipos', sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'], timeBased: true },
];

const rank = (order, s) => order.indexOf(s);
// Non-time-based winner between two sources: the lower non-negative index; an unranked (-1)
// source never wins against a ranked one. Returns null when neither is ranked.
function winner(order, a, b) {
  const ra = rank(order, a);
  const rb = rank(order, b);
  if (ra === -1 && rb === -1) return null;
  if (ra === -1) return b;
  if (rb === -1) return a;
  return ra <= rb ? a : b;
}

const pool = await openReadOnlyPool(DB);
const out = { probe: 'matrix-dead-keys-impact', generated_at: new Date().toISOString(), database: null, keys: [] };
try {
  const { rows: dbRows } = await pool.query('select current_database() as db');
  out.database = dbRows[0].db;
  if (out.database !== DB) throw new Error(`refusing: connected to ${out.database}, expected ${DB}`);

  const allNames = [...new Set(DEAD.flatMap((d) => [d.key, ...d.names]))];

  const { rows: fs1 } = await pool.query(
    `select table_name, field_name, source::text as source, count(*)::int as n
       from field_sources where field_name = any($1) group by 1,2,3 order by 1,2,3`,
    [allNames]
  );
  const { rows: dc } = await pool.query(
    `select table_name, field_name, source1::text as s1, source2::text as s2,
            resolved_source::text as resolved, resolution_reason as reason, count(*)::int as n
       from data_conflicts where field_name = any($1) group by 1,2,3,4,5,6 order by 1,2,3,4,5,6`,
    [allNames]
  );
  // Stored values on the consolidated child table that three of the keys map onto.
  const { rows: details } = await pool.query(
    `select count(*)::int as rows_total,
            count(fresh_issue)::int as fresh_issue_set,
            count(ofs_issue)::int as ofs_issue_set,
            count(min_investment)::int as min_investment_set
       from ipo_details`
  );
  const { rows: lgp } = await pool.query(`select count(listing_gain_percentage)::int as n from ipos`);

  for (const d of DEAD) {
    const names = [d.key, ...d.names];
    const prov = fs1.filter((r) => names.includes(r.field_name));
    const conflicts = dc.filter((r) => names.includes(r.field_name));
    let decidedDifferently = 0;
    let decided = 0;
    const diffs = [];
    for (const c of conflicts) {
      decided += c.n;
      // What the dead rule would pick vs the source that actually won.
      const deadPick = d.timeBased ? 'NEWEST (time-based)' : winner(d.sources, c.s1, c.s2);
      const defaultPick = winner(DEFAULT_SOURCES, c.s1, c.s2);
      const differs = d.timeBased ? true : deadPick !== (c.resolved ?? defaultPick);
      if (differs) {
        decidedDifferently += c.n;
        diffs.push({ table: c.table_name, field: c.field_name, s1: c.s1, s2: c.s2, resolved: c.resolved, reason: c.reason, deadRuleWouldPick: deadPick, n: c.n });
      }
    }
    out.keys.push({
      key: d.key,
      camelCaseNames: d.names,
      columnTable: d.table,
      provenanceRows: prov,
      provenanceRowCount: prov.reduce((a, r) => a + r.n, 0),
      conflictRows: decided,
      conflictsTheDeadRuleWouldDecideDifferently: decidedDifferently,
      differences: diffs,
    });
  }
  out.ipo_details_stored = details[0];
  out.ipos_listing_gain_percentage_stored = lgp[0].n;
} finally {
  await pool.end();
}

fs.writeFileSync(path.join(HERE, 'matrix-dead-keys-impact.out.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`database: ${out.database}`);
for (const k of out.keys) {
  console.log(
    `${k.key.padEnd(24)} table=${k.columnTable.padEnd(20)} provenance=${String(k.provenanceRowCount).padStart(6)} ` +
      `conflicts=${String(k.conflictRows).padStart(6)} decidedDifferently=${k.conflictsTheDeadRuleWouldDecideDifferently}` +
      (k.provenanceRows.length ? ` [${k.provenanceRows.map((r) => `${r.table_name}.${r.field_name}/${r.source}=${r.n}`).join(' ')}]` : '')
  );
}
console.log(`ipo_details stored: ${JSON.stringify(out.ipo_details_stored)}; ipos.listing_gain_percentage set: ${out.ipos_listing_gain_percentage_stored}`);
console.log('written: matrix-dead-keys-impact.out.json');
