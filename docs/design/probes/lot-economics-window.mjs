#!/usr/bin/env node
// docs/design/probes/lot-economics-window.mjs — #721: which stored ipos rows sit outside their
// segment's SEBI retail window (lot_size x price_range_max, Rule 9 in
// packages/shared/src/utils/ipo-field-checks.ts), and how many have no segment at all (the rows
// Rule 9 cannot judge). Read-only (openReadOnlyPool), database asserted.
// Usage: node docs/design/probes/lot-economics-window.mjs [--db ipodhan_staging]
import fs from 'node:fs';
import path from 'node:path';
import { openReadOnlyPool, HERE } from './_lib.mjs';

const dbArg = process.argv.indexOf('--db');
const DB = dbArg > -1 ? process.argv[dbArg + 1] : 'ipodhan_staging';
const pool = await openReadOnlyPool(DB);
const out = { probe: 'lot-economics-window', generated_at: new Date().toISOString(), database: null };
try {
  const { rows: dbRows } = await pool.query('select current_database() as db');
  out.database = dbRows[0].db;
  if (out.database !== DB) throw new Error(`refusing: connected to ${out.database}, expected ${DB}`);
  const { rows } = await pool.query(
    `select i.slug, i.status::text as status, i.segment::text as segment, d.issue_type::text as issue_type,
            i.offering_type::text as offering_type, i.lot_size::float8 as lot, i.price_range_max::float8 as cap,
            (i.lot_size * i.price_range_max)::float8 as min_investment
       from ipos i left join ipo_details d on d.ipo_id = i.id where i.lot_size is not null and i.price_range_max is not null`
  );
  const W = { MAINBOARD: [10000, 16000], SME: [100000, 200000] };
  const judged = rows.filter((r) => r.issue_type !== 'FIXED_PRICE');
  out.rowsWithLotAndCap = rows.length;
  out.noSegment = judged.filter((r) => !r.segment).map((r) => r.slug);
  out.outsideWindow = judged
    .filter((r) => W[r.segment] && (r.min_investment < W[r.segment][0] || r.min_investment > W[r.segment][1]))
    .map((r) => ({ slug: r.slug, status: r.status, segment: r.segment, offering_type: r.offering_type, lot: r.lot, cap: r.cap, minInvestment: r.min_investment }));
} finally {
  await pool.end();
}
fs.writeFileSync(path.join(HERE, 'lot-economics-window.out.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`database: ${out.database}; rows with lot+cap: ${out.rowsWithLotAndCap}; no segment (Rule 9 cannot judge): ${out.noSegment.length}; outside window: ${out.outsideWindow.length}`);
for (const r of out.outsideWindow) console.log(`  ${r.slug} ${r.status} ${r.segment}/${r.offering_type} lot ${r.lot} x cap ${r.cap} = ${r.minInvestment}`);
