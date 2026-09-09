#!/usr/bin/env node
// docs/design/probes/pick-walkthrough-ipos.mjs
//
// WHY. The design is walked end-to-end against REAL IPOs. The mainboard one is named by the contract
// (Asset Reconstruction Company (India) Ltd, which opened on 2026-09-09). The SME one is defined by a
// measurement — "the OPEN or UPCOMING SME IPO with the most documents on disk on production" —
// precisely so that nobody, including me, gets to pick the one that makes the walkthrough look good.
//
// 2026-09-09, second pass. Two walkthroughs of tidy IPOs do not test the awkward rules, so this
// picker also selects FOUR MORE by query — never by taste — one for each shape the first two miss:
//
//   corrigendum  : the IPO that has a CORRIGENDUM document (§2.5.5 rules 1-3)
//   fixed price  : the SME issue quoted at a single price, floor = cap (§1.11 SME-on-BSE, field 34)
//   renamed      : a company carrying two names across its filings (§2.3.3.2 binding order)
//   FPO          : offering_type = 'FPO' (§1.11 FPO row, which already says "0 today")
//
// Each block states its rule, ranks EVERY candidate the rule admits, and records the count. Where no
// production row satisfies the rule the block records `no real IPO reachable, rule untested` and the
// walkthrough says the rule is untested — an empty result is an honest answer, not a failure.
//
// Read-only against production. Saves the row and the document inventory for every chosen IPO.
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

  // -------------------------------------------------------------------------------------------
  // The four awkward shapes. Each is a QUERY, so the choice is reproducible and nobody picks the
  // flattering case. `pick` returns the ranked list and the winner; an empty list is a result.
  // -------------------------------------------------------------------------------------------
  const pick = async (rule, sql) => {
    const ranked = (await pool.query(sql)).rows;
    const chosen = ranked[0] || null;
    const id = chosen ? (await pool.query('select id from ipos where slug = $1', [chosen.slug])).rows[0].id : null;
    return {
      rule,
      candidates_considered: ranked.length,
      ranked,
      chosen: chosen ? chosen.slug : null,
      unreachable: chosen ? null : 'no real IPO reachable, rule untested',
      row: chosen ? (await pool.query(`select ${ipoCols} from ipos where slug = $1`, [chosen.slug])).rows[0] : null,
      documents: id ? await docsFor(id) : [],
    };
  };

  const docCount = `(select count(*) from documents dd where dd.ipo_id = i.id and dd.is_active)`;

  // 1. Corrigendum. Section 2.5.5 says a corrigendum amends the fields it names; the design asserts
  //    one exists on production. This verifies that rather than trusting it.
  const corrigendum = await pick(
    'every IPO with at least one active CORRIGENDUM document, most corrigenda first, then most documents',
    `select i.slug, i.company_name, i.status::text as status, i.segment::text as segment,
            count(*) filter (where d.type = 'CORRIGENDUM') as corrigenda,
            count(*) filter (where d.type = 'CORRIGENDUM' and d.filing_date is not null) as corrigenda_dated,
            ${docCount} as documents
       from ipos i join documents d on d.ipo_id = i.id and d.is_active
      group by i.id
     having count(*) filter (where d.type = 'CORRIGENDUM') > 0
      order by 5 desc, 7 desc, i.close_date desc nulls last`);

  // 2. Fixed-price SME. `ipo_details.issue_type` is the field that WOULD say FIXED_PRICE, so it is
  //    reported here rather than assumed: on production it is null for every one of these rows, and
  //    the only production signal for a fixed-price issue is that the band is a point, floor = cap.
  const fixedPriceSme = await pick(
    'SME issues quoted at a single price (price_range_min = price_range_max, both non-null), ranked by documents on disk, then most recent close date',
    `select i.slug, i.company_name, i.status::text as status, i.price_range_min, i.price_range_max,
            i.lot_size, i.listing_exchanges, i.close_date,
            (select d.issue_type from ipo_details d where d.ipo_id = i.id) as stored_issue_type,
            ${docCount} as documents
       from ipos i
      where i.segment = 'SME' and i.price_range_min is not null
        and i.price_range_min = i.price_range_max
      order by ${docCount} desc, i.close_date desc nulls last`);

  // 3. Renamed / two-named company. Section 2.3.3.2 owes "a REAL rename pair, not a synthetic one: a
  //    company whose draft and its RHP carry different names, found by probe over `documents` and
  //    `ipos`". Two queries, because the first comes back empty and that emptiness is the answer:
  //      3a. the draft-vs-filing rename the design asked for, comparing the DRHP title against
  //          ipos.company_name once both are folded to significant words;
  //      3b. the pair production actually holds — two rows carrying ONE CIN under two names, the
  //          same problem (one company, two names, split filings) reached from the other side.
  const NOISE = "(limited|ltd|private|pvt|company|co|corporation|corp|incorporated|inc|india|indian|and|the|of|drhp|rhp|udrhp|prospectus|draft|red|herring)";
  const fold = (expr) => `btrim(regexp_replace(regexp_replace(lower(regexp_replace(${expr}, '[^a-zA-Z0-9]+', ' ', 'g')), '\\y${NOISE}\\y', ' ', 'g'), '\\s+', ' ', 'g'))`;

  const renameByDocument = await pick(
    'IPOs whose DRHP title, folded to significant words, differs from ipos.company_name folded the same way — the draft-vs-filing rename section 2.3.3.2 asks for',
    `select i.slug, i.company_name, d.title as drhp_title,
            ${fold('i.company_name')} as name_key,
            ${fold('d.title')} as title_key,
            ${docCount} as documents
       from ipos i join documents d on d.ipo_id = i.id and d.is_active and d.type = 'DRHP'
      where ${fold('i.company_name')} <> ${fold('d.title')}
        and length(${fold('d.title')}) > 0
      order by ${docCount} desc, i.close_date desc nulls last`);

  const renameByCin = await pick(
    'IPOs sharing one CIN with another row that carries a DIFFERENT company_name — one company, two names, two rows; the row with the exchange documents first',
    `with dup as (
        select cin from ipos
         where cin is not null
         group by cin
        having count(*) > 1 and count(distinct company_name) > 1)
     select i.slug, i.company_name, i.cin, i.symbol, i.status::text as status,
            i.issue_size, i.price_range_min, i.price_range_max, i.open_date::text as open_date,
            (select string_agg(distinct x.company_name, ' || ') from ipos x where x.cin = i.cin) as all_names_for_this_cin,
            ${docCount} as documents
       from ipos i join dup on dup.cin = i.cin
      order by ${docCount} desc, i.created_at`);

  // 4. FPO. Section 1.11 already says "0 today"; this re-measures it rather than quoting it.
  const fpo = await pick(
    "offering_type = 'FPO', ranked by documents on disk",
    `select i.slug, i.company_name, i.status::text as status, i.segment::text as segment,
            ${docCount} as documents
       from ipos i where i.offering_type = 'FPO'
      order by ${docCount} desc, i.close_date desc nulls last`);

  // What the FPO rule would need if a row ever arrived. Section 2.3.3.2 routes an IPO -> FPO change
  // to a "new row, linked by company_id"; this checks whether that column exists at all.
  const fpoPrerequisites = {
    ipos_rows_with_offering_type_fpo: fpo.candidates_considered,
    offering_types_present: (await pool.query(
      `select offering_type::text as t, count(*)::int as n from ipos group by 1 order by 2 desc`)).rows,
    company_id_column_exists: (await pool.query(
      `select count(*)::int as n from information_schema.columns where column_name = 'company_id'`)).rows[0].n > 0,
    companies_table_exists: (await pool.query(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('companies','company')`)).rows[0].n > 0,
  };

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
    corrigendum,
    fixed_price_sme: fixedPriceSme,
    renamed_by_document: renameByDocument,
    renamed_by_shared_cin: renameByCin,
    fpo,
    fpo_prerequisites: fpoPrerequisites,
  };

  const f = saveOutput('pick-walkthrough-ipos', out);
  console.log(`mainboard: ${out.mainboard.found ? out.mainboard.row.company_name : 'NOT FOUND'} ` +
    `(${out.mainboard.documents.length} documents)`);
  console.log(`SME candidates: ${smeCandidates.length}`);
  for (const r of out.sme.ranked.slice(0, 6)) {
    console.log(`  ${String(r.documents).padStart(3)} docs (${r.extracted} extracted, ${r.distinct_types} types)  ${r.status.padEnd(8)} ${r.slug}`);
  }
  console.log(`chosen SME: ${out.sme.chosen || 'NONE — no OPEN/UPCOMING SME IPO on production'}`);
  for (const [label, sel] of [['corrigendum', corrigendum], ['fixed-price SME', fixedPriceSme],
                              ['renamed (DRHP title)', renameByDocument],
                              ['renamed (shared CIN)', renameByCin], ['FPO', fpo]]) {
    console.log(`${label.padEnd(22)} ${String(sel.candidates_considered).padStart(3)} candidate(s) -> ${sel.chosen || sel.unreachable}`);
  }
  console.log(`FPO prerequisites: company_id column ${fpoPrerequisites.company_id_column_exists ? 'EXISTS' : 'DOES NOT EXIST'}, ` +
    `companies table ${fpoPrerequisites.companies_table_exists ? 'EXISTS' : 'DOES NOT EXIST'}`);
  console.log(`written: ${f}`);
} finally {
  await pool.end();
}
