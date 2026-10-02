#!/usr/bin/env node
// docs/design/probes/blocked-prospectus-chain.mjs — F-229's evidence (item 44).
//
// WHY. The final Prospectus of most closed/listed IPOs sits BLOCKED_ALL on staging while its own
// rung chain says the exchanges "settled it" and SEBI was never asked. This probe counts those rows
// by type and chain shape, and lists the IPO facts a fetch-only dry run of the discovery runner needs
// (no DB write anywhere: the dry run uses an in-memory state store).
//
// Read-only against staging, through the sanctioned read-only pool. Nothing runs on the VPS.

import { openReadOnlyPool, saveOutput, nowStamp, causeOf } from './_lib.mjs';

const SETTLED = '%skipped:exchanges_settled_it%';

async function main() {
  const pool = await openReadOnlyPool('ipodhan_staging');
  try {
    const byType = (
      await pool.query(
        `SELECT s.doc_type, s.state, count(*)::int AS n,
                count(*) FILTER (WHERE s.last_attempt::text LIKE $1)::int AS chain_settled_by_exchanges
           FROM document_fetch_state s
          WHERE s.doc_type IN ('PROSPECTUS', 'BASIS_OF_ALLOTMENT_AD')
          GROUP BY 1, 2 ORDER BY 1, 2`,
        [SETTLED]
      )
    ).rows;
    const sample = (
      await pool.query(
        `SELECT i.id, i.slug, i.company_name, i.symbol, i.segment, i.status::text AS status, i.bse_ipo_no,
                i.company_website, i.verifier_url, i.close_date::text AS close_date,
                s.attempts, s.attempted_at_stage, s.next_retry_at::text AS next_retry_at
           FROM document_fetch_state s JOIN ipos i ON i.id = s.ipo_id
          WHERE s.doc_type = 'PROSPECTUS' AND s.state = 'BLOCKED_ALL'
            AND s.last_attempt::text LIKE $1
          ORDER BY (i.slug = 'national-stock-exchange-of-india-ltd') DESC, i.close_date DESC NULLS LAST
          LIMIT 4`,
        [SETTLED]
      )
    ).rows;
    // NSE itself, by name (its slug is not the documents folder name), and the chain shapes of the
    // BLOCKED_ALL Prospectus rows whose chain does NOT read settled-by-exchanges.
    const nse = (
      await pool.query(
        `SELECT i.id, i.slug, i.company_name, i.symbol, i.segment, i.status::text AS status, i.bse_ipo_no,
                i.company_website, i.verifier_url, i.close_date::text AS close_date,
                s.state, s.attempts, s.attempted_at_stage, s.next_retry_at::text AS next_retry_at,
                (SELECT a->>'outcome' FROM jsonb_array_elements(s.last_attempt) a
                  WHERE a->>'source' = 'CHAIN' AND a->>'outcome' LIKE 'rungs[PROSPECTUS]%' LIMIT 1) AS chain
           FROM document_fetch_state s JOIN ipos i ON i.id = s.ipo_id
          WHERE s.doc_type = 'PROSPECTUS' AND i.company_name ILIKE '%national stock exchange%'`
      )
    ).rows;
    const otherShapes = (
      await pool.query(
        `SELECT left(regexp_replace(c.chain, '\(.*?\)', '', 'g'), 160) AS chain_shape, count(*)::int AS n
           FROM document_fetch_state s
           CROSS JOIN LATERAL (SELECT a->>'outcome' AS chain FROM jsonb_array_elements(s.last_attempt) a
                                WHERE a->>'source' = 'CHAIN' AND a->>'outcome' LIKE 'rungs[PROSPECTUS]%' LIMIT 1) c
          WHERE s.doc_type = 'PROSPECTUS' AND s.state = 'BLOCKED_ALL'
          GROUP BY 1 ORDER BY 2 DESC LIMIT 8`
      )
    ).rows;
    const out = { measured_at: nowStamp(), database: 'ipodhan_staging', byType, nse, otherShapes, sample };
    saveOutput('blocked-prospectus-chain', out);
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('probe failed:', causeOf(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
