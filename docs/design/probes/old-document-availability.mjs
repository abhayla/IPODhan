#!/usr/bin/env node
// docs/design/probes/old-document-availability.mjs — OD-22's mandatory probe.
//
// WHY. The closed-IPO job (§6) walks historical IPOs whose PDFs were deleted by the old seven-day
// purge. Whether those documents can still be downloaded is the single largest unknown in the plan,
// and it is a question about the outside world, so it is answered by downloading — not by reasoning.
//
// It takes LISTED IPOs at three ages (about 1 month, 6 months, 12+ months since listing), four at
// each age, mainboard and SME both represented, and tries the URL production stored in
// `documents.url`. For each attempt it records the HTTP status, the byte size and the first page of
// text, so "it returned 200" can be told apart from "it returned 200 and a login page".
//
// Read-only against the database. Downloads go to a temp directory, never to the repository.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openReadOnlyPool, fetchWithRetry, saveOutput, nowStamp, HERE } from './_lib.mjs';

const PER_AGE = Number(process.env.PER_AGE || 6);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'olddoc-'));
const REPO = path.resolve(HERE, '../../..');

// Bucket edges follow what production actually holds, measured before choosing them: there are only
// six LISTED IPOs older than 400 days and NONE of them has an offer-document row with a URL, so a
// "12+ months" bucket defined by download attempts would have been empty and would have reported
// nothing. The third bucket is therefore 221 days and older, and the URL-COVERAGE table below is the
// finding for the oldest IPOs — you cannot re-download a document whose address you never stored.
const AGES = [
  { label: 'about 1-2 months', min: 20,  max: 70 },
  { label: 'about 3-7 months', min: 71,  max: 220 },
  { label: '7+ months',        min: 221, max: 4000 },
];

const OFFER_TYPES = ['RHP', 'PROSPECTUS', 'DRHP', 'PRICE_BAND_AD'];

const pool = await openReadOnlyPool('ipodhan');
let buckets = [];
try {
  for (const age of AGES) {
    const rows = (await pool.query(`
      select i.slug, i.company_name, i.segment, i.listing_date,
             (current_date - i.listing_date::date) as age_days,
             d.id, d.type::text as type, d.url, d.file_size
        from ipos i join documents d on d.ipo_id = i.id and d.is_active
       where i.status = 'LISTED'
         and i.listing_date is not null
         and (current_date - i.listing_date::date) between $1 and $2
         and d.type::text = any($3::text[])
         and d.url is not null
       order by i.segment, (current_date - i.listing_date::date), i.slug`,
      [age.min, age.max, OFFER_TYPES])).rows;

    // One document per IPO, and both segments represented where the data allows.
    const seen = new Set();
    const picked = [];
    for (const seg of ['MAINBOARD', 'SME']) {
      for (const r of rows.filter((x) => x.segment === seg)) {
        if (seen.has(r.slug)) continue;
        seen.add(r.slug);
        picked.push(r);
          if (picked.filter((p) => p.segment === seg).length >= Math.ceil(PER_AGE / 2)) break;
      }
    }
    buckets.push({ age: age.label, window_days: [age.min, age.max], candidates: rows.length, picked });
  }
} finally {
  await pool.end();
}

const firstPageText = (file) => {
  const p = spawnSync('python', ['-c',
    'import sys,pdfplumber\n' +
    'try:\n' +
    '  with pdfplumber.open(sys.argv[1]) as d:\n' +
    '    print((d.pages[0].extract_text() or "")[:600])\n' +
    'except Exception as e:\n' +
    '  print("PDF_OPEN_FAILED: %s" % e)\n', file], { encoding: 'utf8', timeout: 120_000 });
  return String(p.stdout || p.stderr || '').replace(/\s+/g, ' ').trim().slice(0, 600);
};

const host = (u) => { try { return new URL(u).host; } catch { return '(unparseable)'; } };

for (const b of buckets) {
  for (const d of b.picked) {
    const r = await fetchWithRetry(d.url, { binary: true, spacingMs: 30_000, attempts: 3, timeoutMs: 120_000 });
    d.attempt = { host: host(d.url), status: r.status, ok: r.ok, bytes: r.size, attempts: r.attempts, error: r.error };
    if (r.ok && r.body && r.body.length > 500) {
      const head = r.body.subarray(0, 5).toString('latin1');
      d.attempt.is_pdf = head.startsWith('%PDF');
      // NSE's archive serves offer documents as ZIP, not PDF. A first version of this probe called
      // that "NOT A PDF" and scored three obtainable documents as failures. The document IS there;
      // it is in a container, and any re-download path has to unzip. That is a design fact, not a
      // download failure.
      d.attempt.is_zip = head.startsWith('PK');
      if (d.attempt.is_zip) {
        d.attempt.verdict = 'OBTAINABLE (ZIP — the archive serves a container, the re-download path must unzip)';
      } else if (d.attempt.is_pdf) {
        const f = path.join(TMP, `${d.slug}-${d.type}.pdf`);
        fs.writeFileSync(f, r.body);
        d.attempt.first_page_text = firstPageText(f);
        d.attempt.verdict = /PDF_OPEN_FAILED/.test(d.attempt.first_page_text) ? 'CORRUPT'
          : (d.attempt.first_page_text.length > 80 ? 'OBTAINABLE' : 'PDF WITH NO TEXT LAYER (scan)');
      } else {
        d.attempt.verdict = 'NOT A PDF — served ' + JSON.stringify(head) + ' (a login or error page returns 200 too)';
        d.attempt.body_head = r.body.subarray(0, 200).toString('utf8').replace(/\s+/g, ' ');
      }
    } else {
      d.attempt.verdict = r.ok ? 'EMPTY/TINY RESPONSE' : `UNREACHABLE (${r.status}${r.error ? ' ' + r.error : ''})`;
    }
  }
}

// The question behind the question: for how many LISTED IPOs do we even HOLD an address to retry?
const pool2 = await openReadOnlyPool('ipodhan');
let coverage;
try {
  coverage = (await pool2.query(`
    select case when (current_date - i.listing_date::date) between 20 and 70   then 'about 1-2 months'
                when (current_date - i.listing_date::date) between 71 and 220  then 'about 3-7 months'
                when (current_date - i.listing_date::date) > 220               then '7+ months'
                else 'listed under 20 days ago' end as age_bucket,
           i.segment,
           count(distinct i.id) as listed_ipos,
           count(distinct i.id) filter (where d.id is not null) as ipos_with_an_offer_document_url
      from ipos i
      left join documents d on d.ipo_id = i.id and d.is_active and d.url is not null
        and d.type::text = any($1::text[])
     where i.status = 'LISTED' and i.listing_date is not null
     group by 1, 2 order by 1, 2`, [OFFER_TYPES])).rows
    .map((r) => ({ age_bucket: r.age_bucket, segment: r.segment,
                   listed_ipos: Number(r.listed_ipos),
                   ipos_with_an_offer_document_url: Number(r.ipos_with_an_offer_document_url) }));
} finally { await pool2.end(); }

const flat = buckets.flatMap((b) => b.picked.map((d) => ({ age: b.age, ...d })));
const summary = {};
for (const d of flat) {
  const key = `${d.attempt.host} | ${d.age}`;
  summary[key] = summary[key] || { attempted: 0, obtainable: 0, verdicts: {} };
  summary[key].attempted++;
  if (String(d.attempt.verdict).startsWith('OBTAINABLE')) summary[key].obtainable++;
  summary[key].verdicts[d.attempt.verdict] = (summary[key].verdicts[d.attempt.verdict] || 0) + 1;
}

const out = {
  probe: 'old-document-availability',
  generated_at: nowStamp(),
  question: 'For IPOs that already lost their local files to the seven-day purge, is the offer ' +
            'document still downloadable from the URL we stored?',
  method: 'LISTED IPOs at three ages, both segments, the URL from documents.url, three attempts, ' +
          'then the first page of text so a 200 that is really a login page is not counted as success.',
  per_age_target: PER_AGE,
  attempted: flat.length,
  obtainable: flat.filter((d) => String(d.attempt.verdict).startsWith('OBTAINABLE')).length,
  url_coverage: {
    question: 'Before asking whether an old document can be re-downloaded, ask whether we stored an ' +
              'address for it at all. A LISTED IPO with no offer-document URL cannot be retried; its ' +
              'document has to be DISCOVERED again from NSE, BSE or SEBI.',
    rows: coverage,
  },
  by_host_and_age: summary,
  documents: flat.map((d) => ({ age: d.age, slug: d.slug, segment: d.segment, age_days: Number(d.age_days),
    type: d.type, url: d.url, attempt: d.attempt })),
};
saveOutput('old-document-availability', out);

console.log(`attempted ${out.attempted}, obtainable ${out.obtainable}`);
for (const [k, v] of Object.entries(summary)) {
  console.log(`  ${k.padEnd(46)} ${v.obtainable}/${v.attempted}  ${Object.entries(v.verdicts).map(([a, b]) => a + ' x' + b).join(', ')}`);
}
console.log('URL coverage (LISTED IPOs that hold an offer-document address at all):');
for (const c of coverage) {
  console.log(`  ${c.age_bucket.padEnd(24)} ${String(c.segment).padEnd(10)} ${c.ipos_with_an_offer_document_url}/${c.listed_ipos}`);
}
console.log('written: old-document-availability.out.json');
