#!/usr/bin/env node
// docs/design/probes/reopen-exposure-by-offering-type.mjs — PR #1464 fix round 1 (item 44).
//
// WHY. Item 44 reopens CLOSED/LISTED PROSPECTUS and BASIS_OF_ALLOTMENT_AD rows whose last chain was
// "settled by the exchanges", so the SEBI and company rungs are asked for the first time. A SEBI row
// is matched by company name, so the identity gate (CIN on the cover vs ipos.cin, filing date vs the
// IPO's own dates) decides what may be stored. This probe counts the reopen-exposed rows by
// offering_type and status, and how many of them can be bound by a stored CIN or by stored dates.
//
// Read-only against staging, through the sanctioned read-only pool. Nothing runs on the VPS.

import { openReadOnlyPool, saveOutput, nowStamp, causeOf } from './_lib.mjs';

const SETTLED = '%skipped:exchanges_settled_it%';

async function main() {
  const pool = await openReadOnlyPool('ipodhan_staging');
  try {
    const exposure = (
      await pool.query(
        `SELECT s.doc_type, coalesce(i.offering_type::text, '(null)') AS offering_type, i.status::text AS status,
                count(*)::int AS rows,
                count(*) FILTER (WHERE i.cin IS NOT NULL AND i.cin <> '')::int AS with_cin,
                count(*) FILTER (WHERE i.open_date IS NOT NULL OR i.close_date IS NOT NULL OR i.listing_date IS NOT NULL)::int AS with_dates,
                count(*) FILTER (WHERE (i.cin IS NULL OR i.cin = '')
                                   AND i.open_date IS NULL AND i.close_date IS NULL AND i.listing_date IS NULL)::int AS neither
           FROM document_fetch_state s JOIN ipos i ON i.id = s.ipo_id
          WHERE s.doc_type IN ('PROSPECTUS', 'BASIS_OF_ALLOTMENT_AD')
            AND s.last_attempt::text LIKE $1
            AND i.status::text IN ('CLOSED', 'LISTED')
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        [SETTLED]
      )
    ).rows;
    const nse = (
      await pool.query(
        `SELECT i.slug, i.status::text AS status, coalesce(i.offering_type::text, '(null)') AS offering_type,
                i.cin, i.open_date::text AS open_date, i.close_date::text AS close_date,
                i.listing_date::text AS listing_date
           FROM ipos i WHERE i.company_name ILIKE '%national stock exchange%'`
      )
    ).rows;
    const out = { measured_at: nowStamp(), database: 'ipodhan_staging', exposure, nse };
    saveOutput('reopen-exposure-by-offering-type', out);
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('probe failed:', causeOf(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
