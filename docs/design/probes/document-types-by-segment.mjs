#!/usr/bin/env node
// docs/design/probes/document-types-by-segment.mjs — F-91's evidence.
//
// WHY. §0.0's SME document-order claim ("zero PRICE_BAND_AD, one DRHP, dominated by PROSPECTUS
// (64)") cites no query, no file:line and no .out.json — grep for PRICE_BAND_AD across every probe
// output before this one returns nothing. This probe IS that query: the full segment x
// document_type matrix, read once from production, so the claim can be checked rather than trusted.
//
// It also reconciles against document-store-size.out.json's PRICE_BAND_AD: 13 (all-IPO, active-only)
// figure, because the two numbers disagree on their face (mainboard 12 + SME 0 = 12, not 13) and F-91
// asks explicitly which population each one counts.
//
// Read-only against production. Nothing runs on the VPS.

import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

// The tunnel was verified up this session; still retry per the _lib.mjs convention (an unreachable
// source is a result, never an invented one) — shorter-spaced than fetchWithRetry's 2 minutes
// because this is a local SSH tunnel to a DB, not a remote scrape target.
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
  saveOutput('document-types-by-segment', {
    probe: 'document-types-by-segment', generated_at: nowStamp(), finding: 'F-91',
    unreachable: `unreachable on 2026-09-09 — ${err.message}`,
  });
  console.error('document-types-by-segment: tunnel unreachable after retries —', err.message);
  process.exit(2);
}

try {
  // The full matrix: every document row (active or not), joined to its IPO's segment.
  // segment is nullable (RIGHTS/InvITs/REITs carry no MAINBOARD/SME segment) — counted under 'NULL'.
  const allRows = (await pool.query(`
    select coalesce(i.segment::text, 'NULL') as segment,
           d.type::text                       as doc_type,
           count(*)                           as documents,
           count(distinct d.ipo_id)           as distinct_ipos
      from documents d
      join ipos i on i.id = d.ipo_id
     group by 1, 2
     order by 1, 2`)).rows;

  // Same matrix restricted to documents that still have a stored file (is_active) — the population
  // document-store-size.mjs counts.
  const activeRows = (await pool.query(`
    select coalesce(i.segment::text, 'NULL') as segment,
           d.type::text                       as doc_type,
           count(*)                           as documents,
           count(distinct d.ipo_id)           as distinct_ipos
      from documents d
      join ipos i on i.id = d.ipo_id
     where d.is_active
     group by 1, 2
     order by 1, 2`)).rows;

  const totalsBySegment = async (activeOnly) => (await pool.query(`
    select coalesce(i.segment::text, 'NULL') as segment,
           count(*) as documents,
           count(distinct d.ipo_id) as distinct_ipos
      from documents d
      join ipos i on i.id = d.ipo_id
     ${activeOnly ? 'where d.is_active' : ''}
     group by 1 order by 1`)).rows;

  const ipoCountBySegment = (await pool.query(`
    select coalesce(segment::text, 'NULL') as segment, count(*) as ipos
      from ipos group by 1 order by 1`)).rows;

  const toNum = (rows) => rows.map((r) => ({ ...r, documents: Number(r.documents), distinct_ipos: Number(r.distinct_ipos) }));
  const allMatrix = toNum(allRows);
  const activeMatrix = toNum(activeRows);
  const allTotals = toNum(await totalsBySegment(false));
  const activeTotals = toNum(await totalsBySegment(true));

  const cell = (matrix, segment, docType) => {
    const r = matrix.find((x) => x.segment === segment && x.doc_type === docType);
    return r ? r.documents : 0;
  };

  // The specific claim under review, per population.
  const claim = {
    mainboard_price_band_ad: { all: cell(allMatrix, 'MAINBOARD', 'PRICE_BAND_AD'), active: cell(activeMatrix, 'MAINBOARD', 'PRICE_BAND_AD') },
    sme_price_band_ad:       { all: cell(allMatrix, 'SME', 'PRICE_BAND_AD'),       active: cell(activeMatrix, 'SME', 'PRICE_BAND_AD') },
    mainboard_drhp:          { all: cell(allMatrix, 'MAINBOARD', 'DRHP'),          active: cell(activeMatrix, 'MAINBOARD', 'DRHP') },
    sme_drhp:                { all: cell(allMatrix, 'SME', 'DRHP'),                active: cell(activeMatrix, 'SME', 'DRHP') },
    sme_prospectus:          { all: cell(allMatrix, 'SME', 'PROSPECTUS'),          active: cell(activeMatrix, 'SME', 'PROSPECTUS') },
    mainboard_prospectus:    { all: cell(allMatrix, 'MAINBOARD', 'PROSPECTUS'),    active: cell(activeMatrix, 'MAINBOARD', 'PROSPECTUS') },
  };

  // document-store-size.out.json's figures, read fresh so the reconciliation is against the actual
  // file, not a number typed into this probe from memory.
  let storeFig = null;
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const store = JSON.parse(fs.readFileSync(path.join(HERE, 'document-store-size.out.json'), 'utf8'));
    const priceBandAd = store.by_type.find((t) => t.type === 'PRICE_BAND_AD');
    storeFig = { source: 'document-store-size.out.json', population: 'active-only, all segments', price_band_ad_documents: priceBandAd ? priceBandAd.documents : 0 };
  } catch (err) {
    storeFig = { source: 'document-store-size.out.json', error: `could not read: ${err.message}` };
  }

  const priceBandAdTotalActive = claim.mainboard_price_band_ad.active + claim.sme_price_band_ad.active;
  const priceBandAdTotalAll = claim.mainboard_price_band_ad.all + claim.sme_price_band_ad.all;

  const reconciliation = {
    design_claim: 'SME PRICE_BAND_AD = 0, MAINBOARD PRICE_BAND_AD = 12 (sum = 12)',
    document_store_size_figure: storeFig.price_band_ad_documents,
    this_probe_active_only_sum: priceBandAdTotalActive,
    this_probe_all_rows_sum: priceBandAdTotalAll,
    matches_active_only: priceBandAdTotalActive === storeFig.price_band_ad_documents,
    matches_all_rows: priceBandAdTotalAll === storeFig.price_band_ad_documents,
    verdict: priceBandAdTotalActive === storeFig.price_band_ad_documents
      ? 'RECONCILES against document-store-size on the active-only population.'
      : priceBandAdTotalAll === storeFig.price_band_ad_documents
        ? 'RECONCILES against document-store-size on the all-rows (including inactive/superseded) population.'
        : `DOES NOT RECONCILE against either population: document-store-size reports ${storeFig.price_band_ad_documents}, ` +
          `this probe finds ${priceBandAdTotalActive} active-only and ${priceBandAdTotalAll} across all rows for MAINBOARD+SME. ` +
          `The design's claim (mainboard 12 + SME 0 = 12) is not what production holds under either reading.`,
  };

  const smeOrderVerdict = claim.sme_price_band_ad.all === 0 && claim.sme_price_band_ad.active === 0
    ? 'HOLDS: SME has zero PRICE_BAND_AD documents under both readings.'
    : `FALSE: SME has ${claim.sme_price_band_ad.all} PRICE_BAND_AD documents (all rows) / ${claim.sme_price_band_ad.active} (active only) — not zero.`;

  const smeDrhpVerdict = claim.sme_drhp.all === 1
    ? 'HOLDS (all rows): SME has exactly 1 DRHP document.'
    : `Design says 1; production (all rows) shows ${claim.sme_drhp.all}, (active only) shows ${claim.sme_drhp.active}.`;

  const smeProspectusVerdict = claim.sme_prospectus.all === 64
    ? 'HOLDS (all rows): SME has exactly 64 PROSPECTUS documents.'
    : `Design says 64; production (all rows) shows ${claim.sme_prospectus.all}, (active only) shows ${claim.sme_prospectus.active}.`;

  const out = {
    probe: 'document-types-by-segment',
    generated_at: nowStamp(),
    source: 'production, documents JOIN ipos ON documents.ipo_id = ipos.id (read-only tunnel)',
    finding: 'F-91',
    ipo_count_by_segment: ipoCountBySegment.map((r) => ({ segment: r.segment, ipos: Number(r.ipos) })),
    totals_by_segment: { all_rows: allTotals, active_only: activeTotals },
    matrix_all_rows: allMatrix,
    matrix_active_only: activeMatrix,
    claim_check: claim,
    reconciliation_against_document_store_size: reconciliation,
    verdicts: {
      sme_zero_price_band_ad: smeOrderVerdict,
      sme_one_drhp: smeDrhpVerdict,
      sme_64_prospectus: smeProspectusVerdict,
    },
  };
  saveOutput('document-types-by-segment', out);

  console.log('IPOs by segment: ' + JSON.stringify(out.ipo_count_by_segment));
  console.log('MAINBOARD PRICE_BAND_AD: all=' + claim.mainboard_price_band_ad.all + ' active=' + claim.mainboard_price_band_ad.active);
  console.log('SME PRICE_BAND_AD: all=' + claim.sme_price_band_ad.all + ' active=' + claim.sme_price_band_ad.active);
  console.log('SME DRHP: all=' + claim.sme_drhp.all + ' active=' + claim.sme_drhp.active);
  console.log('SME PROSPECTUS: all=' + claim.sme_prospectus.all + ' active=' + claim.sme_prospectus.active);
  console.log('MAINBOARD DRHP: all=' + claim.mainboard_drhp.all + ' active=' + claim.mainboard_drhp.active);
  console.log('reconciliation: ' + reconciliation.verdict);
  console.log('sme_zero_price_band_ad: ' + smeOrderVerdict);
  console.log('sme_one_drhp: ' + smeDrhpVerdict);
  console.log('sme_64_prospectus: ' + smeProspectusVerdict);
  console.log('written: document-types-by-segment.out.json');
} catch (err) {
  console.error('document-types-by-segment: the probe itself failed —', err.message);
  process.exitCode = 2;
} finally {
  await pool.end();
}
