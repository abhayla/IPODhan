#!/usr/bin/env node
// docs/design/probes/item46-r2-class-sample.mjs — item 46 review round 1 (CLASS): list recent COMPLETED offer
// documents (RHP / DRHP / PROSPECTUS), MAINBOARD and SME, with their public URL, so the fixed table readers can
// be run on real FY2026 documents beyond the two named in round 2. Read-only (staging). Prints no connection
// details.
import { openReadOnlyPool } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows } = await pool.query(
    `select d.id::text as id, d.type::text as type, i.segment::text as segment, i.slug, d.sha256, d.url,
            d.extracted_at
       from documents d join ipos i on i.id = d.ipo_id
      where d.type::text in ('RHP', 'DRHP', 'PROSPECTUS') and d.extraction_status = 'COMPLETED'
        and d.extracted_at >= now() - interval '10 days'
      order by d.extracted_at desc limit 40`);
  for (const r of rows) console.log([r.id.slice(0, 8), r.type, r.segment, r.slug, r.sha256, r.url].join('\t'));
} finally { await pool.end(); }
