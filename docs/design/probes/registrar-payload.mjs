#!/usr/bin/env node
// docs/design/probes/registrar-payload.mjs — what a registrar's own public page actually carries.
//
// WHY. `registrars.name/short_name/email/phone/website/address` rank REG second, after DOC
// (field-source-resolution.spec.mjs:269-275), and `allotment_check_url` ranks REG as the ONLY
// source. Every one of those ranks was, until this probe, a sentence with no payload behind it
// (delta-report-2026-09-09.md §6, §8: "the registrar probe the contract asked for was not
// written"). This fetches the public page for six registrars that carry live IPOs today — KFin,
// Link Intime/MUFG, Bigshare, Cameo, Skyline, Purva — for the two walkthrough IPOs and one LISTED
// IPO, and records HONESTLY whether the page (a static fetch, not a rendered browser) carries
// allotment date, basis of allotment or issue details, or carries nothing readable.
//
// HONEST LIMIT stated up front, not discovered by a reader later: most registrar allotment-status
// pages are a client-side search form (enter PAN/DPID, submit) — the static HTML a plain fetch
// gets is the shell, not the result. Where that is what the page returns, this probe records
// "carries nothing readable / blocked" and says why, per OD-25 (an unreachable source is recorded
// as unreachable, never invented).
//
//   node docs/design/probes/registrar-payload.mjs
//
// Read-only, laptop-only, no database write. The three (company, registrar) targets come from a
// live read of `registrars`/`ipos` via the read-only tunnel — never hand-typed.

import { fetchWithRetry, saveFixture, saveOutput, nowStamp, openReadOnlyPool, causeOf } from './_lib.mjs';

const pool = await openReadOnlyPool();
let targets, registrars;
try {
  const ipoRows = (await pool.query(
    `select slug, company_name, registrar_id, status from ipos
     where slug in ('asset-reconstruction-company-india-ltd','vinod-texworld-ltd')
        or (status = 'LISTED' and registrar_id is not null)
     order by (slug in ('asset-reconstruction-company-india-ltd','vinod-texworld-ltd')) desc, updated_at desc`
  )).rows;
  const walk = ipoRows.filter((r) => r.slug === 'asset-reconstruction-company-india-ltd' || r.slug === 'vinod-texworld-ltd');
  const listed = ipoRows.find((r) => r.status === 'LISTED');
  targets = [...walk, listed].filter(Boolean);

  registrars = (await pool.query(
    `select id, short_name, name, website, allotment_check_url from registrars
     where short_name in ('KFin','Link Intime','Bigshare','Cameo','Skyline','Purva Sharegistry')`
  )).rows;
} finally {
  await pool.end();
}

const FIELD_WORDS = {
  'allotment date': /allotment\s*date|date of allotment/i,
  'basis of allotment': /basis of allotment|boa\b/i,
  'issue details': /issue (open|close|period|size|price)|price band/i,
};

const results = [];
for (const reg of registrars) {
  for (const url of [reg.allotment_check_url, reg.website].filter(Boolean)) {
    // 12 URLs across 6 registrars: full 2-minute spacing would run ~40 minutes on failures alone.
    // Shortened to 15s, stated here per _lib.mjs's convention for probes that fetch many URLs.
    const r = await fetchWithRetry(url, { spacingMs: 15_000 });
    const rec = {
      registrar: reg.short_name, url, status: r.status, ok: r.ok, bytes: r.size,
      attempts: r.attempts, error: r.error,
    };
    if (r.ok && r.body) {
      const text = String(r.body).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
      rec.fixture = saveFixture(`registrars/${reg.short_name.replace(/\s+/g, '-')}-${url === reg.website ? 'website' : 'allotment'}.html`, r.body);
      const carries = Object.entries(FIELD_WORDS).filter(([, re]) => re.test(text)).map(([k]) => k);
      const mentions = targets.filter((t) => text.toUpperCase().includes(String(t.company_name).toUpperCase().slice(0, 12)));
      rec.reads = /<form|action=|__doPostBack|search|pan|dpid/i.test(text) && !carries.length
        ? 'client-side search form — the static fetch got the shell, not a result; carries nothing readable without a POST/JS interaction'
        : (carries.length ? `carries: ${carries.join(', ')}` : 'carries nothing readable / blocked');
      rec.company_mentions = mentions.map((m) => m.company_name);
    } else {
      rec.reads = `unreachable — ${r.error || ('HTTP ' + r.status)}`;
    }
    results.push(rec);
  }
}

const out = {
  probe: 'registrar-payload',
  generated_at: nowStamp(),
  targets: targets.map((t) => ({ slug: t.slug, company_name: t.company_name, status: t.status })),
  registrars_probed: registrars.map((r) => r.short_name),
  note: 'A registrar allotment page is almost always a client-side search form. A plain fetch sees ' +
        'the form shell, never the per-applicant result, which is why "carries nothing readable" is ' +
        'the honest reading for most rows here, not a probe failure.',
  results,
};
saveOutput('registrar-payload', out);

for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${String(r.status).padEnd(4)} ${r.registrar.padEnd(14)} ${r.url}\n      -> ${r.reads}`);
console.log('written: registrar-payload.out.json');
