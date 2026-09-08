import fs from 'fs';

// [table, column, class, [r1,r2,r3], opts]
// opts.doc = extraction-contract section; opts.only = why there is no rank 2;
// opts.e1 = named exception E-1; opts.formula = computed; opts.na = offering types where N/A
const D_FIN = { na: ['NCD', 'INVITS', 'REITS', 'TENDER', 'BUYBACK'] };
export const F = [];
const add = (t, c, cls, r, o = {}) => F.push({ t, c, cls, r, o });

// ---------- ipos (32) ----------
add('ipos','symbol','D',['DOC','NSE','BSE'],{doc:'E7 cover'});
add('ipos','company_name','D',['DOC','NSE','BSE'],{doc:'cover'});
add('ipos','issue_size','D',['DOC','BSE','CG'],{doc:'A5+A6'});
add('ipos','lot_size','D',['DOC','BSE','NSE'],{doc:'A3',na:['NCD','INVITS','REITS','TENDER','BUYBACK']});
add('ipos','open_date','T',['NSE','BSE','CG'],{e1:1});
add('ipos','close_date','T',['NSE','BSE','CG'],{e1:1});
add('ipos','listing_date','T',['NSE','BSE','CG'],{e1:1});
add('ipos','status','T',['NSE','BSE','CG'],{e1:1});
add('ipos','registrar','D',['DOC','BSE','CG'],{doc:'E3'});
add('ipos','registrar_id','C',['—','—','—'],{formula:'FK resolved from registrar'});
add('ipos','rating_override','I',['ADMIN','—','—'],{only:'admin-only by design; no external source exists'});
add('ipos','slug','C',['—','—','—'],{formula:'generateIPOSlug(company_name)'});
add('ipos','sector','D',['DOC','CG','MC'],{doc:'F1'});
add('ipos','price_range_min','D',['DOC','NSE','BSE'],{doc:'A1',na:['NCD','TENDER','BUYBACK']});
add('ipos','price_range_max','D',['DOC','NSE','BSE'],{doc:'A1',na:['NCD','TENDER','BUYBACK']});
add('ipos','last_scraped_at','I',['—','—','—'],{});
add('ipos','listing_exchanges','T',['NSE','BSE','CG'],{e1:1});
add('ipos','face_value','D',['DOC','BSE','NSE'],{doc:'A2',na:['INVITS','REITS']});
add('ipos','allotment_date','T',['NSE','BSE','CG'],{e1:1});
add('ipos','company_description','D',['DOC','CG','MC'],{doc:'F1'});
add('ipos','lead_managers','D',['DOC','BSE','CG'],{doc:'E1'});
add('ipos','isin','D',['DOC','NSE','BSE'],{doc:'E7'});
add('ipos','segment','D',['DOC','NSE','BSE'],{doc:'A15',na:['INVITS','REITS']});
add('ipos','offering_type','D',['DOC','BSE','CG'],{doc:'A11'});
add('ipos','scraper_locked','I',['ADMIN','—','—'],{only:'admin-only by design; no external source exists'});
add('ipos','last_manual_edit_at','I',['—','—','—'],{});
add('ipos','objectives','D',['DOC','CG','MC'],{doc:'F4',na:['OFS','RIGHTS','TENDER','BUYBACK']});
add('ipos','bse_ipo_no','I',['BSE','—','—'],{only:'BSE payload identifier'});
add('ipos','bse_payload_lead_manager_count','I',['BSE','—','—'],{only:'BSE payload cross-check only'});
add('ipos','company_website','D',['DOC','CG','—'],{doc:'E7'});
add('ipos','verifier_url','I',['—','—','—'],{});
add('ipos','cin','D',['DOC','—','—'],{doc:'E7',only:'no website or exchange publishes the CIN'});

// ---------- ipo_details (23) ----------
add('ipo_details','company_description','D',['DOC','CG','MC'],{doc:'F1'});
add('ipo_details','issue_type','D',['DOC','BSE','CG'],{doc:'A11'});
add('ipo_details','fresh_issue','D',['DOC','BSE','CG'],{doc:'A5',na:['OFS','TENDER','BUYBACK']});
add('ipo_details','ofs_issue','D',['DOC','BSE','CG'],{doc:'A6',na:['RIGHTS','NCD']});
add('ipo_details','face_value','D',['DOC','BSE','—'],{doc:'A2',na:['INVITS','REITS']});
add('ipo_details','basis_of_allotment_date','T',['NSE','BSE','CG'],{e1:1});
add('ipo_details','initiation_of_refunds_date','T',['NSE','BSE','CG'],{e1:1});
add('ipo_details','credit_of_shares_date','T',['NSE','BSE','CG'],{e1:1});
add('ipo_details','exchanges','D',['DOC','NSE','BSE'],{doc:'A15'});
add('ipo_details','data_source','I',['—','—','—'],{});
add('ipo_details','last_verified_at','I',['—','—','—'],{});
add('ipo_details','compliance_officer','D',['DOC','—','—'],{doc:'E4',only:'named only in the filing'});
add('ipo_details','compliance_officer_phone','D',['DOC','—','—'],{doc:'E4',only:'named only in the filing'});
add('ipo_details','compliance_officer_email','D',['DOC','—','—'],{doc:'E4',only:'named only in the filing'});
add('ipo_details','upi_cutoff_time','D',['DOC','NSE','—'],{doc:'B7',note:'clock time, not a date — deliberately NOT in E-1'});
add('ipo_details','designated_exchange','D',['DOC','NSE','BSE'],{doc:'A14'});
add('ipo_details','lot_multiple','D',['DOC','BSE','—'],{doc:'A3'});
add('ipo_details','allocation_pct','D',['DOC','NSE','—'],{doc:'A13'});
add('ipo_details','pre_ipo_placement','D',['DOC','—','—'],{doc:'D6',only:'disclosure exists only in the filing',na:['RIGHTS','OFS','NCD','TENDER','BUYBACK']});
add('ipo_details','bid_windows','D',['DOC','NSE','—'],{doc:'B8',note:'clock windows, not dates — deliberately NOT in E-1'});
add('ipo_details','promoter_shares_held','D',['DOC','—','—'],{doc:'D2',only:'capital-structure table only',na:['INVITS','REITS','NCD']});
add('ipo_details','sebi_regulation_cited','D',['DOC','—','—'],{doc:'A12',only:'printed only on the advertisement'});
add('ipo_details','promoter_group_transactions_since_drhp','D',['DOC','—','—'],{doc:'D7',only:'disclosure exists only in the filing',na:['RIGHTS','OFS','NCD','INVITS','REITS','TENDER','BUYBACK']});

// ---------- financial_data (26) ----------
for (const y of ['2022','2023','2024']) add('financial_data',`revenue_fy${y}`,'D',['DOC','CG','MC'],{doc:'C1',...D_FIN});
for (const y of ['2022','2023','2024']) add('financial_data',`profit_fy${y}`,'D',['DOC','CG','MC'],{doc:'C1',...D_FIN});
for (const [c,d] of [['net_worth','C2'],['pe_ratio','A9'],['eps','C6'],['roe','—'],['debt_to_equity','—'],
  ['reserves_and_surplus','C2'],['total_assets','C2'],['total_borrowing','C2'],
  ['promoter_holding_pre_issue','D8'],['promoter_holding_post_issue','D8'],['market_cap','A8'],
  ['pre_ipo_eps','C6'],['post_ipo_eps','C6'],['ronw','A10']])
  add('financial_data',c,'D',['DOC','CG','MC'],{doc:d,...D_FIN});
for (const y of ['2022','2023','2024']) add('financial_data',`ebitda_fy${y}`,'D',['DOC','CG','MC'],{doc:'C1',...D_FIN});
for (const y of ['2022','2023','2024']) add('financial_data',`total_income_fy${y}`,'D',['DOC','CG','MC'],{doc:'C1',...D_FIN});

// ---------- financial_statements (11) ----------
// Chittorgarh's detail page DOES carry a restated per-fiscal-year "Company Financials" table
// (scraper/src/scrapers/chittorgarh-detail-fields.ts, getTableById 'financialTable'): it yields
// revenue, total income, EBITDA, PAT per year plus the fiscal years themselves, and net worth as a
// single most-recent value. An earlier draft of this appendix claimed "no website publishes a
// restated statement" - that was wrong, and our own scraper disproves it.
const FS_NA = ['INVITS','REITS','TENDER','BUYBACK'];
for (const [c,d] of [['fiscal_year','C1'],['revenue','C1'],['total_income','C1'],['ebitda','C1'],['pat','C1']])
  add('financial_statements',c,'D',['DOC','CG','MC'],{doc:d,na:FS_NA,note:'CG restated table carries this per fiscal year'});
add('financial_statements','net_worth','D',['DOC','CG','MC'],{doc:'C2',na:FS_NA,note:'CG gives the most-recent year only, not the full series'});
for (const [c,d] of [['basis','C8'],['unit','C7'],['eps_basic','C6'],['eps_diluted','C6'],['op_cash_flow','C3']])
  add('financial_statements',c,'D',['DOC','—','—'],{doc:d,only:'CG prints a single pre/post-issue EPS pair and no basis/unit/cash-flow line; the per-fiscal-year basic-vs-diluted split exists only in the restated statement',na:FS_NA});

// ---------- ipo_valuation (17) ----------
const VAL_NA = ['RIGHTS','OFS','NCD','INVITS','REITS','TENDER','BUYBACK'];
// The price band itself is published by both exchanges and by CG - it is the same number as
// ipos.price_range_min/max, so it gets the same ranks. Market cap at the cap price is the single
// "market cap" CG prints. Everything else in this table (shares at a price point, PE at floor vs
// cap, the weighted 3-year RoNW) appears nowhere but the advertisement.
add('ipo_valuation','price_floor','D',['DOC','NSE','BSE'],{doc:'A1',na:VAL_NA,note:'same number as ipos.price_range_min'});
add('ipo_valuation','price_cap','D',['DOC','NSE','BSE'],{doc:'A1',na:VAL_NA,note:'same number as ipos.price_range_max'});
add('ipo_valuation','mcap_at_cap','D',['DOC','CG','MC'],{doc:'A8',na:VAL_NA,note:'CG prints a single market cap, which is the at-cap figure'});
add('ipo_valuation','pe_at_cap','D',['DOC','CG','MC'],{doc:'A9',na:VAL_NA,note:'CG prints a single post-issue P/E, which is the at-cap figure (same logic as mcap_at_cap)'});
add('ipo_valuation','mcap_at_floor','D',['DOC','—','—'],{doc:'A8',only:'CG prints only ONE market cap (the at-cap one); no website prints the value at the floor price',na:VAL_NA});
add('ipo_valuation','pe_at_floor','D',['DOC','—','—'],{doc:'A9',only:'CG prints only ONE P/E (post-issue, at cap); no website prints the value at the floor price',na:VAL_NA});
add('ipo_valuation','ronw_weighted_3y','D',['DOC','—','—'],{doc:'A10',only:'CG prints a single-year RoNW; the 3-year WEIGHTED average is a different metric and appears only in the advertisement',na:VAL_NA});
add('ipo_valuation','pricing_event','I',['DOC','—','—'],{doc:'—',only:'not a sourced value - it records WHICH document produced the row (PRICE_BAND_AD vs PROSPECTUS)',na:VAL_NA});
for (const [c,d] of [['shares_at_floor','A7'],['shares_at_cap','A7'],['fresh_shares_at_floor','A7'],
  ['fresh_shares_at_cap','A7'],['ofs_shares','A7'],['total_shares_at_floor','A7'],['total_shares_at_cap','A7']])
  add('ipo_valuation',c,'D',['DOC','—','—'],{doc:d,only:'a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap',na:VAL_NA});
add('ipo_valuation','face_value_multiple_floor','C',['—','—','—'],{formula:'price_floor ÷ face_value'});
add('ipo_valuation','face_value_multiple_cap','C',['—','—','—'],{formula:'price_cap ÷ face_value'});

// ---------- promoters (3), intermediaries (2), risk factors (2), brlm (4) ----------
const PROM_NA = ['INVITS','REITS','NCD','TENDER','BUYBACK'];
add('promoters','name','D',['DOC','—','—'],{doc:'D1',only:'capital-structure table only',na:PROM_NA});
add('promoters','waca','D',['DOC','—','—'],{doc:'D3',only:'basis-for-offer-price table only',na:PROM_NA});
add('promoters','is_promoter_group','D',['DOC','—','—'],{doc:'D1',only:'capital-structure table only',na:PROM_NA});
add('ipo_intermediaries','role','D',['DOC','BSE','—'],{doc:'E1–E6'});
add('ipo_intermediaries','name','D',['DOC','BSE','CG'],{doc:'E1–E6'});
add('ipo_risk_factors','seq','D',['DOC','—','—'],{doc:'F2',only:'risk factors exist only in the filing',na:['TENDER','BUYBACK']});
add('ipo_risk_factors','heading','D',['DOC','—','—'],{doc:'F2',only:'risk factors exist only in the filing',na:['TENDER','BUYBACK']});
const BRLM_NA = ['RIGHTS','OFS','NCD','INVITS','REITS','TENDER','BUYBACK'];
add('brlm_track_record','brlm_name','D',['DOC','—','—'],{doc:'E2',only:'only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank',na:BRLM_NA});
add('brlm_track_record','as_of_date','D',['DOC','—','—'],{doc:'E2',only:'historical, never moves',na:BRLM_NA});
add('brlm_track_record','issues_3y','D',['DOC','—','—'],{doc:'E2',only:'only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank',na:BRLM_NA});
add('brlm_track_record','closed_below_issue_price','D',['DOC','—','—'],{doc:'E2',only:'only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank',na:BRLM_NA});

// ---------- peer_companies (10) ----------
for (const c of ['company_name','is_listed','pe_ratio','eps','diluted_eps','ronw','nav','pbv_ratio'])
  add('peer_companies',c,'D',['DOC','CG','—'],{doc:'C9',na:['NCD','INVITS','REITS','TENDER','BUYBACK']});
add('peer_companies','data_source','I',['—','—','—'],{});
add('peer_companies','last_updated','I',['—','—','—'],{});

// ---------- anchor_investors (7) ----------
const ANCH_NA = ['RIGHTS','OFS','NCD','TENDER','BUYBACK'];
add('anchor_investors','bid_date','T',['NSE','BSE','CG'],{e1:1,na:ANCH_NA});
for (const c of ['total_shares_offered','total_amount_raised','anchor_investors_count','investor_list'])
  add('anchor_investors',c,'D',['DOC','—','—'],{doc:'anchor report',only:'the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book',na:ANCH_NA});
add('anchor_investors','lock_in_50_percent_date','T',['NSE','BSE','CG'],{e1:1,na:ANCH_NA});
add('anchor_investors','lock_in_remaining_date','T',['NSE','BSE','CG'],{e1:1,na:ANCH_NA});

// ---------- documents (15) ----------
for (const c of ['type','title','url','file_size','uploaded_at','exchange','media_type','sequence_number',
  'is_active','extraction_status','extracted_at','extraction_error','retry_count','sha256'])
  add('documents',c,'I',['—','—','—'],{});
add('documents','filing_date','D',['DOC','BSE','—'],{doc:'B9',note:'historical — never moves; the doc-type healing rule depends on it'});

// ---------- subscriptions (11) ----------
add('subscriptions','timestamp','I',['—','—','—'],{});
for (const c of ['qib_subscription','nii_subscription','retail_subscription','total_subscription'])
  add('subscriptions',c,'X',['NSE','BSE','CG'],{only:'no document can carry a live figure',na:['TENDER','BUYBACK']});
for (const c of ['employee_subscription','b_nii_subscription','s_nii_subscription','total_shares_bid','shares_offered'])
  add('subscriptions',c,'X',['NSE','BSE','—'],{only:'no document can carry a live figure',na:['TENDER','BUYBACK']});
add('subscriptions','scope','I',['—','—','—'],{});

// ---------- gmp_records (4) ----------
add('gmp_records','timestamp','I',['—','—','—'],{});
add('gmp_records','gmp','W',['IG','CG','—'],{only:'grey market has no official source, ever'});
add('gmp_records','source','I',['—','—','—'],{});
add('gmp_records','gmp_percentage','C',['—','—','—'],{formula:'gmp ÷ price_range_max × 100'});

// ---------- listing_performance (12) ----------
add('listing_performance','listing_price','M',['NSE','BSE','CG'],{only:'post-listing market data'});
add('listing_performance','issue_price','C',['—','—','—'],{formula:'ipos.price_range_max at listing'});
add('listing_performance','listing_gain_percent','C',['—','—','—'],{formula:'(listing − issue) ÷ issue × 100'});
add('listing_performance','current_price','M',['NSE','BSE','CG'],{only:'post-listing market data'});
add('listing_performance','current_gain_percent','C',['—','—','—'],{formula:'(current − issue) ÷ issue × 100'});
add('listing_performance','last_updated','I',['—','—','—'],{});
add('listing_performance','current_price_bse','M',['BSE','—','—'],{only:'BSE quote by definition',exchOnly:'BSE'});
add('listing_performance','current_price_nse','M',['NSE','—','—'],{only:'NSE quote by definition',exchOnly:'NSE'});
add('listing_performance','symbol','C',['—','—','—'],{formula:'copy of ipos.symbol'});
add('listing_performance','company_name','C',['—','—','—'],{formula:'copy of ipos.company_name'});
add('listing_performance','listing_date','C',['—','—','—'],{formula:'copy of ipos.listing_date (E-1 sourced)'});
add('listing_performance','data_source','I',['—','—','—'],{});

// ---------- ipo_demand_graph (5) ----------
add('ipo_demand_graph','timestamp','I',['—','—','—'],{});
for (const c of ['price_point','is_cut_off','cumulative_quantity','exchange'])
  add('ipo_demand_graph',c,'X',['NSE','BSE','—'],{only:'live bid book; no document can carry it',na:['RIGHTS','OFS','NCD','INVITS','REITS','TENDER','BUYBACK']});

// ---------- registrars (10) ----------
add('registrars','name','D',['DOC','REG','CG'],{doc:'E3'});
add('registrars','short_name','D',['DOC','REG','CG'],{doc:'E3'});
add('registrars','email','D',['DOC','REG','—'],{doc:'E3'});
add('registrars','phone','D',['DOC','REG','—'],{doc:'E3'});
add('registrars','website','D',['REG','DOC','—'],{doc:'E3',note:'the registrar itself is authoritative for its own URL'});
add('registrars','allotment_check_url','I',['REG','—','—'],{only:'the registrar owns this URL'});
add('registrars','address','D',['DOC','REG','—'],{doc:'E3'});
add('registrars','active','I',['ADMIN','—','—'],{only:'admin-only by design; no external source exists'});
add('registrars','allotment_url_healthy','I',['—','—','—'],{});
add('registrars','allotment_url_checked_at','I',['—','—','—'],{});

// ---------------- per-type resolution (POOL-based) ----------------
// Each field's ranks come from an ordered POOL of every source that can supply it.
// For a given IPO type we drop the sources that type does not have, then take the
// first three that remain. A rank is therefore never left empty while a real source
// is still available - the bug this replaced left 28 SME fields with only two sources
// because it deleted the absent exchange instead of promoting the next source.
const TYPES = ['MAINBOARD','SME_BSE','SME_NSE','FPO','RIGHTS','OFS','NCD','INVITS','REITS','TENDER','BUYBACK'];

// Build the pool from the authored ranks plus the field's legitimate fallbacks.
// FALLBACKS lists, per table, the websites that genuinely publish that table's fields.
const WEB_OK = new Set(['ipos','ipo_details','financial_data','peer_companies','subscriptions',
                        'listing_performance','registrars','ipo_intermediaries','gmp_records']);
function pool(f) {
  const p = f.r.filter(x => x !== '—');
  if (!WEB_OK.has(f.t)) return p;                       // document-only tables: no website fallback
  for (const w of ['CG','MC']) if (!p.includes(w)) p.push(w);
  return p;
}
function resolve(f, type) {
  const naSet = f.o.na || [];
  const base = type.startsWith('SME') ? 'IPO' : type;
  if (naSet.includes(base)) return ['N/A','N/A','N/A'];
  if (f.cls === 'C' || f.cls === 'I') return [...f.r];   // computed / pipeline: ranks are meaningless
  // A field that IS one exchange's quote does not exist when the stock does not trade there.
  // Without this, an NSE price on a BSE-only SME fell through to a website and would have
  // published a number for a venue the stock is not listed on.
  if (f.o.exchOnly === 'NSE' && type === 'SME_BSE') return ['N/A','N/A','N/A'];
  if (f.o.exchOnly === 'BSE' && type === 'SME_NSE') return ['N/A','N/A','N/A'];
  let p = pool(f);
  if (type === 'SME_BSE') p = p.filter(s => s !== 'NSE');
  if (type === 'SME_NSE') p = p.filter(s => s !== 'BSE');
  const r = p.slice(0, 3);
  while (r.length < 3) r.push('—');
  return r;
}

let out = [];
out.push('| # | Field | Cls | R1 | R2 | R3 | SME-BSE | SME-NSE | Doc § | Note / why no lower rank |');
out.push('|---:|---|---|---|---|---|---|---|---|---|');
F.forEach((f, i) => {
  const m = resolve(f, 'MAINBOARD');
  const sb = resolve(f, 'SME_BSE').join(' · ');
  const sn = resolve(f, 'SME_NSE').join(' · ');
  const note = f.o.e1 ? '**E-1** (§1.2.1)' : f.o.formula ? `computed: ${f.o.formula}`
    : f.o.note ? f.o.note : f.o.only ? `no rank 2: ${f.o.only}` : '';
  out.push(`| ${i + 1} | \`${f.t}.${f.c}\` | ${f.cls} | ${m[0]} | ${m[1]} | ${m[2]} | ${sb} | ${sn} | ${f.o.doc || '—'} | ${note} |`);
});

// N/A matrix for the seven non-IPO types
let na = [];
na.push('| Offering type | IPOs on prod | Fields N/A | Fields with a live resolution |');
na.push('|---|---:|---:|---:|');
for (const t of ['FPO','RIGHTS','OFS','NCD','INVITS','REITS','TENDER','BUYBACK']) {
  const naN = F.filter(f => resolve(f, t)[0] === 'N/A').length;
  na.push(`| ${t} | ${({FPO:0,RIGHTS:8,OFS:19,NCD:7,INVITS:3,REITS:2,TENDER:16,BUYBACK:1})[t]} | ${naN} | ${F.length - naN} |`);
}

if (process.argv[2]) {
  fs.writeFileSync(process.argv[2], out.join('\n') + '\n\n' + na.join('\n') + '\n');
  console.log('fields in spec:', F.length);
  console.log('class counts:', JSON.stringify(F.reduce((a, f) => (a[f.cls] = (a[f.cls] || 0) + 1, a), {})));
  console.log('E-1 fields:', F.filter(f => f.o.e1).length);
  console.log('single-source (no rank 2):', F.filter(f => f.r[1] === '—' && f.r[0] !== '—').length);
}
