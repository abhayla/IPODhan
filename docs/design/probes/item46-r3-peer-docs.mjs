#!/usr/bin/env node
// docs/design/probes/item46-r3-peer-docs.mjs — item 46 round 3: the offer documents (DRHP/RHP/PROSPECTUS) of the
// IPOs with 0 peers named in the tracker (S. K. Offset, Papadmalji, Vivekanand, Robokidz), plus the stored
// promoters.waca state per offer document, so the real readers can run on their real text. Read-only (staging).
// Prints no connection details.
import { openReadOnlyPool } from './_lib.mjs';

const SLUGS = ['%offset%', '%papadmalji%', '%vivekanand%', '%robokidz%'];
const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows } = await pool.query(
    `select d.id::text as id, d.type::text as type, d.extraction_status::text as st, d.url, i.slug,
            i.segment::text as segment,
            (select count(*) from peer_companies p where p.ipo_id = i.id)::int as peers,
            (select count(*) from promoters p where p.ipo_id = i.id and p.waca is not null)::int as waca
       from documents d join ipos i on i.id = d.ipo_id
      where i.slug ilike any($1) and d.type::text in ('DRHP','RHP','PROSPECTUS')
      order by i.slug, d.type`, [SLUGS]);
  for (const r of rows) console.log([r.id.slice(0, 8), r.type, r.st, r.segment, r.slug, r.peers, r.waca, r.url].join('\t'));
  const w = await pool.query(
    `select d.id::text as id, d.type::text as type, i.slug, i.segment::text as segment, d.url,
            (select count(*) from promoters p where p.ipo_id = i.id and p.waca is not null)::int as waca
       from documents d join ipos i on i.id = d.ipo_id
      where d.type::text in ('RHP','DRHP') and d.extraction_status::text = 'COMPLETED' and d.url ilike 'http%'
      order by d.created_at desc limit 12`);
  console.log('--- recent completed RHP/DRHP');
  for (const r of w.rows) console.log([r.id.slice(0, 8), r.type, r.segment, r.slug, r.waca, r.url].join('\t'));
} finally { await pool.end(); }
