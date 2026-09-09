#!/usr/bin/env node
// docs/design/probes/investorgain-gmp.mjs — the one field where a website is rank 1.
//
// WHY. `gmp_records.gmp` is the single field in all 240 whose rank-1 source is a website, because the
// grey market has no official publisher and never will. It is also the most-read number on an IPO
// page outside market hours. And it is bound to our IPO by NORMALISED COMPANY NAME off a list — the
// unguarded identity problem of §2.3.2 (F-46). So this probe records two things: that the source
// carries the field, and what the row binding actually has to match against.
//
// Endpoint and parameter shape are read off investorgain-gmp-scraper.ts:23 and :236-240.
// Read-only, laptop-only, no database.

import { fetchWithRetry, saveFixture, saveOutput, nowStamp } from './_lib.mjs';

const BASE = 'https://webnodejs.investorgain.com/cloud/v2/report/data-read';
const REPORT_ID = '331';
const CATEGORY = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'all';
const WANT = ['ASSET RECONSTRUCTION', 'VINOD'];

const now = new Date();
const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
const financialYear = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
const version = `${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}`;
const url = `${BASE}/${REPORT_ID}/1/${now.getMonth() + 1}/${now.getFullYear()}/${financialYear}/0/${CATEGORY}?search=&v=${version}`;

const r = await fetchWithRetry(url, {
  headers: { Referer: `https://www.investorgain.com/report/ipo-gmp-live/${REPORT_ID}/${CATEGORY}/` },
  spacingMs: 20_000,
});

const out = {
  probe: 'investorgain-gmp',
  generated_at: nowStamp(),
  url, category: CATEGORY, financial_year: financialYear, cache_buster: version,
  status: r.status, ok: r.ok, bytes: r.size, attempts: r.attempts, error: r.error,
  note: 'The grey market has no official source. This list is fetched whole and each row is bound to ' +
        'one of our IPOs by normalised company name — the binding F-46 says is unguarded.',
};

if (r.ok && r.body) {
  out.fixture = saveFixture('investorgain/gmp-live.json', r.body);
  let parsed = null;
  try { parsed = JSON.parse(r.body); } catch { /* not json */ }
  const rows = parsed && (parsed.reportTableData || parsed.data || (Array.isArray(parsed) ? parsed : []));
  out.records = Array.isArray(rows) ? rows.length : 0;
  out.keys = Array.isArray(rows) && rows[0] ? Object.keys(rows[0]) : [];
  // What the binder actually has to work with: the raw name strings on the source side.
  // The binder matches on the display name. Prefer the exact `Name` column; the tilde-prefixed keys
  // are the site's own sort/status helpers and one of them ("~ipo_status1") also matches /ipo/,
  // which is how a first version of this probe printed "U" (for "Upcoming") eight times.
  const nameKey = out.keys.includes('Name') ? 'Name'
    : out.keys.find((kk) => !kk.startsWith('~') && /name|company/i.test(kk));
  out.name_key = nameKey || null;
  out.sample_names = nameKey ? (rows || []).slice(0, 8)
    .map((x) => String(x[nameKey]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean) : [];
  out.matches = WANT.map((w) => {
    const hit = (rows || []).find((x) => JSON.stringify(x).toUpperCase().includes(w));
    return { wanted: w, found: !!hit, row: hit || null };
  });
}

saveOutput('investorgain-gmp', out);
console.log(`${out.ok ? 'OK  ' : 'FAIL'} ${out.status}  ${out.bytes}b  records=${out.records ?? '-'}`);
console.log('keys:', (out.keys || []).join(', ').slice(0, 240));
console.log('sample source names:', (out.sample_names || []).join(' | ').slice(0, 240));
for (const m of out.matches || []) console.log(`  ${m.wanted}: ${m.found ? 'present' : 'NOT in the live GMP list'}`);
console.log('written: investorgain-gmp.out.json');
