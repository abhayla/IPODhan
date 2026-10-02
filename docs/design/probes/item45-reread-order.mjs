#!/usr/bin/env node
// docs/design/probes/item45-reread-order.mjs — PR #1472 round 1: where NSE's RHP/DRHP sits in the item 45
// re-read order, and how many IPOs are ahead of it. Read-only (staging). Prints no connection details.
// Run from scraper/ (it imports the REAL purge projection): npx tsx ../docs/design/probes/item45-reread-order.mjs
//
// The order is the cycle's: IPOs holding a re-read (COMPLETED filing-type document below its re-read floor),
// ranked by `projectPurgeDueAt` over the purge's own inputs (PURGE_INPUTS_SELECT_SQL, read out of
// document-cycle.ts's source so the probe cannot drift from it), never-purging after, ties to the most
// recently closed. File presence is NOT in the database (the purge deletes the directory and touches no row),
// so `purgeDueNow` means "already purged, or purged on the next run" (the cycle skips a missing file).
import { readFileSync } from 'node:fs';
import { openReadOnlyPool } from './_lib.mjs';
import { projectPurgeDueAt } from '../../../scraper/src/services/document-store.ts';

const FLOOR = 'extract_filing.py@2026-10-03';
const TYPES = ['RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD'];
const src = readFileSync(new URL('../../../scraper/src/services/document-cycle.ts', import.meta.url), 'utf8');
const select = /export const PURGE_INPUTS_SELECT_SQL = `([\s\S]*?)`;/.exec(src)?.[1];
if (!select) throw new Error('PURGE_INPUTS_SELECT_SQL not found in document-cycle.ts');

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const now = new Date();
  const docs = (await pool.query(`
    select i.id, i.slug, i.close_date::text as close_date, d.type::text as type,
           coalesce((select s.extractor_version from document_fetch_state s where s.document_id = d.id limit 1),
                    (select s.extractor_version from document_fetch_state s
                      where s.ipo_id = d.ipo_id and s.doc_type::text = d.type::text limit 1)) as version
      from documents d join ipos i on i.id = d.ipo_id
     where d.extraction_status = 'COMPLETED' and d.purged_unread = false and d.sha256 is not null
       and d.type::text = any($1)`, [TYPES])).rows;
  const pending = docs.filter((r) => !r.version || r.version < FLOOR);
  const ids = [...new Set(pending.map((r) => r.id))];
  const inputs = (await pool.query(`${select} where i.id = any($1::uuid[]) group by i.id, i.close_date, i.status`, [ids])).rows;
  const byId = new Map(inputs.map((r) => [String(r.id), r]));
  const ranked = ids.map((id) => {
    const r = byId.get(id);
    const due = r ? projectPurgeDueAt({
      closeDate: r.close_date, withdrawn: String(r.status).toUpperCase() === 'WITHDRAWN',
      unreadCount: Number(r.unread_count), textlessCount: Number(r.textless_count),
      latestExtractedAt: r.latest_extracted_at, documentCount: Number(r.document_count),
      unextractedCount: Number(r.unextracted_count), eligible: r.purge_eligible !== false,
    }, { now }) : null;
    const d = pending.find((p) => p.id === id);
    return {
      slug: d.slug, close: d.close_date, types: pending.filter((p) => p.id === id).map((p) => p.type).sort(),
      purgeDueAt: due ? due.toISOString() : null,
      purgeDueNow: due !== null && due.getTime() <= now.getTime(), // already purged, or purged by the next purge run
    };
  });
  const key = (x) => (x.purgeDueAt ? Date.parse(x.purgeDueAt) : Number.MAX_SAFE_INTEGER);
  ranked.sort((a, b) => key(a) - key(b) || (Date.parse(b.close ?? '') || 0) - (Date.parse(a.close ?? '') || 0));
  const nseIndex = ranked.findIndex((x) => /^nse-|national-stock-exchange/.test(x.slug ?? ''));
  console.log(JSON.stringify({
    measured_at: now.toISOString(), db: 'ipodhan_staging', floor: FLOOR, rereadIpos: ranked.length,
    nse: nseIndex >= 0 ? { rank: nseIndex + 1, aheadOfIt: nseIndex, ...ranked[nseIndex] } : 'not a re-read candidate',
    first10: ranked.slice(0, 10),
  }, null, 2));
} finally { await pool.end(); }
