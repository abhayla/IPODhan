#!/usr/bin/env node
// docs/design/probes/item45-reread-volume.mjs — item 45 (OD-164(g), §2.5.6 item 7): how many stored offer
// documents an extractor version bump to @2026-10-03 would re-read, by type, by IPO window and by whether the
// file is likely still on disk. Read-only (staging). Prints no connection details.
//
// File presence is NOT in the database: `purgeIpoDocuments` deletes the IPO's directory and touches no row
// (document-store.ts). So "file likely present" is DERIVED from the purge rule (OD-32, decidePurge): an IPO not
// yet closed, or whose latest successful extraction is within the 7-day retention window, keeps its files.
// Anything else is labelled "likely purged". The on-disk truth is only knowable on the VPS.
import { openReadOnlyPool } from './_lib.mjs';

const NEW_VERSION = 'extract_filing.py@2026-10-03';
const CHANGED_TYPES = ['RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD'];
const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows } = await pool.query(`
    with latest as (
      select ipo_id, max(extracted_at) as latest_extracted_at from documents
       where extraction_status = 'COMPLETED' group by ipo_id
    )
    select d.type::text as type,
           d.extraction_status as status,
           coalesce(dfs.extractor_version, '(none)') as version,
           case when upper(i.status::text) <> 'LISTED' then 'live'
                when i.listing_date is not null and i.listing_date >= (now() at time zone 'Asia/Kolkata')::date - 10 then 'live'
                else 'outside' end as win,
           case when d.sha256 is null then 'no-sha'
                when d.purged_unread then 'purged-unread'
                when i.close_date is null or i.close_date >= (now() at time zone 'Asia/Kolkata')::date then 'likely-present'
                when l.latest_extracted_at >= now() - interval '7 days' then 'likely-present'
                else 'likely-purged' end as file,
           count(*)::int as n
      from documents d
      join ipos i on i.id = d.ipo_id
      left join latest l on l.ipo_id = d.ipo_id
      left join document_fetch_state dfs on dfs.document_id = d.id
     where d.type::text = any($1)
     group by 1,2,3,4,5
     order by 1,2,3,4,5`, [CHANGED_TYPES]);
  const out = { measured_at: new Date().toISOString(), db: 'ipodhan_staging', newVersion: NEW_VERSION, rows };
  // Re-read eligible after the bump: COMPLETED, version below the new one, file likely present.
  const eligible = rows.filter((r) => r.status === 'COMPLETED' && r.version < NEW_VERSION && r.file === 'likely-present');
  const byType = {};
  for (const r of eligible) {
    byType[r.type] ??= { live: 0, outside: 0 };
    byType[r.type][r.win] += r.n;
  }
  out.eligibleLikelyPresentByType = byType;
  const liveTotal = Object.values(byType).reduce((s, v) => s + v.live, 0);
  out.liveEligibleTotal = liveTotal;
  console.log(JSON.stringify(out, null, 2));
} finally { await pool.end(); }
