#!/usr/bin/env node
// docs/design/probes/od167-recheck.mjs -- OD-167 three-IPO re-check of source/field pairs item 43 found unprinted.
//
// For each pair: fetch the source's IPO page for three real IPOs (mainboard, SME, closed/listed), record whether
// the field is printed. The IPOs are picked from staging (read-only) by their stored source keys
// (ipo_source_keys: BSE_IPO_NO, CG_PAGE_ID, NSE_ISSUE). A pair is removable only if NOT printed on all three
// and every fetch succeeded. Raw pages are not committed; the evidence is the extracted snippets.
// Run: node docs/design/probes/od167-recheck.mjs   (needs the staging tunnel at 127.0.0.1:15432)
import { openReadOnlyPool, fetchWithRetry, saveOutput, nowStamp, causeOf } from './_lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 10_500; // >= 10 s between requests to one host
const clean = (s) => String(s ?? '').replace(/&#8377;/g, 'Rs').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const text = (html) => clean(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<\/(tr|p|div|li|h\d|table)>/gi, ' ~ ').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
const snip = (s, re) => { const m = re.exec(s); return m ? clean(s.slice(Math.max(0, m.index - 20), m.index + m[0].length + 60)).slice(0, 220) : null; };

// ---- which IPOs (from staging, read-only) ----
const WANT = {
  BSE_IPO_NO: [['MAINBOARD', 'nityas-gems-and-jewellery-ltd'], ['SME', 'omara-ventures-india-ltd'], ['CLOSED/LISTED', 'moneyview-ltd']],
  CG_PAGE_ID: [['MAINBOARD', 'vishal-nirmiti-ltd'], ['SME', 'eventions-ltd'], ['CLOSED/LISTED', 'moneyview-ltd']],
  NSE_ISSUE: [['MAINBOARD', 'vishal-nirmiti-ltd'], ['SME', 'eventions-ltd'], ['CLOSED/LISTED', 'moneyview-ltd'],
              ['SME (extra, closed)', 'papadmalji-agro-foods-ltd'], ['SME (extra, closed)', 'himalayan-solar-ltd']],
};
const pool = await openReadOnlyPool('ipodhan_staging');
const picks = { BSE: [], CHITTORGARH: [], NSE: [] };
try {
  for (const [kt, list] of Object.entries(WANT)) {
    for (const [cls, slug] of list) {
      const { rows } = await pool.query(
        `select k.key_value, i.segment, i.status from ipo_source_keys k join ipos i on i.id=k.ipo_id
          where k.key_type=$1 and i.slug=$2 and k.state in ('ACTIVE','SUPERSEDED') limit 1`, [kt, slug]);
      if (!rows[0]) throw new Error(`no ${kt} key for ${slug}`);
      const src = kt === 'BSE_IPO_NO' ? 'BSE' : kt === 'CG_PAGE_ID' ? 'CHITTORGARH' : 'NSE';
      picks[src].push({ cls, slug, key: rows[0].key_value.split('|')[0], segment: rows[0].segment, status: rows[0].status });
    }
  }
} catch (e) { console.error('pick failed:', causeOf(e)); process.exit(1); } finally { await pool.end(); }

// ---- per-source "printed?" tests ----
const cgTests = {
  'ipo_details.bid_windows': /(bid|bidding) (window|timing)s?\s*\|/i,
  'ipo_details.ipo_market_timings': /(market|trading|bidding) (timings?|hours)\s*\|/i,
  'ipo_details.tick_size': /\btick( size)?\s*\|/i,
  'ipo_details.sponsor_banks': /sponsor banks?\s*\|/i,
  'ipo_details.upi_cutoff_time': /(upi|mandate)[^|~]{0,30}cut-?off[^|~]{0,20}\||cut-?off[^|~]{0,30}(upi|mandate)[^|~]{0,20}\|/i,
  'ipos.status': /(ipo )?status\s*\|/i,
  'financial_statements.revenue': /(total )?revenue( from operations)?\s*\|\s*[\d,.]+/i,
  'ipo_details.lot_multiple': /\(Min\)\s*~?\s*\|\s*(\d+)\s*\|\s*[\d,]+\s*\|/,
  'financial_data.promoter_holding_pre_issue': /Promoter and Promoter Group\s*\|\s*[\d.]+%\s*\|\s*[\d.]+%/i,
  'financial_data.promoter_holding_post_issue': /Promoter and Promoter Group\s*\|\s*[\d.]+%\s*\|\s*[\d.]+%/i,
  'promoters.name': /Company Promoters:\s*[A-Z]/,
  'financial_statements.basis': /Company Financials \((Restated[^)]*|Consolidated[^)]*|Standalone[^)]*)\)/i,
};
function cgRegistrar(t, field) {
  const m = /IPO Registrar(.*?)IPO Lead Manager/.exec(t); const block = m ? clean(m[1]) : null;
  if (!block) return { printed: null, snippet: 'registrar block not found on page' };
  const re = field === 'address' ? /\b(road|marg|floor|plot|building|mumbai|pune|hyderabad|delhi|\d{6})\b/i : /short name|abbreviation/i;
  return { printed: re.test(block), snippet: `registrar block: "${block.slice(0, 200)}"` };
}
function testCG(html) {
  const t = text(html); const out = {};
  for (const [pair, re] of Object.entries(cgTests)) { const s = snip(t, re); out[pair] = { printed: !!s, snippet: s }; }
  out['registrars.address'] = cgRegistrar(t, 'address'); out['registrars.short_name'] = cgRegistrar(t, 'short');
  out._obs = { roe: snip(t, /ROE\s*\|\s*[\d.]+%/), maxAllottees: snip(t, /Max Allottees/), isin: snip(t, /ISIN\s*\|\s*INE\w+/) };
  return out;
}
const flat = (o, pre = '', acc = []) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object') flat(v, pre + k + '.', acc); else acc.push([pre + k, String(v ?? '')]); } return acc; };
function testBSE(body) {
  let j; try { j = JSON.parse(body); } catch { return null; }
  const rec = j.IPONO_0?.[0] || {}; const entries = flat(rec).concat(flat(j.IPONO_1 || []));
  const hits = (labelRe, valRe) => entries.filter(([k, v]) => v && ((labelRe && labelRe.test(k)) || (valRe && valRe.test(v) && !/^https?:/.test(v))));
  const mk = (arr, note) => ({ printed: arr.length > 0, snippet: arr.length ? arr.slice(0, 3).map(([k, v]) => `${k}=${clean(v).slice(0, 60)}`).join('; ') : note });
  const nkeys = Object.keys(rec).length;
  const lot = rec.Market_Lot && rec.Minimum_Bid_Quantity ? `Market_Lot=${rec.Market_Lot}, Minimum_Bid_Quantity=${rec.Minimum_Bid_Quantity} (no lot-count key)` : 'no multiple key';
  const exch = /exchange|listed_?on|listing/i;
  return {
    'documents.filing_date': mk(hits(/filing/i, null), `no filing-date key; Prospectus_GID is a URL (...${clean(rec.Prospectus_GID).slice(-40)}); ${nkeys} keys checked`),
    'ipo_details.exchanges': mk(hits(exch, /listed (on|at)|proposed to be listed/i), `no exchange key among ${nkeys} keys`),
    'ipos.listing_exchanges': mk(hits(exch, /listed (on|at)|proposed to be listed/i), `no exchange key among ${nkeys} keys`),
    'ipo_details.fresh_issue': mk(hits(/fresh/i, /fresh issue/i), `only Issue_Size_No_of_shares=${rec.Issue_Size_No_of_shares}; IPONO_1 dynamic columns empty`),
    'ipo_details.ofs_issue': mk(hits(/\bofs\b|offer_?for_?sale/i, /offer for sale/i), 'no OFS key; IPONO_1 dynamic columns empty'),
    'ipos.segment': mk(hits(/segment|board$/i, /\b(sme|main ?board)\b/i), `no segment key; Security_Type=${rec.Security_Type}`),
    'ipo_details.lot_multiple': mk(hits(/lot_?multiple|multiple/i, /in multiples/i), lot),
  };
}
function testNSE(body) {
  let j; try { j = JSON.parse(body); } catch { return null; }
  const info = j.issueInfo?.dataList || [];
  const entries = info.map((d) => [d.title || '(untitled)', String(d.value ?? '')]).concat(flat(j.metaInfo || {}).map(([k, v]) => ['meta.' + k, v]));
  const empty = entries.length === 0;
  const note = empty ? 'issueInfo and metaInfo EMPTY on this page (nothing printed at all, including Issue Period)'
    : `${entries.length} labels, none matches: ${entries.slice(0, 8).map((e) => e[0]).join(' / ')}...`;
  const mk = (re) => { const h = entries.filter(([k, v]) => re.test(k) || (v.length < 200 && re.test(v))); return { printed: h.length > 0, snippet: h.length ? h.slice(0, 3).map(([k, v]) => `${k}=${clean(v).slice(0, 80)}`).join('; ') : note, issueInfoEmpty: empty }; };
  return {
    'ipo_details.bid_windows': mk(/bid(ding)? (window|timing)s?|window.{0,15}(QIB|retail|NII)/i),
    'ipo_details.exchanges': mk(/exchange|listed (on|at)|listing (on|at)/i),
    'ipos.listing_exchanges': mk(/exchange|listed (on|at)|listing (on|at)/i),
  };
}

// ---- fetch (politely) and record ----
const rows = []; const fetchLog = [];
async function get(source, pick, url, headers, jar) {
  const r = await fetchWithRetry(url, { headers, cookieJar: jar, spacingMs: 15_000 });
  fetchLog.push({ source, ipo: pick.slug, url, status: r.status, bytes: r.size, error: r.error || null, fetched_at: nowStamp() });
  await sleep(GAP); return r;
}
function record(source, pick, url, r, tests) {
  const common = { source, ipo: pick.slug, ipo_class: pick.cls, segment: pick.segment, status: pick.status, url, fetched_at: nowStamp() };
  if (!r.ok || !tests) { rows.push({ ...common, pair: '*', printed: null, snippet: `fetch failed: ${r.error || 'HTTP ' + r.status}` }); return; }
  for (const [pair, v] of Object.entries(tests)) {
    if (pair === '_obs') rows.push({ ...common, pair: '_observation', kind: 'observation', note: 'outside this re-check; recorded for item 43 mapping', ...v });
    else rows.push({ ...common, pair, printed: v.printed, snippet: v.snippet, ...(v.issueInfoEmpty ? { issueInfoEmpty: true } : {}) });
  }
}
for (const p of picks.BSE) { const url = `https://api.bseindia.com/BseIndiaAPI/api/GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${p.key}`; const r = await get('BSE', p, url, { Referer: 'https://www.bseindia.com/' }); record('BSE', p, url, r, r.ok ? testBSE(r.body) : null); }
for (const p of picks.CHITTORGARH) { const url = `https://www.chittorgarh.com/ipo/${p.slug}-ipo/${p.key}/`; const r = await get('CHITTORGARH', p, url, {}); record('CHITTORGARH', p, url, r, r.ok ? testCG(r.body) : null); }
const jar = { value: '' };
const prime = await fetchWithRetry('https://www.nseindia.com/', { cookieJar: jar, spacingMs: 15_000 }); fetchLog.push({ source: 'NSE', what: 'cookie prime (homepage)', url: 'https://www.nseindia.com/', status: prime.status, fetched_at: nowStamp() }); await sleep(GAP);
for (const p of picks.NSE) { const url = `https://www.nseindia.com/api/ipo-detail?symbol=${encodeURIComponent(p.key)}`; const r = await get('NSE', p, url, { Referer: 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo' }, jar); record('NSE', p, url, r, r.ok ? testNSE(r.body) : null); }

// ---- verdict per pair ----
const pairs = {};
for (const r of rows) { if (r.pair === '_observation') continue; (pairs[`${r.source} ${r.pair}`] ||= []).push(r); }
const failedSources = new Set(rows.filter((r) => r.pair === '*').map((r) => r.source));
const verdicts = Object.entries(pairs).map(([k, rs]) => {
  const anyFail = rs.some((x) => x.printed === null) || failedSources.has(rs[0].source);
  const anyPrinted = rs.some((x) => x.printed === true);
  const smeEmpty = rs.some((x) => x.segment === 'SME' && x.ipo_class === 'SME' && x.issueInfoEmpty);
  const verdict = smeEmpty ? 'PARKED: SME re-check returned empty data (not removed; re-check when an NSE SME detail page serves data)' : anyFail ? 'INCOMPLETE (not removed)' : anyPrinted ? 'PRINTED on re-check: map instead' : 'NOT PRINTED on all re-checked IPOs: remove';
  return { pair: k, verdict, ipos: rs.map((x) => `${x.ipo}:${x.printed}`) };
});
saveOutput('od167-recheck', { probe: 'od167-recheck', spec: 'OD-167', generated_at: nowStamp(), picks, fetch_log: fetchLog, verdicts, rows });
for (const v of verdicts) console.log(v.verdict.padEnd(44), v.pair, v.ipos.join(' '));
