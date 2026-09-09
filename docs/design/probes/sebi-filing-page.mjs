#!/usr/bin/env node
// docs/design/probes/sebi-filing-page.mjs — what SEBI's own public offer-document listing carries.
//
// WHY. No field in Appendix A currently ranks SEBI (`SEBI`) as a source at all — the design cites
// SEBI prose (observation validity, the lapsed-draft rule) but has never fetched SEBI's own site.
// SEBI is also where two real filings for the walkthrough IPOs actually live: `documents.url` for
// asset-reconstruction-company-india-ltd's DRHP and RHP are both `sebi.gov.in` PDFs (read live from
// production via the read-only tunnel, never guessed). This probe hits SEBI's public FILING-LISTING
// pages — not those individual PDFs — because the appendix question is whether the listing page
// itself carries filing date, document links or lead-manager names, the way NSE's and BSE's board
// listings do.
//
// HONEST LIMIT stated up front: SEBI's site is known to serve differently to a bare fetch than to a
// browser (bot mitigation), and the exact listing-page URL for "public issues" has moved before.
// Every candidate below is tried; a candidate that comes back blocked or unreachable is recorded
// that way, not silently dropped.
//
// Read-only, laptop-only, no database write beyond the read used to find the two walkthrough IPOs'
// own SEBI filing URLs (for context in the output, not fetched here — extract-real-pdf.mjs already
// covers document PDFs).

import { fetchWithRetry, saveFixture, saveOutput, nowStamp, openReadOnlyPool } from './_lib.mjs';

const pool = await openReadOnlyPool();
let filings;
try {
  filings = (await pool.query(
    `select d.url, d.type, i.slug from documents d join ipos i on i.id = d.ipo_id
     where i.slug in ('asset-reconstruction-company-india-ltd','vinod-texworld-ltd')
       and d.url ilike '%sebi.gov.in%'
     order by i.slug`
  )).rows;
} finally {
  await pool.end();
}

// Candidate public listing pages. SEBI reorganised its "filings" section more than once; every
// candidate is tried and recorded rather than assumed.
const CANDIDATES = [
  ['public issues listing', 'https://www.sebi.gov.in/filings/public-issues.html'],
  ['offer documents listing', 'https://www.sebi.gov.in/sebi_data/dprfilings/dprfiling.html'],
  ['processing status of draft offer documents', 'https://www.sebi.gov.in/filings/pending-clearances.html'],
];

const FIELD_WORDS = {
  'filing date': /filing\s*date|date of filing/i,
  'document links': /\.pdf|draft offer document|red herring prospectus|prospectus/i,
  'lead manager': /lead manager|merchant banker|brlm/i,
};

const attempts = [];
for (const [label, url] of CANDIDATES) {
  const r = await fetchWithRetry(url, { spacingMs: 15_000, attempts: 3 });
  const rec = { what: label, url, status: r.status, ok: r.ok, bytes: r.size, attempts: r.attempts, error: r.error };
  if (r.ok && r.body) {
    const text = String(r.body).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
    rec.fixture = saveFixture(`sebi/${label.replace(/[^a-z0-9]+/gi, '-')}.html`, r.body);
    const carries = Object.entries(FIELD_WORDS).filter(([, re]) => re.test(text)).map(([k]) => k);
    rec.reads = carries.length ? `carries: ${carries.join(', ')}` : 'carries nothing readable / blocked (page fetched but none of the target fields matched)';
    // A bot-mitigation page (Cloudflare/Akamai challenge) returns 200 but is not the real page.
    if (/enable javascript|checking your browser|attention required|captcha/i.test(text)) {
      rec.reads = 'blocked — bot-mitigation challenge page, not the real listing';
    }
    // A kendo-grid page loads its rows via a separate AJAX call the static fetch never makes; the
    // only hit a naive regex finds on the shell is a NAV LINK's label ("Red Herring Documents filed
    // with ROC"), which is exactly the false-positive class evidence-map.mjs already warns about
    // (a link that mentions the field is not the field). Recorded honestly instead.
    if (r.size < 20_000 && /kendo\.web/i.test(r.body)) {
      rec.reads = 'carries nothing readable — this is a kendo-grid SPA shell; rows load via a client-side AJAX call ' +
        'the static fetch never makes, and the only regex hit was a nav-link label, not filing data';
    }
  } else {
    rec.reads = `unreachable after ${r.attempts} attempt(s) — ${r.error || ('HTTP ' + r.status)}`;
  }
  attempts.push(rec);
}

const out = {
  probe: 'sebi-filing-page',
  generated_at: nowStamp(),
  walkthrough_sebi_filings: filings,
  note: 'No field in Appendix A currently ranks SEBI as a source; this probe establishes whether ' +
        "SEBI's public listing pages carry anything readable to a plain fetch, ahead of any future " +
        'rank change. Individual filing PDFs (DRHP/RHP) are fetched by extract-real-pdf.mjs, not here.',
  attempts,
};
saveOutput('sebi-filing-page', out);

for (const a of attempts) console.log(`${a.ok ? 'OK  ' : 'FAIL'} ${String(a.status).padEnd(4)} ${a.what}\n      -> ${a.reads}`);
console.log('written: sebi-filing-page.out.json');
