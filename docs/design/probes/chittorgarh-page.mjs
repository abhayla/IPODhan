#!/usr/bin/env node
// docs/design/probes/chittorgarh-page.mjs — what the Chittorgarh detail page carries, and whether
// the page we get back is the IPO we asked for (§2.3.1).
//
// WHY. Chittorgarh is rank 2 on 47 fields — nearly all of financial_data, financial_statements,
// peer_companies, plus market cap, P/E, promoters, sector and description. Under the pull model,
// rank 2 stops being theoretical: it is the path taken every time an extraction fails its check. So
// two things have to be true and neither was ever tested: the page carries those fields, and the
// page belongs to this company.
//
// Read-only. It reads `ipos.verifier_url` from production (never constructs a URL from a slug, which
// is the failure mode §2.3.1 exists to stop) and it re-runs the slug-is-ignored experiment.

import { openReadOnlyPool, fetchWithRetry, saveFixture, saveOutput, nowStamp } from './_lib.mjs';

const SLUGS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const WALK = SLUGS.length ? SLUGS : ['asset-reconstruction-company-india-ltd', 'vinod-texworld-ltd'];
const REFERER = 'https://www.chittorgarh.com/';

const pool = await openReadOnlyPool('ipodhan');
let stored;
try {
  stored = (await pool.query(
    `select slug, company_name, verifier_url from ipos where slug = any($1::text[])`, [WALK])).rows;
} finally {
  await pool.end();
}

const attempts = [];
const pages = [];

// Does the page name the company we asked for? The normaliser the design cites is in scraper code;
// here we use the same shape of comparison (case-folded, punctuation and corporate-form words
// dropped) so the probe's verdict means what the design's rule means.
const norm = (s) => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9 ]+/g, ' ')
  .replace(/\b(LIMITED|LTD|PRIVATE|PVT|INDIA|COMPANY|CO|CORPORATION|CORP|THE|AND)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

for (const row of stored) {
  const url = row.verifier_url;
  const rec = { slug: row.slug, company_name: row.company_name, verifier_url: url };
  if (!url) {
    rec.result = 'NO STORED URL — this IPO is one of the 114 with no verifier_url; the pull loop would have to rediscover it from the listing page, never build one from the slug';
    pages.push(rec);
    continue;
  }
  const r = await fetchWithRetry(url, { headers: { Referer: REFERER }, spacingMs: 20_000 });
  rec.status = r.status; rec.ok = r.ok; rec.bytes = r.size; rec.error = r.error;
  if (r.ok && r.body) {
    rec.fixture = saveFixture(`chittorgarh/${row.slug}.html`, r.body);
    const title = (r.body.match(/<title>([^<]*)<\/title>/i) || [, ''])[1].trim();
    const h1 = (r.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1].replace(/<[^>]+>/g, ' ').trim();
    rec.title = title; rec.h1 = h1;
    const want = norm(row.company_name);
    const got = norm(title + ' ' + h1);
    rec.identity_match = want.length > 0 && got.includes(want.split(' ')[0]) &&
      want.split(' ').filter((w) => w.length > 2).every((w) => got.includes(w));
    // Which of the labels the ranks depend on are actually on the page?
    const has = (re) => re.test(r.body);
    rec.labels_present = {
      financials_restated_table: has(/Financials?\s*\(Restated/i) || has(/financialTable/i),
      amount_unit_footer: has(/Amount in Rs/i),
      market_cap: has(/Market Cap/i),
      pe_ratio_own: has(/Post[- ]?issue\s*(EPS|P\/E)/i),
      peer_table: has(/Peer Group|Peer Comparison/i),
      promoters: has(/Company Promoters|Promoters? of/i),
      registrar: has(/Registrar/i),
      lead_managers: has(/Lead Manager|Book Running/i),
      objects_of_issue: has(/Objects? of the Issue/i),
      sector_or_about: has(/About\s+.{0,60}Limited|Company Profile/i),
      lot_size: has(/Lot Size/i),
      price_band: has(/Price Band/i),
      pbv_ratio: has(/P\/BV|Price to Book/i),
    };
  }
  pages.push(rec);
  attempts.push({ what: `detail page ${row.slug}`, url, status: r.status, ok: r.ok, bytes: r.size });
}

// The §2.3.1 experiment, re-run rather than remembered: keep a real page's NUMBER, replace its SLUG.
let slugExperiment = null;
const withUrl = pages.find((p) => p.ok && /\/ipo\/[^/]+\/\d+\/?$/.test(p.verifier_url || ''));
if (withUrl) {
  const wrong = withUrl.verifier_url.replace(/\/ipo\/[^/]+\//, '/ipo/this-company-does-not-exist-ipo/');
  const r = await fetchWithRetry(wrong, { headers: { Referer: REFERER }, spacingMs: 20_000, attempts: 1 });
  const title = r.ok ? (r.body.match(/<title>([^<]*)<\/title>/i) || [, ''])[1].trim() : null;
  slugExperiment = {
    real_url: withUrl.verifier_url, tampered_url: wrong, status: r.status, ok: r.ok,
    title_returned: title,
    slug_is_ignored: !!(r.ok && title && title === withUrl.title),
    verdict: r.ok
      ? 'the site served a 200 for a slug that does not exist — only the number identifies the page'
      : `the site returned ${r.status} for the tampered slug`,
  };
  if (r.ok) saveFixture('chittorgarh/slug-ignored-experiment.html', r.body);
}

const out = {
  probe: 'chittorgarh-page',
  generated_at: nowStamp(),
  note: 'URLs come from ipos.verifier_url on production. A URL is never built from a slug: ' +
        'the slug segment is ignored by the site, so a constructed URL can serve another company at 200.',
  pages,
  slug_experiment: slugExperiment,
  attempts,
};
saveOutput('chittorgarh-page', out);

for (const p of pages) {
  console.log(`${p.ok ? 'OK  ' : (p.result ? 'SKIP' : 'FAIL')} ${String(p.status ?? '-').padEnd(4)} ${p.slug}`);
  if (p.result) console.log('      ' + p.result);
  if (p.ok) {
    console.log(`      title: ${p.title}`);
    console.log(`      identity match: ${p.identity_match}`);
    const yes = Object.entries(p.labels_present).filter(([, v]) => v).map(([k]) => k);
    const no = Object.entries(p.labels_present).filter(([, v]) => !v).map(([k]) => k);
    console.log(`      carries: ${yes.join(', ') || 'nothing recognised'}`);
    console.log(`      absent : ${no.join(', ') || 'none'}`);
  }
}
if (slugExperiment) console.log(`slug experiment: ${slugExperiment.verdict} (slug_is_ignored=${slugExperiment.slug_is_ignored})`);
console.log('written: chittorgarh-page.out.json');
