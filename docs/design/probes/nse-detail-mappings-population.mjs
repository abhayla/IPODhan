// Item 43 (NSE ipo-detail mappings) proof: read-only staging measurement of the NSE-ranked plan
// rows for the issueInfo fields the walk's NSE fetcher did not map, grouped by table/field and
// state/cause, plus candidate IPOs (one LISTED mainboard, one SME) with an ACTIVE NSE_ISSUE key
// for the live ipo-detail captures.
import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

const FIELDS = [
  ['ipos', 'registrar'], ['ipos', 'lead_managers'], ['ipos', 'face_value'],
  ['ipo_details', 'issue_type'], ['ipo_details', 'sponsor_banks'], ['ipo_details', 'tick_size'],
  ['ipo_details', 'ipo_market_timings'], ['ipo_details', 'upi_cutoff_time'], ['ipo_details', 'employee_discount'],
  ['ipo_details', 'max_retail_subscription'], ['ipo_details', 'max_employee_subscription'],
  ['ipo_details', 'category_details'], ['ipo_details', 'sub_categories_upi'],
  ['ipo_details', 'face_value'], ['ipo_details', 'lead_managers'],
];

const pool = await openReadOnlyPool('ipodhan_staging');
const q = async (s, p = []) => (await pool.query(s, p)).rows;
try {
  const nseRanked = `(p.rank1_source = 'NSE' OR p.rank2_source = 'NSE' OR p.rank3_source = 'NSE')`;
  const pairs = FIELDS.map(([t, f]) => `('${t}','${f}')`).join(',');
  const byField = await q(`
    SELECT p.table_name, p.field_name, p.state, LEFT(COALESCE(p.cause, ''), 70) AS cause,
           COUNT(*)::int AS rows, COUNT(DISTINCT p.ipo_id)::int AS ipos
      FROM ipo_field_plan p
     WHERE (p.table_name, p.field_name) IN (${pairs})
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, rows DESC`);
  const nseRankedRows = await q(`
    SELECT p.table_name, p.field_name, COUNT(*)::int AS rows
      FROM ipo_field_plan p WHERE ${nseRanked} AND (p.table_name, p.field_name) IN (${pairs})
     GROUP BY 1, 2 ORDER BY 1, 2`);
  const candidates = await q(`
    SELECT i.slug, i.status, i.segment, i.company_name, k.key_value
      FROM ipos i JOIN ipo_source_keys k ON k.ipo_id = i.id
     WHERE k.source = 'NSE' AND k.key_type = 'NSE_ISSUE' AND k.state = 'ACTIVE'
       AND i.status IN ('LISTED','CLOSED','OPEN','UPCOMING')
     ORDER BY i.open_date DESC NULLS LAST LIMIT 25`);
  const out = { measured_at: nowStamp(), nseRankedRows, byField, candidates };
  saveOutput('nse-detail-mappings-population', out);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await pool.end();
}
