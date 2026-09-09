#!/usr/bin/env node
// docs/design/probes/nse-payload.mjs — what NSE actually carries, for the IPOs we are walking.
//
// WHY. Ten fields (exception E-1) are ranked NSE-first, and dozens more rank NSE at 2 or 3. Every
// one of those ranks was, until this probe, a sentence. NSE also needs a primed cookie jar before it
// answers an API call at all, which is itself a fact an implementer needs and which no amount of
// prose conveys.
//
// Endpoints are the ones the production scrapers call (scraper/src/scrapers/nse-api-client.ts:36-43).
// Read-only, laptop-only, no database.

import { fetchWithRetry, saveFixture, saveOutput, nowStamp } from './_lib.mjs';

const BASE = 'https://www.nseindia.com';
const REFERER = 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo';
const SYMBOLS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const WALK = SYMBOLS.length ? SYMBOLS : ['ARCIL', 'VINOD'];

const jar = { value: '' };
const attempts = [];

// NSE will not answer /api/* without the cookies its homepage sets. This is step zero for any
// implementer and the reason a naive fetch from a fresh process gets a 401.
const prime = await fetchWithRetry(BASE + '/', { cookieJar: jar, spacingMs: 20_000 });
attempts.push({ what: 'cookie prime (homepage)', url: BASE + '/', status: prime.status, ok: prime.ok, bytes: prime.size });
if (!jar.value) console.log('WARNING: no cookies captured — the API calls below will probably fail');

async function get(label, pathAndQuery, fixture) {
  const url = BASE + pathAndQuery;
  const r = await fetchWithRetry(url, { cookieJar: jar, headers: { Referer: REFERER }, spacingMs: 20_000 });
  const rec = { what: label, url, status: r.status, ok: r.ok, bytes: r.size, attempts: r.attempts, error: r.error };
  if (r.ok && r.body) {
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { /* html or a block page */ }
    rec.parsed = parsed !== null;
    rec.fixture = saveFixture(fixture, r.body);
    if (parsed) {
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      rec.records = Array.isArray(parsed) ? parsed.length : 1;
      rec.keys = first && typeof first === 'object' ? Object.keys(first) : [];
    }
  }
  attempts.push(rec);
  return rec;
}

await get('current issues', '/api/ipo-current-issue', 'nse/ipo-current-issue.json');
await get('upcoming issues', '/api/all-upcoming-issues?category=ipo', 'nse/all-upcoming-issues.json');
for (const sym of WALK) {
  await get(`ipo-detail ${sym}`, `/api/ipo-detail?symbol=${encodeURIComponent(sym)}`, `nse/ipo-detail-${sym}.json`);
  await get(`active-category ${sym}`, `/api/ipo-active-category?symbol=${encodeURIComponent(sym)}&issueType=ipo`, `nse/ipo-active-category-${sym}.json`);
}

const out = {
  probe: 'nse-payload',
  generated_at: nowStamp(),
  note: 'NSE answers /api/* only after its homepage has set cookies (nsit, nseappid, bm_sv, ak_bmsc). ' +
        'A fetch without that prime returns 401. This is why the scraper keeps a session jar.',
  symbols: WALK,
  cookies_captured: jar.value ? jar.value.split('; ').map((c) => c.split('=')[0]) : [],
  attempts,
};
saveOutput('nse-payload', out);

for (const a of attempts) {
  console.log(`${a.ok ? 'OK  ' : 'FAIL'} ${String(a.status).padEnd(4)} ${String(a.bytes ?? '-').padStart(8)}b  ${a.what}` +
    (a.records !== undefined ? `  records=${a.records} keys=${(a.keys || []).length}` : ''));
}
console.log('cookies:', out.cookies_captured.join(', ') || 'NONE');
console.log('written: nse-payload.out.json');
