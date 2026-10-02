#!/usr/bin/env node
// docs/design/probes/item46-r2-ratio-evidence.mjs — item 46 round 2: for the documents issuer_ratio_yield
// reports as "no current_ratio and no recorded reason", show which document last wrote the IPO's single E9
// step row (input_ref) and whether that row carries ratioReasons, next to every offer document of the IPO.
// Read-only (staging). Prints no connection details.
import { openReadOnlyPool } from './_lib.mjs';

const PREFIXES = ['fbeff8c6', 'f6c3c6aa', 'edc03a70', 'cf004ed6', 'f18ffdc8', 'bf258517'];
const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows } = await pool.query(
    `select i.slug, d.id::text as doc, d.type::text as type, d.extracted_at, d.url,
            s.input_ref, s.last_run_at, s.source,
            (s.evidence ? 'ratioReasons') as has_reasons, (s.evidence ? 'ratioRead') as has_read,
            s.evidence->'ratioReasons' as reasons
       from documents d join ipos i on i.id = d.ipo_id
       left join ipo_pipeline_steps s on s.ipo_id = d.ipo_id and s.step_id = 'E9'
      where d.ipo_id in (select ipo_id from documents where left(id::text, 8) = any($1))
        and d.extraction_status = 'COMPLETED'
      order by i.slug, d.extracted_at`, [PREFIXES]);
  for (const r of rows) {
    console.log([r.slug, r.doc.slice(0, 8), r.type, r.extracted_at?.toISOString?.() ?? r.extracted_at,
      'E9 input_ref=' + r.input_ref, 'E9 at=' + (r.last_run_at?.toISOString?.() ?? r.last_run_at),
      'reasons=' + r.has_reasons, JSON.stringify(r.reasons), r.type !== 'PRICE_BAND_AD' ? r.url : ''].join('\t'));
  }
} finally { await pool.end(); }
