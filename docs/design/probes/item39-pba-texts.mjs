#!/usr/bin/env node
// docs/design/probes/item39-pba-texts.mjs — item 39 round 2 / #1477: every stored PRICE_BAND_AD's page
// texts (document_pages) with the IPO's segment, lot size and stored band, so the cover reader and the
// OCR lost-leading-digit guard can be run on real adverts. Read-only (staging). Prints no connection details.
// Usage: node docs/design/probes/item39-pba-texts.mjs <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import { openReadOnlyPool } from './_lib.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: item39-pba-texts.mjs <out-dir>');
fs.mkdirSync(out, { recursive: true });
const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows: docs } = await pool.query(`
    select d.id, d.url, d.type::text as type, i.slug, i.segment::text as segment, i.lot_size,
           i.price_range_min, i.price_range_max, i.issue_size, d.extraction_status
      from documents d join ipos i on i.id = d.ipo_id
     where d.type::text in ('PRICE_BAND_AD')
       and exists (select 1 from document_pages p where p.document_id = d.id)
     order by i.slug`);
  const index = [];
  for (const d of docs) {
    const { rows: pages } = await pool.query(
      'select page_number, text from document_pages where document_id = $1 order by page_number', [d.id]);
    const file = `${d.slug}__${d.id.slice(0, 8)}.json`;
    fs.writeFileSync(path.join(out, file), JSON.stringify(pages.map((p) => [p.page_number, p.text])));
    index.push({ ...d, pages: pages.length, file });
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`${index.length} PRICE_BAND_AD documents with stored pages`);
} finally { await pool.end(); }
