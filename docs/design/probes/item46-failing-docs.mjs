#!/usr/bin/env node
// docs/design/probes/item46-failing-docs.mjs — item 46: list the offer documents the nightly checks name as
// failing (issuer_ratio_yield #1179, prospectus_promoters_peers_yield #545), with their public URL, so the
// real table readers can be run on their real text. Read-only (staging). Prints no connection details.
import { openReadOnlyPool } from './_lib.mjs';

const PREFIXES = ['bf258517', 'fbeff8c6', 'f6c3c6aa', 'edc03a70', 'cf004ed6', 'd88fad44', '3cb0ba27', 'f18ffdc8',
  'd236d3f9', '155205ef', '76de3269', '8fb62796', 'fa114839', 'f2a8a255'];
const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows } = await pool.query(
    `select d.id::text as id, d.type::text as type, d.url, i.slug, i.segment::text as segment
       from documents d join ipos i on i.id = d.ipo_id
      where left(d.id::text, 8) = any($1)`, [PREFIXES]);
  for (const r of rows) console.log([r.id.slice(0, 8), r.type, r.segment, r.slug, r.url].join('\t'));
} finally { await pool.end(); }
