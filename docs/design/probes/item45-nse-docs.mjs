#!/usr/bin/env node
// docs/design/probes/item45-nse-docs.mjs — item 45: where the NSE IPO's offer documents sit for the re-read
// (status, listing date, version, extraction time). Read-only (staging). Prints no connection details.
import { openReadOnlyPool } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const { rows } = await pool.query(`
    select i.status::text as status, i.listing_date, i.close_date, d.type::text as type, d.extraction_status,
           d.extracted_at, dfs.extractor_version, (d.sha256 is not null) as has_sha
      from ipos i join documents d on d.ipo_id = i.id
      left join document_fetch_state dfs on dfs.document_id = d.id
     where i.slug = 'national-stock-exchange-of-india-ltd'
     order by d.type`);
  console.log(JSON.stringify(rows, null, 2));
} finally { await pool.end(); }
