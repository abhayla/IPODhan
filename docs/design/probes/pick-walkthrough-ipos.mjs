#!/usr/bin/env node
// docs/design/probes/pick-walkthrough-ipos.mjs
//
// WHY. The design is walked end-to-end against two REAL IPOs, one mainboard and one SME. The
// mainboard one is named by the contract (Asset Reconstruction Company (India) Ltd, which opened on
// 2026-09-09). The SME one is defined by a measurement — "the OPEN or UPCOMING SME IPO with the most
// documents on disk on production" — precisely so that nobody, including me, gets to pick the one
// that makes the walkthrough look good.
//
// Read-only against production. Saves the row and the document inventory for both.

import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

const MAINBOARD_SLUG = 'asset-reconstruction-company-india-ltd';

const pool = await openReadOnlyPool('ipodhan');
try {
  const ipoCols = `id, slug, company_name, symbol, status, segment, offering_type, open_date,
                   close_date, listing_date, listing_exchanges, issue_size, price_range_min,
                   price_range_max, lot_size, face_value, isin, registrar, sector`;

  const mainboard = (await pool.query(
    `select ${ipoCols} from ipos where slug = $1`, [MAINBOARD_SLUG])).rows;

  // Every OPEN/UPCOMING SME IPO, ranked by how many documents are actually on disk for it.
  const smeCandidates = (await pool.query(`
    select i.id, i.slug, i.company_name, i.status, i.segment, i.listing_exchanges,
           count(d.id)                                          as documents,
           count(*) filter (where d.extraction_status = 'COMPLETED') as extracted,
           count(distinct d.type)                               as distinct_types,
           array_agg(distinct d.type::text order by d.type::text) as types
      from ipos i
      left join documents d on d.ipo_id = i.id and d.is_active
     where i.segment = 'SME' and i.status in ('OPEN', 'UPCOMING')
     group by i.id
     order by count(d.id) desc, count(distinct d.type) desc, i.close_date desc nulls last`)).rows;

  const chosenSme = smeCandidates[0] || null;

  const docsFor = async (id) => (await pool.query(`
    select id, type::text as type, title, url, file_size, sha256, exchange,
           extraction_status::text as extraction_status, extracted_at, filing_date, uploaded_at
      from documents where ipo_id = $1 and is_active order by uploaded_at nulls last, id`, [id])).rows;

  const out = {
    probe: 'pick-walkthrough-ipos',
    generated_at: nowStamp(),
    slot: 'production (read-only tunnel, localhost:15432 -> 103.118.16.189)',
    mainboard: {
      requested_slug: MAINBOARD_SLUG,
      found: mainboard.length,
      row: mainboard[0] || null,
      documents: mainboard[0] ? await docsFor(mainboard[0].id) : [],
    },
    sme: {
      rule: 'the OPEN or UPCOMING SME IPO with the most active documents on production',
      candidates_considered: smeCandidates.length,
      ranked: smeCandidates.map((r) => ({
        slug: r.slug, company_name: r.company_name, status: r.status,
        documents: Number(r.documents), extracted: Number(r.extracted),
        distinct_types: Number(r.distinct_types), types: r.types,
      })),
      chosen: chosenSme ? chosenSme.slug : null,
      row: chosenSme ? (await pool.query(`select ${ipoCols} from ipos where id = $1`, [chosenSme.id])).rows[0] : null,
      documents: chosenSme ? await docsFor(chosenSme.id) : [],
    },
  };

  const f = saveOutput('pick-walkthrough-ipos', out);
  console.log(`mainboard: ${out.mainboard.found ? out.mainboard.row.company_name : 'NOT FOUND'} ` +
    `(${out.mainboard.documents.length} documents)`);
  console.log(`SME candidates: ${smeCandidates.length}`);
  for (const r of out.sme.ranked.slice(0, 6)) {
    console.log(`  ${String(r.documents).padStart(3)} docs (${r.extracted} extracted, ${r.distinct_types} types)  ${r.status.padEnd(8)} ${r.slug}`);
  }
  console.log(`chosen SME: ${out.sme.chosen || 'NONE — no OPEN/UPCOMING SME IPO on production'}`);
  console.log(`written: ${f}`);
} finally {
  await pool.end();
}
