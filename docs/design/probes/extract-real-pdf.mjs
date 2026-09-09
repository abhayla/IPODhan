#!/usr/bin/env node
// docs/design/probes/extract-real-pdf.mjs — run the REAL extractor on a REAL offer document.
//
// WHY. `DOC` is rank 1 on 162 of the 240 fields. Every one of those ranks says "the offer document
// prints this", and until now that sentence rested on reading the extraction contract rather than on
// running the extractor. The lesson that produced this probe is specific and recent: a parser built
// from formats typed from memory sourced 0 of 4 real rows. So this runs `scraper/scripts/
// extract_filing.py` — the same script production spawns (filing-auto-persist.ts:15-16,
// EXTRACTOR_VERSION at :133) — against the actual PDFs of the IPOs we are walking, on the laptop.
//
// The PDFs are fetched from the public URL production itself stored in `documents.url` (SEBI, BSE
// listing, NSE archives). They are written to fixtures/pdf/, which is gitignored: they are evidence
// INPUTS, not repository content. The extraction RESULT is committed — that is the evidence.
//
// Read-only against the database. Nothing runs on the VPS.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openReadOnlyPool, fetchWithRetry, saveOutput, saveFixture, nowStamp, HERE } from './_lib.mjs';

const SLUGS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const WALK = SLUGS.length ? SLUGS : ['asset-reconstruction-company-india-ltd', 'vinod-texworld-ltd'];
const PDF_DIR = path.join(HERE, 'fixtures', 'pdf');
const REPO = path.resolve(HERE, '../../..');
const EXTRACTOR = path.join(REPO, 'scraper', 'scripts', 'extract_filing.py');

// The doc types the python filing extractor understands (filing-auto-persist.ts:135).
const EXTRACTABLE = new Set(['DRHP', 'RHP', 'PROSPECTUS', 'PRICE_BAND_AD', 'CORRIGENDUM']);

fs.mkdirSync(PDF_DIR, { recursive: true });

const pool = await openReadOnlyPool('ipodhan');
let docs;
try {
  docs = (await pool.query(`
    select i.slug, i.segment, i.company_name, d.id, d.type::text as type, d.url, d.file_size,
           d.sha256, d.extraction_status::text as extraction_status
      from ipos i join documents d on d.ipo_id = i.id and d.is_active
     where i.slug = any($1::text[])
     order by i.slug, d.type`, [WALK])).rows;
} finally {
  await pool.end();
}

const runs = [];
for (const d of docs) {
  const rec = { slug: d.slug, segment: d.segment, doc_type: d.type, url: d.url,
                stored_status: d.extraction_status, stored_sha256: d.sha256 };
  if (!EXTRACTABLE.has(d.type)) {
    rec.result = 'SKIPPED — the python filing extractor does not handle this document type';
    runs.push(rec); continue;
  }
  const local = path.join(PDF_DIR, `${d.slug}-${d.type}.pdf`);
  if (!fs.existsSync(local)) {
    const r = await fetchWithRetry(d.url, { binary: true, spacingMs: 20_000, timeoutMs: 120_000 });
    rec.download = { status: r.status, ok: r.ok, bytes: r.size, error: r.error };
    if (!r.ok || !r.body || r.body.length < 1000) {
      rec.result = `DOWNLOAD FAILED — ${r.status}${r.error ? ' ' + r.error : ''}. Recorded as unreachable, not guessed.`;
      runs.push(rec); continue;
    }
    fs.writeFileSync(local, r.body);
  } else {
    rec.download = { status: 'cached', ok: true, bytes: fs.statSync(local).size };
  }
  rec.local_bytes = fs.statSync(local).size;
  const head = fs.readFileSync(local).subarray(0, 5).toString('latin1');
  if (!head.startsWith('%PDF')) {
    rec.result = `NOT A PDF — the stored URL served ${JSON.stringify(head)}. Recorded, not worked around.`;
    runs.push(rec); continue;
  }

  const args = [EXTRACTOR, local, '--doc-type', d.type];
  if (d.segment === 'SME') args.push('--sme');
  args.push('--no-ocr');   // OCR needs a system binary; a text-layer run is the honest laptop baseline
  const t0 = Date.now();
  const p = spawnSync('python', args, { cwd: path.join(REPO, 'scraper'), encoding: 'utf8',
                                        maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  rec.extractor = { version_const: 'extract_filing.py@2026-09-03', args: args.slice(1).map((a) => a.replace(PDF_DIR, '<fixtures/pdf>')),
                    exit: p.status, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  if (p.status !== 0) {
    rec.result = 'EXTRACTOR EXITED NON-ZERO';
    rec.stderr_tail = String(p.stderr || '').split('\n').slice(-8).join('\n');
    runs.push(rec); continue;
  }
  let parsed = null;
  try { parsed = JSON.parse(p.stdout); } catch (e) { rec.parse_error = e.message; }
  if (parsed) {
    rec.fixture = saveFixture(`extraction/${d.slug}-${d.type}.json`, parsed);
    // What did it ACTUALLY produce? Names and non-null-ness, which is what a rank claim needs.
    const flat = {};
    const walk = (o, pre) => {
      for (const [k, v] of Object.entries(o || {})) {
        const key = pre ? `${pre}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
        else flat[key] = Array.isArray(v) ? `[${v.length}]` : v;
      }
    };
    walk(parsed, '');
    rec.produced_keys = Object.keys(flat).length;
    rec.non_null_keys = Object.entries(flat).filter(([, v]) => v !== null && v !== '' && v !== '[0]').map(([k]) => k);
    rec.result = `OK — ${rec.non_null_keys.length} of ${rec.produced_keys} leaf values non-empty`;
  } else {
    rec.result = 'EXTRACTOR PRODUCED NON-JSON STDOUT';
    rec.stdout_head = String(p.stdout || '').slice(0, 400);
  }
  runs.push(rec);
}

const out = {
  probe: 'extract-real-pdf',
  generated_at: nowStamp(),
  extractor: 'scraper/scripts/extract_filing.py (the script production spawns)',
  ocr: 'disabled (--no-ocr): OCR needs a system binary this laptop does not have. A scanned-only ' +
       'document will therefore under-report here; that is stated rather than hidden.',
  pdf_dir: 'docs/design/probes/fixtures/pdf/ (gitignored — evidence input, not repository content)',
  slugs: WALK,
  runs,
};
saveOutput('extract-real-pdf', out);

for (const r of runs) {
  console.log(`${(r.slug + '/' + r.doc_type).padEnd(52)} ${r.result}`);
  if (r.stderr_tail) console.log('    stderr: ' + r.stderr_tail.replace(/\n/g, ' | ').slice(0, 200));
}
console.log('written: extract-real-pdf.out.json');
