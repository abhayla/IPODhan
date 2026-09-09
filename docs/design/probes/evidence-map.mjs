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
    for (const k of Object.keys(d)) {
      if (typeof d[k] !== 'object') rows.push({ label: k, fixture: f, sample: String(d[k]).slice(0, 90) });
    }
    for (const k of Object.keys(d.demandGraph || {})) rows.push({ label: 'demandGraph.' + k, fixture: f, sample: '' });
    for (const b of (d.bidDetails || []).slice(0, 1)) for (const k of Object.keys(b)) rows.push({ label: 'bidDetails.' + k, fixture: f, sample: '' });
    for (const b of (d.activeCat?.dataList || []).slice(0, 1)) for (const k of Object.keys(b)) rows.push({ label: 'activeCat.' + k, fixture: f, sample: '' });
  }
  index.NSE = rows;
}

// --- BSE. IPONO_0[0] is the detail record; the board listing is the second source of keys.
{
  const rows = [];
  for (const f of fs.existsSync(path.join(FIX, 'bse')) ? fs.readdirSync(path.join(FIX, 'bse')) : []) {
    const d = readJson('bse/' + f);
    const rec = d?.IPONO_0?.[0] || (Array.isArray(d) ? d[0] : null);
    for (const k of Object.keys(rec || {})) rows.push({ label: k, fixture: 'bse/' + f, sample: String(rec[k] ?? '').slice(0, 90) });
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
    for (const k of Object.keys(r)) rows.push({ label: k, fixture: 'investorgain/gmp-live.json', sample: String(r[k] ?? '').slice(0, 60) });
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
  return labelTokens.some((t) => t === a || (t.startsWith(a) && t.length - a.length <= 2)
    || (a.startsWith(t) && a.length - t.length <= 2) || (a.length >= 8 && t.includes(a)));
};

function match(col, source) {
  const rows = index[source];
  if (!rows) return null;
  const parts = tok(col).filter((t) => !['id', 'at', 'of', 'the', 'is'].includes(t));
  if (!parts.length) return null;
  const need = parts.map(expand);

  // 1. An exact label match, ignoring punctuation and case. `GMP` beats `~max_gmp1`.
  const exact = rows.find((r) => !r.empty && flat(r.label) === flat(col.replace(/_/g, '')));
  if (exact) return { ...exact, how: 'exact label' };

  // 2. EVERY token of the column name (after synonym expansion) must appear in the label. Matching
  //    against the VALUE as well was too loose — a sample containing the IPO slug matched anything —
  //    so only the label counts, and there is no near-miss tier. A rank with no full match is
  //    UNPROVEN, which is a rank to look at again, not a rank to quietly bless.
  // A label may not carry a token that CHANGES what the number is. "PAT Margin" contains every
  // token of `pat` and is a different quantity; so is "Revenue Growth" and "EPS (Diluted) YoY".
  // Evidence for the wrong quantity is the most expensive kind of wrong, because it looks right.
  const MEANING_CHANGERS = ['margin', 'growth', 'yoy', 'cagr', 'wise', 'managed', 'review', 'maker',
                            'trend', 'change', 'variance', 'forecast', 'estimate', 'peer', 'industry'];
  const colTokens = new Set(parts.flatMap(expand).map(flat));
  for (const r of rows) {
    if (r.empty) continue;
    const labelTokens = tok(r.label).map(flat);
    if (!need.every((alts) => alts.some((a) => hasToken(labelTokens, a)))) continue;
    const extras = labelTokens.filter((t) => t && !colTokens.has(t) && ![...colTokens].some((c) => t.includes(c) || c.includes(t)));
    if (extras.some((e) => MEANING_CHANGERS.includes(e))) continue;
    return { ...r, how: 'all tokens in label', label_extras: extras };
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
    const m = match(f.c, src);
    if (m) pairs.push({ field: col, source: src, verdict: 'CARRIES', label: m.label, fixture: m.fixture, sample: m.sample, how: m.how });
    else pairs.push({ field: col, source: src, verdict: 'UNPROVEN', why: `probed ${src}: no label in the saved payload matches "${f.c}"` });
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
    (evByField[p.field] = evByField[p.field] || {})[p.source] = 'fixtures/' + p.fixture;
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
