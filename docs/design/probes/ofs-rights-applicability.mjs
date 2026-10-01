#!/usr/bin/env node
// docs/design/probes/ofs-rights-applicability.mjs — #1293 sweep: which stored values would a §1.11
// NOT_APPLICABLE marking hide on the page? Spec §1.11 says the price band, lot size, anchor and
// allotment fields are NOT_APPLICABLE for OFS (exchange offer-for-sale), and a rights issue has "no
// lot size in the IPO sense". Counts the rows of each type that hold a value in those columns today,
// with names, so the change is decided on real rows. Read-only (openReadOnlyPool), database asserted.
// Usage: node docs/design/probes/ofs-rights-applicability.mjs [--db ipodhan_staging]

import fs from 'node:fs';
import path from 'node:path';
import { openReadOnlyPool, HERE } from './_lib.mjs';

const dbArg = process.argv.indexOf('--db');
const DB = dbArg > -1 ? process.argv[dbArg + 1] : 'ipodhan_staging';
const pool = await openReadOnlyPool(DB);
const out = { probe: 'ofs-rights-applicability', generated_at: new Date().toISOString(), database: null, types: {} };
try {
  const { rows: dbRows } = await pool.query('select current_database() as db');
  out.database = dbRows[0].db;
  if (out.database !== DB) throw new Error(`refusing: connected to ${out.database}, expected ${DB}`);
  for (const type of ['OFS', 'RIGHTS']) {
    const { rows } = await pool.query(
      `select i.slug, i.status::text as status,
              i.price_range_min is not null as band, i.lot_size is not null as lot,
              i.allotment_date is not null as allot,
              d.basis_of_allotment_date is not null as basis,
              d.initiation_of_refunds_date is not null as refunds,
              d.credit_of_shares_date is not null as credit,
              d.retail_max_allottees is not null as allottees
         from ipos i left join ipo_details d on d.ipo_id = i.id
        where i.offering_type::text = $1
        order by i.slug`,
      [type]
    );
    const count = (k) => rows.filter((r) => r[k]).length;
    out.types[type] = {
      rows: rows.length,
      withValue: {
        price_range_min: count('band'),
        lot_size: count('lot'),
        allotment_date: count('allot'),
        basis_of_allotment_date: count('basis'),
        initiation_of_refunds_date: count('refunds'),
        credit_of_shares_date: count('credit'),
        retail_max_allottees: count('allottees'),
      },
      rowsWithAnyValue: rows
        .filter((r) => r.band || r.lot || r.allot || r.basis || r.refunds || r.credit || r.allottees)
        .map((r) => ({ slug: r.slug, status: r.status, band: r.band, lot: r.lot, allot: r.allot, basis: r.basis, refunds: r.refunds, credit: r.credit, allottees: r.allottees })),
    };
  }
} finally {
  await pool.end();
}
fs.writeFileSync(path.join(HERE, 'ofs-rights-applicability.out.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`database: ${out.database}`);
for (const [t, v] of Object.entries(out.types)) {
  console.log(`${t}: ${v.rows} rows; with value: ${JSON.stringify(v.withValue)}`);
  for (const r of v.rowsWithAnyValue) console.log(`  ${r.slug} (${r.status}) ${JSON.stringify(r)}`);
}
