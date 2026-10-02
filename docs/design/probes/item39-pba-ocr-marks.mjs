#!/usr/bin/env node
// docs/design/probes/item39-pba-ocr-marks.mjs — PR #1483 round 2: which stored PRICE_BAND_AD reads came from
// OCR (document_field_receipts.source_text), so the 76-advert re-run can be judged in the mode each document
// is really read in. Read-only (staging). Prints no connection details.
import { openReadOnlyPool } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows } = await pool.query(`
    select i.slug, left(d.id::text, 8) as doc, string_agg(distinct r.source_text, ',') as marks, count(*)::int as receipts
      from documents d join ipos i on i.id = d.ipo_id
      left join document_field_receipts r on r.document_id = d.id
     where d.type::text = 'PRICE_BAND_AD'
     group by i.slug, d.id order by i.slug`);
  console.log(JSON.stringify(rows));
} finally { await pool.end(); }
