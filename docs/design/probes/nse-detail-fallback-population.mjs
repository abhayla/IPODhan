// #1486 proof (2): read-only staging measurement of the NSE plan rows the ipo-detail
// fallback unlocks -- NSE-ranked ipo_field_plan rows of IPOs whose status is past the
// boards (CLOSED/LISTED/WITHDRAWN), grouped by state and cause, plus whether each IPO has
// an ACTIVE NSE_ISSUE source key (the identity the fallback uses; no key = no fallback).
import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
const q = async (s, p = []) => (await pool.query(s, p)).rows;
try {
  const nseRanked = `(p.rank1_source = 'NSE' OR p.rank2_source = 'NSE' OR p.rank3_source = 'NSE')`;
  const byStateCause = await q(`
    SELECT i.status, p.state, LEFT(COALESCE(p.cause, ''), 60) AS cause, COUNT(*)::int AS rows,
           COUNT(DISTINCT p.ipo_id)::int AS ipos
      FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
     WHERE ${nseRanked} AND p.table_name = 'ipos'
       AND p.field_name IN ('price_range_min','price_range_max','open_date','close_date','lot_size','symbol','isin','company_name')
     GROUP BY 1, 2, 3 ORDER BY 1, 2, rows DESC`);
  const boardEmpty = await q(`
    SELECT i.status, COUNT(*)::int AS rows, COUNT(DISTINCT p.ipo_id)::int AS ipos
      FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
     WHERE ${nseRanked} AND p.cause ILIKE '%NSE board empty%' GROUP BY 1 ORDER BY 1`);
  const keyCoverage = await q(`
    SELECT i.status, i.segment,
           COUNT(*)::int AS ipos,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM ipo_source_keys k WHERE k.ipo_id = i.id
                    AND k.source = 'NSE' AND k.key_type = 'NSE_ISSUE' AND k.state = 'ACTIVE'))::int AS with_active_nse_key
      FROM ipos i
     WHERE i.status IN ('CLOSED','LISTED','WITHDRAWN')
       AND EXISTS (SELECT 1 FROM ipo_field_plan p WHERE p.ipo_id = i.id AND ${nseRanked})
     GROUP BY 1, 2 ORDER BY 1, 2`);
  const runwal = await q(`
    SELECT p.field_name, p.state, p.cause, p.reason_code, p.chosen_source
      FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
     WHERE i.slug = 'runwal-enterprises-ltd' AND p.field_name IN ('price_range_min','price_range_max')`);
  const runwalKey = await q(`
    SELECT k.key_value, k.state, k.attrs FROM ipo_source_keys k JOIN ipos i ON i.id = k.ipo_id
     WHERE i.slug = 'runwal-enterprises-ltd' AND k.source = 'NSE'`);
  const out = { measured_at: nowStamp(), byStateCause, boardEmpty, keyCoverage, runwal, runwalKey };
  saveOutput('nse-detail-fallback-population', out);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await pool.end();
}
