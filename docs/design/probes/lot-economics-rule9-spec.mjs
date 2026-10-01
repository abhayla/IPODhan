#!/usr/bin/env node
// docs/design/probes/lot-economics-rule9-spec.mjs — #721: what changes when Rule 9 (the lot-economics
// check in packages/shared/src/utils/ipo-field-checks.ts) is aligned with spec §1.2 row 4 / §1.11 and
// runs on rows with no segment using the §2.8 inference.
//
//   OLD rule: segment-gated (no segment = not judged), MAINBOARD 10,000-16,000, SME 1,00,000-2,00,000,
//             FIXED_PRICE exempt.
//   NEW rule: MAINBOARD 10,000 <= lot x cap <= 15,000; SME lot x cap >= 1,00,000 (no per-lot upper
//             bound); a missing segment is inferred (SME when lot x cap >= 50,000 and the IPO is not
//             listed on two exchanges, else MAINBOARD); FIXED_PRICE is judged too.
//
// For every row whose verdict differs it prints the values, and it names the rows where the LOT may
// be right and the stored CAP wrong (lot x floor inside the window while lot x cap is outside, or a
// band wider than the segment's SEBI limit) — those are the refusals that would discard a correct lot.
// Read-only (openReadOnlyPool), database asserted.
// Usage: node docs/design/probes/lot-economics-rule9-spec.mjs [--db ipodhan_staging]
import fs from 'node:fs';
import path from 'node:path';
import { openReadOnlyPool, HERE } from './_lib.mjs';

const dbArg = process.argv.indexOf('--db');
const DB = dbArg > -1 ? process.argv[dbArg + 1] : 'ipodhan_staging';

const OLD = { MAINBOARD: [10000, 16000], SME: [100000, 200000] };
const NEW = { MAINBOARD: [10000, 15000], SME: [100000, Infinity] };

function inferSegment(r) {
  const exchanges = Array.isArray(r.listing_exchanges) ? r.listing_exchanges : [];
  if (r.min_investment >= 50000 && exchanges.length < 2) return 'SME';
  return 'MAINBOARD';
}
const outside = (w, v) => v < w[0] || v > w[1];

function oldRefuses(r) {
  if (r.issue_type === 'FIXED_PRICE') return false;
  if (!OLD[r.segment]) return false;
  return outside(OLD[r.segment], r.min_investment);
}
function newRefuses(r) {
  const seg = r.segment || inferSegment(r);
  return outside(NEW[seg], r.min_investment);
}

const pool = await openReadOnlyPool(DB);
const out = { probe: 'lot-economics-rule9-spec', generated_at: new Date().toISOString(), database: null };
try {
  const { rows: dbRows } = await pool.query('select current_database() as db');
  out.database = dbRows[0].db;
  if (out.database !== DB) throw new Error(`refusing: connected to ${out.database}, expected ${DB}`);
  const { rows } = await pool.query(
    `select i.slug, i.status::text as status, i.segment::text as segment, d.issue_type::text as issue_type,
            i.offering_type::text as offering_type, i.listing_exchanges,
            i.lot_size::float8 as lot, i.price_range_min::float8 as floor, i.price_range_max::float8 as cap,
            (i.lot_size * i.price_range_max)::float8 as min_investment,
            (select fs.source::text from field_sources fs where fs.ipo_id = i.id and fs.table_name = 'ipos'
               and fs.field_name = 'lotSize' order by fs.updated_at desc nulls last limit 1) as lot_source,
            (select fs.source::text from field_sources fs where fs.ipo_id = i.id and fs.table_name = 'ipos'
               and fs.field_name = 'priceRangeMax' order by fs.updated_at desc nulls last limit 1) as cap_source
       from ipos i left join ipo_details d on d.ipo_id = i.id
      where i.lot_size is not null and i.price_range_max is not null`
  );
  out.rowsWithLotAndCap = rows.length;
  out.noSegment = rows.filter((r) => !r.segment).length;
  out.fixedPrice = rows.filter((r) => r.issue_type === 'FIXED_PRICE').length;
  out.oldRefuses = rows.filter(oldRefuses).length;
  out.newRefuses = rows.filter(newRefuses).length;
  const describe = (r) => {
    const seg = r.segment || inferSegment(r);
    const w = NEW[seg];
    const floorInvestment = r.floor ? r.lot * r.floor : null;
    const bandPct = r.floor ? ((r.cap - r.floor) / r.floor) * 100 : null;
    const bandLimit = seg === 'SME' ? 40 : 20;
    const capSuspect =
      (floorInvestment !== null && !outside(w, floorInvestment)) || (bandPct !== null && bandPct > bandLimit);
    return {
      slug: r.slug, status: r.status, segment: r.segment, inferredSegment: r.segment ? null : seg,
      sourcedVsInferred: r.segment && r.segment !== inferSegment(r) ? `sourced ${r.segment}, inferred ${inferSegment(r)}` : null,
      issue_type: r.issue_type, offering_type: r.offering_type, listing_exchanges: r.listing_exchanges,
      lot: r.lot, floor: r.floor, cap: r.cap, minInvestment: r.min_investment, floorInvestment,
      bandPct: bandPct === null ? null : Number(bandPct.toFixed(1)), lot_source: r.lot_source, cap_source: r.cap_source,
      capMayBeWrong: capSuspect,
    };
  };
  out.newlyRefused = rows.filter((r) => newRefuses(r) && !oldRefuses(r)).map(describe);
  out.noLongerRefused = rows.filter((r) => oldRefuses(r) && !newRefuses(r)).map(describe);
  out.stillRefused = rows.filter((r) => oldRefuses(r) && newRefuses(r)).map(describe);
  out.segmentDisagreements = rows.filter((r) => r.segment && r.segment !== inferSegment(r)).map(describe);
  out.noSegmentRows = rows.filter((r) => !r.segment).map(describe);
} finally {
  await pool.end();
}
fs.writeFileSync(path.join(HERE, 'lot-economics-rule9-spec.out.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`database: ${out.database}; rows with lot+cap: ${out.rowsWithLotAndCap}; no segment: ${out.noSegment}; FIXED_PRICE: ${out.fixedPrice}`);
console.log(`old rule refuses: ${out.oldRefuses}; new rule refuses: ${out.newRefuses}`);
const line = (r) =>
  `  ${r.slug} ${r.status} seg=${r.segment ?? `(none, inferred ${r.inferredSegment})`} ${r.issue_type ?? '-'} ${r.offering_type} ex=${JSON.stringify(r.listing_exchanges)} lot ${r.lot} x cap ${r.cap} = ${r.minInvestment} (floor ${r.floor}, band ${r.bandPct}%) lot<-${r.lot_source} cap<-${r.cap_source}${r.capMayBeWrong ? '  CAP-MAY-BE-WRONG' : ''}`;
for (const [k, label] of [['newlyRefused', 'NEWLY refused'], ['noLongerRefused', 'NO LONGER refused'], ['stillRefused', 'still refused'], ['segmentDisagreements', 'sourced segment disagrees with inference'], ['noSegmentRows', 'no segment']]) {
  console.log(`${label}: ${out[k].length}`);
  for (const r of out[k]) console.log(line(r));
}
