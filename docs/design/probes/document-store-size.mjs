#!/usr/bin/env node
// docs/design/probes/document-store-size.mjs — the number behind OD-23's retention policy.
//
// WHY. OD-23 keeps every offer document for the life of its IPO row and honours the 5 GB store
// ceiling (`DEFAULT_MAX_STORE_GB`, document-store.ts:46) by compressing rather than deleting. That
// policy is only responsible if somebody has checked whether it fits. This measures the store from
// the database's own `documents.file_size` — a read, rather than a `du` on a production box that
// serves live traffic.
//
// Read-only against production. Nothing runs on the VPS.

import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

const GB = 1024 ** 3;
const CEILING_GB = 5;   // DEFAULT_MAX_STORE_GB, scraper/src/services/document-store.ts:46

const pool = await openReadOnlyPool('ipodhan');
try {
  const totals = (await pool.query(`
    select count(*)                                      as documents,
           count(*) filter (where file_size is null)     as size_unknown,
           coalesce(sum(file_size), 0)                   as bytes,
           count(distinct ipo_id)                        as ipos_with_documents
      from documents where is_active`)).rows[0];

  const byType = (await pool.query(`
    select type::text as type, count(*) as documents,
           coalesce(sum(file_size), 0) as bytes,
           coalesce(round(avg(file_size)), 0) as avg_bytes
      from documents where is_active
     group by type order by sum(file_size) desc nulls last`)).rows;

  const ipoTotal = Number((await pool.query('select count(*) as n from ipos')).rows[0].n);

  // Per-IPO cost, measured on the IPOs that actually have documents — not on the whole table, which
  // would divide by 327 and flatter the projection.
  //
  // AND: 163 of 265 active rows carry no `file_size` at all. Summing the column and dividing by the
  // IPO count therefore understates the store by more than half, because two thirds of the documents
  // contribute zero bytes to the sum while occupying real disk. The honest figure is built from the
  // documents whose size IS known: mean known size x documents per IPO. A first version of this probe
  // reported 6.5 MB per IPO and "3.18 GB at 500 IPOs, FITS"; that number was arithmetic on missing
  // data, which is the same class of error as accepting a counter that cannot fall.
  const withDocs = Number(totals.ipos_with_documents);
  const bytes = Number(totals.bytes);
  const docs = Number(totals.documents);
  const known = docs - Number(totals.size_unknown);
  const meanKnown = known ? bytes / known : 0;
  const docsPerIpo = withDocs ? docs / withDocs : 0;
  const perIpoFloor = withDocs ? bytes / withDocs : 0;          // what the raw sum says (a floor)
  const perIpoEstimated = meanKnown * docsPerIpo;               // what it costs if the unsized rows are typical

  const project = (n) => ({
    ipos: n,
    gb_floor: Math.round((perIpoFloor * n / GB) * 100) / 100,
    gb_estimated: Math.round((perIpoEstimated * n / GB) * 100) / 100,
  });

  const out = {
    probe: 'document-store-size',
    generated_at: nowStamp(),
    source: 'production, documents.file_size (read-only tunnel). Rows with a null file_size are counted separately and excluded from the byte total, so the figure is a floor, not an estimate.',
    ceiling_gb: CEILING_GB,
    measured: {
      active_documents: Number(totals.documents),
      file_size_unknown: Number(totals.size_unknown),
      total_bytes: bytes,
      total_gb: Math.round((bytes / GB) * 100) / 100,
      ipos_with_documents: withDocs,
      ipos_total: ipoTotal,
      documents_with_known_size: known,
      mean_mb_per_known_document: Math.round((meanKnown / (1024 ** 2)) * 10) / 10,
      documents_per_ipo_with_documents: Math.round(docsPerIpo * 100) / 100,
      mb_per_ipo_floor: Math.round((perIpoFloor / (1024 ** 2)) * 10) / 10,
      mb_per_ipo_estimated: Math.round((perIpoEstimated / (1024 ** 2)) * 10) / 10,
    },
    by_type: byType.map((r) => ({ type: r.type, documents: Number(r.documents),
      gb: Math.round((Number(r.bytes) / GB) * 1000) / 1000,
      avg_mb: Math.round((Number(r.avg_bytes) / (1024 ** 2)) * 10) / 10 })),
    projection: {
      basis: 'average bytes per IPO that has documents today, times the IPO count. It assumes future ' +
             'IPOs carry a similar document set, which is the assumption OD-23 rests on.',
      at_today_ipo_count: project(ipoTotal),
      at_500_ipos: project(500),
      fits_under_ceiling_at_500_floor: (perIpoFloor * 500) / GB < CEILING_GB,
      fits_under_ceiling_at_500_estimated: (perIpoEstimated * 500) / GB < CEILING_GB,
      caveat: `${Number(totals.size_unknown)} of ${docs} active documents carry no file_size, so the ` +
              `floor figure counts them as zero bytes. The estimate assumes they are the same size as ` +
              `the ${known} rows whose size is known. Backfilling file_size is the way to replace both ` +
              `numbers with one measured number.`,
    },
  };
  saveOutput('document-store-size', out);

  console.log(`active documents: ${out.measured.active_documents} (${out.measured.file_size_unknown} with unknown size)`);
  console.log(`store today: ${out.measured.total_gb} GB summed across ${withDocs} IPOs, but ${out.measured.file_size_unknown} of ${docs} rows have no size recorded`);
  console.log(`per IPO: ${out.measured.mb_per_ipo_floor} MB (floor, unsized rows counted as zero) / ${out.measured.mb_per_ipo_estimated} MB (estimated)`);
  console.log(`projection at 500 IPOs: ${out.projection.at_500_ipos.gb_floor} GB floor, ${out.projection.at_500_ipos.gb_estimated} GB estimated (ceiling ${CEILING_GB} GB) -> ` +
    (out.projection.fits_under_ceiling_at_500_estimated ? 'FITS on the estimate' : 'EXCEEDS on the estimate — compression, or a higher ceiling, is required'));
  console.log('largest types: ' + out.by_type.slice(0, 4).map((t) => `${t.type} ${t.gb}GB`).join(', '));
  console.log('written: document-store-size.out.json');
} finally {
  await pool.end();
}
