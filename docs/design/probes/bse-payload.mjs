#!/usr/bin/env node
// docs/design/probes/bse-payload.mjs — what BSE actually carries.
//
// WHY. BSE ranks second on the timetable family (E-1) and second or third on a long list of issue
// mechanics. It is also the source of the recurrence class this project has a whole detection gate
// for: `Issue_Size_No_of_shares` is a SHARE COUNT and was once written into a rupee column. So this
// probe saves the raw payload with its field names intact, rather than a summary that would hide
// exactly that kind of unit confusion.
//
// Endpoints are the ones bse-api-scraper.ts:7-8 calls. Read-only, laptop-only, no database.

import { fetchWithRetry, saveFixture, saveOutput, nowStamp } from './_lib.mjs';

const API = 'https://api.bseindia.com/BseIndiaAPI/api/';
const REFERER = 'https://www.bseindia.com/';
const WANT = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const MATCH = WANT.length ? WANT : ['ASSET RECONSTRUCTION', 'VINOD'];

const attempts = [];

async function get(label, rel, fixture) {
  const url = API + rel;
  const r = await fetchWithRetry(url, { headers: { Referer: REFERER }, spacingMs: 20_000 });
  const rec = { what: label, url, status: r.status, ok: r.ok, bytes: r.size, attempts: r.attempts, error: r.error };
  let parsed = null;
  if (r.ok && r.body) {
    try { parsed = JSON.parse(r.body); } catch { /* not json */ }
    rec.fixture = saveFixture(fixture, r.body);
    if (parsed) {
      const rows = Array.isArray(parsed) ? parsed : (parsed.Table || parsed.data || [parsed]);
      rec.records = Array.isArray(rows) ? rows.length : 1;
      const first = Array.isArray(rows) ? rows[0] : rows;
      rec.keys = first && typeof first === 'object' ? Object.keys(first) : [];
    }
  }
  attempts.push(rec);
  return { rec, parsed };
}

const { parsed: list } = await get('IPO_HomePageDetail (current board)', 'IPO_HomePageDetail/w', 'bse/IPO_HomePageDetail.json');

// Find the IPO_NO for each company we are walking, from the board itself — never guessed.
const rows = Array.isArray(list) ? list : (list && (list.Table || list.data)) || [];
const found = [];
for (const want of MATCH) {
  const hit = rows.find((r) => JSON.stringify(r).toUpperCase().includes(want.toUpperCase()));
  found.push({ wanted: want, matched: !!hit, ipo_no: hit ? (hit.IPO_NO ?? hit.ipo_no ?? null) : null,
               scrip: hit ? (hit.scripcode ?? hit.SCRIP_CD ?? null) : null,
               name: hit ? (hit.IPONAME ?? hit.Issuer_Name ?? hit.securityName ?? null) : null });
}

for (const f of found) {
  if (!f.ipo_no) continue;
  await get(`GetMkt_ISSUE_BBS_IPO IPO_NO=${f.ipo_no} (${f.wanted})`,
            `GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${f.ipo_no}`,
            `bse/GetMkt_ISSUE_BBS_IPO-${f.ipo_no}.json`);
}

const out = {
  probe: 'bse-payload',
  generated_at: nowStamp(),
  note: 'BSE answers without a cookie prime, but needs a bseindia.com Referer. IPO_NO comes from the ' +
        'board listing, never from a guess. Issue_Size_No_of_shares in these payloads is a SHARE COUNT.',
  wanted: MATCH,
  board_rows: rows.length,
  found,
  attempts,
};
saveOutput('bse-payload', out);

for (const a of attempts) {
  console.log(`${a.ok ? 'OK  ' : 'FAIL'} ${String(a.status).padEnd(4)} ${String(a.bytes ?? '-').padStart(8)}b  ${a.what}` +
    (a.records !== undefined ? `  records=${a.records} keys=${(a.keys || []).length}` : ''));
}
for (const f of found) console.log(`  ${f.wanted}: ${f.matched ? 'IPO_NO=' + f.ipo_no + ' (' + f.name + ')' : 'NOT ON THE BSE BOARD'}`);
console.log('written: bse-payload.out.json');
