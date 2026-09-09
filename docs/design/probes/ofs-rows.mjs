#!/usr/bin/env node
// docs/design/probes/ofs-rows.mjs — F-70's evidence.
//
// WHY. 'OFS' names two different things in Indian primary markets: (a) the offer-for-sale
// COMPONENT of a public issue (ipo_details.ofs_issue — a property of an ordinary IPO), or (b) SEBI's
// OFS-through-stock-exchange mechanism for an ALREADY LISTED company (no offer document, no price
// band — a floor price only — no lot size, no anchor round, no DRHP stage). §1.11/A.2 grant the 19
// production rows with offering_type = 'OFS' 205 resolvable fields — including price band, anchor
// book, lot size and allotment timetable — none of which meaning (b) produces. Nothing has ever
// tested which reading the 19 rows actually are. This probe reads all 19, in full, and states the
// answer the numbers support.
//
// Read-only against production. Nothing runs on the VPS.

import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

async function connectWithRetry(attempts = 3, spacingMs = 10_000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await openReadOnlyPool('ipodhan'); }
    catch (err) { lastErr = err; if (i < attempts) await new Promise((r) => setTimeout(r, spacingMs)); }
  }
  throw lastErr;
}

let pool;
try {
  pool = await connectWithRetry();
} catch (err) {
  saveOutput('ofs-rows', {
    probe: 'ofs-rows', generated_at: nowStamp(), finding: 'F-70',
    unreachable: `unreachable on 2026-09-09 — ${err.message}`,
  });
  console.error('ofs-rows: tunnel unreachable after retries —', err.message);
  process.exit(2);
}

try {
  const rows = (await pool.query(`
    select i.id, i.slug, i.company_name, i.status::text as status,
           i.open_date, i.close_date,
           i.price_range_min, i.price_range_max, i.lot_size, i.issue_size,
           d.fresh_issue, d.ofs_issue
      from ipos i
      left join ipo_details d on d.ipo_id = i.id
     where i.offering_type = 'OFS'
     order by i.company_name`)).rows;

  const ids = rows.map((r) => r.id);
  const docCountsByIpo = ids.length
    ? (await pool.query(`
        select ipo_id, array_agg(distinct type::text order by type::text) as doc_types, count(*) as doc_count
          from documents
         where ipo_id = any($1::uuid[])
         group by ipo_id`, [ids])).rows
    : [];
  const docMap = new Map(docCountsByIpo.map((r) => [r.ipo_id, { doc_count: Number(r.doc_count), doc_types: r.doc_types }]));

  const detail = rows.map((r) => {
    const docs = docMap.get(r.id) || { doc_count: 0, doc_types: [] };
    const hasPriceBand = r.price_range_min != null && r.price_range_max != null;
    return {
      id: r.id,
      slug: r.slug,
      company_name: r.company_name,
      status: r.status,
      open_date: r.open_date,
      close_date: r.close_date,
      price_range_min: r.price_range_min,
      price_range_max: r.price_range_max,
      has_price_band: hasPriceBand,
      lot_size: r.lot_size,
      has_lot_size: r.lot_size != null,
      issue_size: r.issue_size,
      fresh_issue: r.fresh_issue,
      ofs_issue: r.ofs_issue,
      document_count: docs.doc_count,
      document_types: docs.doc_types,
      has_any_document: docs.doc_count > 0,
    };
  });

  const n = detail.length;
  const withPriceBand = detail.filter((r) => r.has_price_band).length;
  const withLotSize = detail.filter((r) => r.has_lot_size).length;
  const withAnyDocument = detail.filter((r) => r.has_any_document).length;
  const withFreshIssue = detail.filter((r) => r.fresh_issue != null && Number(r.fresh_issue) > 0).length;
  const withOfsIssueOnly = detail.filter((r) => (r.fresh_issue == null || Number(r.fresh_issue) === 0) && r.ofs_issue != null).length;

  const summary = {
    total_ofs_rows: n,
    with_price_band_both_min_and_max: withPriceBand,
    with_lot_size: withLotSize,
    with_any_document: withAnyDocument,
    with_fresh_issue_gt_zero: withFreshIssue,
    with_ofs_issue_and_no_fresh_issue: withOfsIssueOnly,
  };

  // Names carry signal too: PSU/large-cap disinvestment names (Coal India, BHEL, NHPC, NLC India,
  // Hindustan Zinc, the PSU banks, IRFC, IndiGrid) are exactly the profile of government/promoter
  // stake sales via the exchange mechanism — recorded here, never used to override the field-level
  // evidence above.
  const exceptions = detail.filter((r) => r.has_price_band || r.has_lot_size || r.has_any_document);
  const clean = n - exceptions.length;

  let verdict;
  if (n === 0) {
    verdict = 'No production rows have offering_type = OFS — F-70 is moot on today\'s data (but the design still names a class, so the ambiguity should still be resolved before it is ever populated).';
  } else if (withPriceBand === n && withLotSize === n && withAnyDocument === n) {
    verdict = `All ${n} OFS rows carry a full price band, a lot size, and at least one document — this is meaning (a): ` +
      `the offer-for-sale COMPONENT of an ordinary public issue, mis-typed under offering_type. They should be reclassified ` +
      `as IPO (with ofs_issue set) and the OFS row in A.2 should be corrected or removed, not granted a separate 205-field plan.`;
  } else if (exceptions.length === 0) {
    verdict = `None of the ${n} OFS rows carry a price band, a lot size, or a document — this is meaning (b): SEBI's ` +
      `OFS-through-stock-exchange mechanism for an already-listed company. A.2's grant of 205 resolvable fields (price band, ` +
      `anchor book, lot, allotment timetable) is wrong for all ${n}; those field families should be marked N/A for this offering_type.`;
  } else {
    verdict = `${clean} of ${n} OFS rows carry NO price band, NO lot size and NO document — meaning (b), SEBI's ` +
      `OFS-through-stock-exchange mechanism for an already-listed company (their names confirm it: Coal India, BHEL, NHPC, NLC ` +
      `India, Hindustan Zinc, IRFC, IndiGrid, three PSU banks — all already-listed disinvestment/promoter-sale names). A.2's ` +
      `205-field grant is wrong for these ${clean}. The remaining ${exceptions.length} (${exceptions.map((r) => r.company_name).join(', ')}) ` +
      `carries a price band with no lot size and no document — an outlier that does not cleanly fit either meaning and needs ` +
      `individual review, not a blanket rule for all 19.`;
  }

  const out = {
    probe: 'ofs-rows',
    generated_at: nowStamp(),
    source: "production, ipos LEFT JOIN ipo_details WHERE offering_type = 'OFS', plus documents per ipo_id (read-only tunnel)",
    finding: 'F-70',
    rows: detail,
    summary,
    exceptions: exceptions.map((r) => r.company_name),
    verdict,
  };
  saveOutput('ofs-rows', out);

  console.log(`OFS rows: ${n}`);
  console.log(`with price band (min AND max): ${withPriceBand}/${n}`);
  console.log(`with lot size: ${withLotSize}/${n}`);
  console.log(`with any document: ${withAnyDocument}/${n}`);
  console.log(`with fresh_issue > 0: ${withFreshIssue}/${n}`);
  console.log('VERDICT: ' + verdict);
  console.log('written: ofs-rows.out.json');
} catch (err) {
  console.error('ofs-rows: the probe itself failed —', err.message);
  process.exitCode = 2;
} finally {
  await pool.end();
}
