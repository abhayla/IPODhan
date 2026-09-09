#!/usr/bin/env node
// docs/design/probes/evidence-map.mjs — turn saved payloads into per-rank evidence (OD-25, check D15).
//
// WHY. Appendix A gives every one of 240 fields up to three ranked sources. Until this ran, each of
// those ranks was an assertion. Round four of the design found 51 of them wrong, and found them only
// by fetching live payloads. So this walks every (field, source) pair the appendix resolves, looks
// for that field in the SAVED payload for that source, and records what it found — the label, the
// fixture, the line of evidence. A pair with no match is recorded as UNPROVEN with the reason. It is
// never quietly passed.
//
//   node docs/design/probes/evidence-map.mjs            report, write evidence-map.out.json
//   node docs/design/probes/evidence-map.mjs --apply     also write `ev` refs into the spec
//
// EXIT: 0 report written · 2 the mapper itself broke.
//
// Reads only files already on disk. No network, no database.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HERE, saveOutput, nowStamp } from './_lib.mjs';

const SPEC = path.resolve(HERE, '../field-source-resolution.spec.mjs');
const FIX = path.join(HERE, 'fixtures');
const apply = process.argv.includes('--apply');

const { F, RESOLVE } = await import(pathToFileURL(SPEC).href);

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(FIX, p), 'utf8'));
const readText = (p) => fs.readFileSync(path.join(FIX, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(FIX, p));

// ---------------------------------------------------------------------------
// Capability index per source: every label or key the SAVED payload actually has.
// ---------------------------------------------------------------------------
const index = {};   // source -> [{ label, fixture, sample }]

// --- NSE. The labelled fields live in issueInfo.dataList[{title,value}]; the live figures live in
// bidDetails / activeCat / demandGraph. Both are indexed.
{
  const rows = [];
  for (const f of ['nse/ipo-detail-ARCIL.json', 'nse/ipo-detail-VINOD.json',
                   'nse/ipo-current-issue.json', 'nse/all-upcoming-issues.json',
                   'nse/ipo-active-category-ARCIL.json']) {
    if (!exists(f)) continue;
    let d = readJson(f);
    if (Array.isArray(d)) d = d[0] || {};
    for (const it of (d.issueInfo?.dataList || [])) {
      if (it && it.title) rows.push({ label: String(it.title), fixture: f, sample: String(it.value ?? '').slice(0, 90) });
    }
    const shared = /ipo-current-issue|all-upcoming-issues/.test(f);
    for (const k of Object.keys(d)) {
      if (typeof d[k] !== 'object') rows.push({ label: k, fixture: f, sample: shared ? '' : String(d[k]).slice(0, 90), multiRow: shared });
    }
    // The label must be a string that is literally IN the payload, because D15 re-checks it there.
    // Prefixing these with their container ("bidDetails.noOfTime") produced a label that appears
    // nowhere in the file, and D15 rejected all three the moment it started checking labels rather
    // than filenames. The container is recorded in `where`, which is context, not the claim.
    for (const k of Object.keys(d.demandGraph || {})) rows.push({ label: k, where: 'demandGraph', fixture: f, sample: '' });
    for (const b of (d.bidDetails || []).slice(0, 1)) for (const k of Object.keys(b)) rows.push({ label: k, where: 'bidDetails', fixture: f, sample: '' });
    for (const b of (d.activeCat?.dataList || []).slice(0, 1)) for (const k of Object.keys(b)) rows.push({ label: k, where: 'activeCat', fixture: f, sample: '' });
  }
  index.NSE = rows;
}

// --- BSE. IPONO_0[0] is the detail record; the board listing is the second source of keys.
{
  const rows = [];
  for (const f of fs.existsSync(path.join(FIX, 'bse')) ? fs.readdirSync(path.join(FIX, 'bse')) : []) {
    const d = readJson('bse/' + f);
    const rec = d?.IPONO_0?.[0] || (Array.isArray(d) ? d[0] : null);
    // The BSE board listing covers every IPO at once; only the per-IPO detail payload has one subject.
    const shared = /IPO_HomePageDetail/.test(f);
    for (const k of Object.keys(rec || {})) rows.push({ label: k, fixture: 'bse/' + f, sample: shared ? '' : String(rec[k] ?? '').slice(0, 90), multiRow: shared });
  }
  index.BSE = rows;
}

// --- Chittorgarh. HTML, and the labels that matter are TABLE CELLS, not page text. A first version
// of this indexer took every short line on the page, which meant `gmp_records.gmp` "matched" the
// page TITLE ("Asset Reconstruction IPO Date, Price, GMP, Review, Details") and
// `ipos.issue_size` "matched" a navigation link ("Issue Size (Year-wise)"). Evidence that points at
// a nav link is worse than no evidence, because it reads as proof.
{
  const rows = [];
  const dir = path.join(FIX, 'chittorgarh');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.html') && !x.includes('slug-ignored')) : []) {
    const html = readText('chittorgarh/' + f).replace(/<script[\s\S]*?<\/script>/gi, ' ');
    const strip = (x) => x.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    // label/value pairs: two adjacent cells in the same row.
    for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(strip).filter(Boolean);
      if (cells.length < 2) continue;
      const label = cells[0];
      if (!label || label.length > 45 || label.includes('?')) continue;
      rows.push({ label, fixture: 'chittorgarh/' + f, sample: cells.slice(1).join(' | ').slice(0, 90) });
    }
    // and the table HEADERS, which is where the peer/KPI column names live (P/BV Ratio, EPS, NAV).
    for (const th of html.match(/<th[^>]*>[\s\S]*?<\/th>/gi) || []) {
      const label = strip(th);
      if (label && label.length <= 45 && !label.includes('?')) rows.push({ label, fixture: 'chittorgarh/' + f, sample: '(column header)' });
    }
  }
  index.CG = rows;
}

// --- InvestorGain. One report, one row shape.
{
  const rows = [];
  if (exists('investorgain/gmp-live.json')) {
    const d = readJson('investorgain/gmp-live.json');
    const r = (d.reportTableData || d.data || [])[0] || {};
    // multiRow: this payload is ONE list covering every live IPO, so the value beside a label belongs
    // to whichever row happens to be first. A blind check caught the consequence: the grey-market
    // premium was reported as 248, which belongs to an unrelated issue sitting at index 0, while the
    // IPO being walked had a premium of 30. The LABEL is evidence that the source carries the field;
    // the VALUE from a shared list is not evidence about any particular IPO, and is not shown.
    for (const k of Object.keys(r)) rows.push({ label: k, fixture: 'investorgain/gmp-live.json', sample: '', multiRow: true });
  }
  index.IG = rows;
}

// --- DOC. The real extractor's real output on real PDFs — but ONLY the leaves that are an
// extracted VALUE. The extractor also emits `fields.<name>.source_doc`, `.check.*` and `.detail`
// alongside each value, and indexing those is how a first version of this mapper "proved" that the
// offer document carries `ipos.registrar` by matching
// `fields.financial_plausibility_unit_stated_near_table.value`. The label is the field name the
// extractor itself used, which is the thing a rank claim is actually about.
{
  const rows = [];
  const dir = path.join(FIX, 'extraction');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const d = readJson('extraction/' + f);
    for (const [name, node] of Object.entries(d.fields || {})) {
      const v = node && typeof node === 'object' ? node.value : node;
      const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
        || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
      // The extractor also emits its own VALIDATION outputs as fields (`financial_plausibility_*`,
      // `*_check`). Their values are booleans about the data, not the data, and indexing them let
      // `financial_data.eps` "match" `financial_plausibility_eps_times_shares_...` = true.
      if (/plausibility|_check$|^check_|_flag$|_ok$|_valid$/.test(name)) continue;
      rows.push({ label: name, fixture: 'extraction/' + f,
                  sample: (Array.isArray(v) ? `[${v.length}]` : typeof v === 'object' && v ? JSON.stringify(v).slice(0, 60) : String(v ?? '')).slice(0, 60),
                  empty });
    }
  }
  index.DOC = rows;
}

// Sources with no probe of their own. Recorded as unprobed rather than assumed either way.
const UNPROBED = { REG: 'no registrar-site probe was run in this round', ADMIN: 'an admin-only field has no external source to probe', MC: 'Moneycontrol is retired by OD-3 and serves no field' };

// ---------------------------------------------------------------------------
// Matching a column to a label.
// ---------------------------------------------------------------------------
const SYN = {
  min: ['min', 'minimum', 'floor', 'low', 'from'], max: ['max', 'maximum', 'cap', 'high', 'to'],
  lot: ['lot', 'bidlot', 'marketlot'], size: ['size', 'amount', 'quantity'],
  registrar: ['registrar', 'rta'], lead: ['lead', 'brlm', 'bookrunning', 'merchant'],
  managers: ['manager', 'managers'], isin: ['isin'], symbol: ['symbol', 'scrip', 'ticker'],
  company: ['company', 'issuer', 'scripname', 'iponame'], name: ['name'],
  price: ['price', 'priceband', 'pricerange'], range: ['range', 'band'],
  face: ['face'], value: ['value'], open: ['open', 'opening', 'issueperiod', 'start'],
  close: ['close', 'closing', 'issueperiod', 'end'], date: ['date', 'dt', 'period'],
  listing: ['listing', 'listed'], exchanges: ['exchange', 'exchanges', 'listedat'],
  fresh: ['fresh'], ofs: ['ofs', 'offerforsale'], issue: ['issue', 'offer'],
  tick: ['tick'], sponsor: ['sponsor'], bank: ['bank', 'banks'],
  upi: ['upi'], cutoff: ['cutoff', 'cutofftime'], time: ['time', 'timings'],
  gmp: ['gmp', 'premium'], subscription: ['subscription', 'sub', 'notime', 'times'],
  shares: ['share', 'shares', 'noofshares', 'quantity'], offered: ['offered', 'reserved'],
  bid: ['bid', 'bids'], total: ['total'], retail: ['retail', 'ind', 'individual'],
  qib: ['qib', 'qualifiedinstitutional'], nii: ['nii', 'nib', 'noninstitutional', 'hni'],
  employee: ['employee'], anchor: ['anchor'], sector: ['sector', 'industry'],
  description: ['description', 'about', 'profile'], objectives: ['object', 'objects', 'objectives'],
  promoter: ['promoter', 'promoters'], peer: ['peer'], revenue: ['revenue', 'totalincome'],
  profit: ['profit', 'pat', 'netprofit'], worth: ['worth', 'networth'], eps: ['eps', 'earningpershare'],
  pe: ['pe', 'peratio', 'pricetoearning'], nav: ['nav', 'netassetvalue'],
  mcap: ['mcap', 'marketcap', 'marketcapitalisation', 'marketcapitalization'],
  ronw: ['ronw', 'returnonnetworth'], roe: ['roe'], ebitda: ['ebitda'],
  type: ['type', 'issuetype', 'securitytype'], segment: ['segment', 'series', 'board'],
  status: ['status'], allotment: ['allotment', 'basisofallotment', 'boa'],
  refunds: ['refund', 'refunds', 'initiationofrefunds'], credit: ['credit', 'creditofshares', 'demat'],
  discount: ['discount'], pbv: ['pbv', 'pricetobook'], waca: ['waca', 'weightedaveragecost'],
  cin: ['cin'], website: ['website', 'url'], address: ['address'], email: ['email'],
  phone: ['phone', 'contact', 'number'], compliance: ['compliance'], officer: ['officer'],
};

const tok = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const expand = (t) => SYN[t] || [t];
const flat = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// Substring matching over a flattened label is how `ipos.symbol` "matched" `business_description`:
// the synonym "scrip" is inside "de-scrip-tion". So an alternative must line up with a WHOLE token of
// the label, or be a prefix of one within two characters (lot/lots, share/shares, manager/managers).
// Only alternatives of 8 characters or more may match as a plain substring, where a false positive
// needs a coincidence rather than an accident.
const hasToken = (labelTokens, alt) => {
  const a = flat(alt);
  if (!a) return false;
  // The near-prefix rules exist for plurals and short inflections (lot/lots, manager/managers). They
  // must never let a SHORT token stand in for a longer word: the first version allowed
  // `a.startsWith(t)` with no floor on `t`, so the synonym "pat" matched Chittorgarh's one-letter
  // token "p" in "P/E (x)" and the design ended up citing a price-to-earnings ratio as evidence that
  // the source carries profit after tax. Four more wrong-quantity pairs rode the same rule. Both
  // directions now require at least four characters on the shorter side.
  const MIN_STEM = 4;
  return labelTokens.some((t) =>
    t === a
    || (t.startsWith(a) && a.length >= MIN_STEM && t.length - a.length <= 2)
    || (a.startsWith(t) && t.length >= MIN_STEM && a.length - t.length <= 2)
    || (a.length >= 8 && t.includes(a)));
};

// ---------------------------------------------------------------------------
// CURATED: the (column, source) pairs whose label was read and confirmed BY A PERSON against the
// saved payload. Everything not here, and not an exact name match, is UNPROVEN.
//
// WHY THE TOKEN MATCHER IS NO LONGER ALLOWED TO PRODUCE EVIDENCE. Three tightenings were not enough.
// A review on 2026-09-09 found it citing BSE's share COUNT as evidence for a rupee amount, the
// financial table's "Period Ended" header as evidence for a bidding close date, one Chittorgarh cell
// labelled "Name" as evidence for three different entities, and the offer document's PROMOTER as
// evidence for the registrar. Every one of those is a label that legitimately contains the right
// words and means something else. No amount of token cleverness fixes that, because the ambiguity is
// in the source, not in the matching: "Name" is genuinely ambiguous until a human says name OF WHAT.
// So the matcher now only SUGGESTS, and a suggestion is not evidence.
const CURATED = {
  'ipos.registrar':            { NSE: 'Name of the Registrar', BSE: 'Registrar' },
  'ipos.lead_managers':        { NSE: 'Book Running Lead Managers', BSE: 'Book_Running_Lead_Manager' },
  'ipos.face_value':           { NSE: 'Face Value', BSE: 'Face_Value', DOC: 'face_value' },
  'ipos.lot_size':             { DOC: 'lot_size' },
  'ipos.symbol':               { NSE: 'Symbol', BSE: 'Symbol' },
  'ipos.company_name':         { NSE: 'companyName', BSE: 'ScripName' },
  'ipos.open_date':            { NSE: 'Issue Period', BSE: 'Issue_Period' },
  'ipos.close_date':           { NSE: 'Issue Period', BSE: 'Issue_Period' },
  'ipos.price_range_min':      { NSE: 'Price Range', BSE: 'Price_Band' },
  'ipos.price_range_max':      { NSE: 'Price Range', BSE: 'Price_Band' },
  'ipo_details.issue_type':    { NSE: 'Issue Type' },
  'ipo_details.tick_size':     { NSE: 'Tick Size', BSE: 'Tick_Size' },
  'ipo_details.lot_multiple':  { BSE: 'Market_Lot' },
  'ipo_details.sponsor_banks': { NSE: 'Sponsor Bank', BSE: 'Sponsor_Bank' },
  'ipo_details.ipo_market_timings': { NSE: 'IPO Market Timings', BSE: 'IPO_Market_Timings' },
  'ipo_details.upi_cutoff_time':    { NSE: 'Cut-off time for UPI Mandate Confirmation' },
  'ipo_details.max_retail_subscription': { NSE: 'Maximum Subscription Amount for Retail Investor' },
  'ipo_details.sub_categories_upi': { NSE: 'Sub-Categories applicable for UPI' },
  'ipo_details.category_details':   { NSE: 'Categories' },
  'gmp_records.gmp':           { IG: 'GMP' },
  'subscriptions.shares_offered': { NSE: 'noOfSharesOffered' },
  'subscriptions.total_shares_bid': { NSE: 'noOfsharesBid' },
  'subscriptions.total_subscription': { NSE: 'noOfTime' },
};

function match(col, source, table) {
  const rows = index[source];
  if (!rows) return null;
  const key = table + '.' + col;

  // 1. A curated pair: the label was confirmed by a person against this payload.
  const want = (CURATED[key] || {})[source];
  if (want) {
    const hit = rows.find((r) => !r.empty && r.label === want);
    if (hit) return { ...hit, how: 'curated: label confirmed against the payload' };
    return null;    // curated but absent from THIS payload — not evidence, and not a fallback either
  }

  // 2. An exact name match. `lot_size` in the extractor's own output is the extractor's own name for
  //    the field, and that is as unambiguous as this gets.
  const flatCol = flat(col);
  const exact = rows.find((r) => !r.empty && flat(r.label) === flatCol);
  if (exact) return { ...exact, how: 'exact name match' };

  return null;
}

// Kept only to SUGGEST candidates for future curation. Never returned as evidence.
function suggest(col, source) {
  const rows = index[source];
  if (!rows) return null;
  const parts = tok(col).filter((t) => !['id', 'at', 'of', 'the', 'is'].includes(t));
  if (!parts.length) return null;
  const need = parts.map(expand);
  for (const r of rows) {
    if (r.empty) continue;
    const labelTokens = tok(r.label).map(flat);
    if (need.every((alts) => alts.some((a) => hasToken(labelTokens, a)))) return r.label;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Walk every (field, source) pair the appendix resolves.
// ---------------------------------------------------------------------------
const pairs = [];
for (const f of F) {
  const srcs = new Set();
  for (const t of ['MAINBOARD', 'SME_BSE', 'SME_NSE']) {
    for (const r of RESOLVE(f, t) || []) if (r !== '—' && r !== 'N/A') srcs.add(r);
  }
  for (const src of srcs) {
    const col = `${f.t}.${f.c}`;
    if (UNPROBED[src]) { pairs.push({ field: col, source: src, verdict: 'UNPROBED', why: UNPROBED[src] }); continue; }
    const m = match(f.c, src, f.t);
    if (m) { pairs.push({ field: col, source: src, verdict: 'CARRIES', label: m.label, fixture: m.fixture, sample: m.multiRow ? '' : m.sample, multiRow: !!m.multiRow, how: m.how }); continue; }
    const sug = suggest(f.c, src);
    pairs.push({ field: col, source: src, verdict: 'UNPROVEN',
      why: `probed ${src}: no curated or exact label for "${f.c}"` + (sug ? `; nearest candidate seen was "${sug}" — a CANDIDATE, not evidence, and it needs a person to confirm what it names` : '') });
  }
}

const by = pairs.reduce((a, p) => (a[p.verdict] = (a[p.verdict] || 0) + 1, a), {});
const bySource = {};
for (const p of pairs) {
  bySource[p.source] = bySource[p.source] || {};
  bySource[p.source][p.verdict] = (bySource[p.source][p.verdict] || 0) + 1;
}

const out = {
  probe: 'evidence-map',
  generated_at: nowStamp(),
  method: 'For every (field, source) pair Appendix A resolves, look for the field in the SAVED payload ' +
          'for that source. CARRIES records the label and the fixture. UNPROVEN means the payload was ' +
          'searched and nothing matched — it is a rank to re-examine, not a pass. UNPROBED means no ' +
          'probe was run for that source in this round.',
  caveat: 'Matching is by token overlap with a synonym table, so a CARRIES verdict names the label it ' +
          'matched and that label is auditable. A reviewer disagreeing with one match should say so ' +
          'against the recorded label, not against the number.',
  index_sizes: Object.fromEntries(Object.entries(index).map(([k, v]) => [k, v.length])),
  totals: by,
  by_source: bySource,
  pairs,
};
saveOutput('evidence-map', out);

console.log('index sizes: ' + JSON.stringify(out.index_sizes));
console.log('pairs: ' + JSON.stringify(by));
for (const [s, v] of Object.entries(bySource)) console.log(`  ${s.padEnd(6)} ${JSON.stringify(v)}`);

if (apply) {
  // Evidence lands in a GENERATED data file the spec imports, not as inline `ev:` on each add().
  // Textual surgery reached only the fields declared one-per-line; the 240 include whole families
  // added in loops (every financial_data fiscal-year column, every peer_companies column), and a
  // mechanism that silently covers two thirds of its target is worse than one that covers none,
  // because the count looks like progress.
  const evByField = {};
  for (const p of pairs) {
    if (p.verdict !== 'CARRIES') continue;
    // The LABEL travels with the path. Storing only the path let D15 pass while every reference
    // pointed at one unrelated fixture: its whole assertion was "the file exists", so a GMP report
    // could stand as evidence that a source carries a registrar name. The label is what makes the
    // reference checkable.
    (evByField[p.field] = evByField[p.field] || {})[p.source] = { ref: 'fixtures/' + p.fixture, label: p.label };
  }
  const EV_FILE = path.resolve(HERE, '../evidence.json');
  fs.writeFileSync(EV_FILE, JSON.stringify({
    generated_by: 'docs/design/probes/evidence-map.mjs --apply',
    generated_at: nowStamp(),
    note: 'Per (field, source) evidence references. Paths are relative to docs/design/probes/. ' +
          'Never hand-edit: re-run the mapper.',
    fields: Object.fromEntries(Object.entries(evByField).sort(([x], [y]) => x.localeCompare(y))),
  }, null, 2) + String.fromCharCode(10));
  const pairCount = Object.values(evByField).reduce((n, o) => n + Object.keys(o).length, 0);
  console.log(`wrote docs/design/evidence.json: ${Object.keys(evByField).length} fields, ${pairCount} (field, source) pairs`);
  console.log(`EVIDENCE_FLOOR should now be ${pairCount} in field-source-resolution.spec.mjs`);
}
console.log('written: evidence-map.out.json');
