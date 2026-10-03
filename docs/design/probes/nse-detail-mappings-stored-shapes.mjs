// Item 43 (NSE ipo-detail mappings): read-only staging sample of how the target columns are
// stored today (by any writer), so each new NSE mapping returns the column's existing shape.
import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
const q = async (s, p = []) => (await pool.query(s, p)).rows;
try {
  const cols = ['upi_cutoff_time', 'ipo_market_timings', 'category_details', 'sub_categories_upi', 'sponsor_banks',
    'tick_size', 'issue_type', 'employee_discount', 'max_retail_subscription', 'max_employee_subscription'];
  const details = {};
  for (const c of cols) {
    details[c] = await q(`SELECT ${c}::text AS v, COUNT(*)::int AS n FROM ipo_details WHERE ${c} IS NOT NULL
                           GROUP BY 1 ORDER BY 2 DESC LIMIT 6`);
  }
  const ipos = {};
  for (const c of ['registrar', 'lead_managers', 'face_value']) {
    ipos[c] = await q(`SELECT ${c}::text AS v, COUNT(*)::int AS n FROM ipos WHERE ${c} IS NOT NULL
                        GROUP BY 1 ORDER BY 2 DESC LIMIT 4`);
  }
  const out = { measured_at: nowStamp(), details, ipos };
  saveOutput('nse-detail-mappings-stored-shapes', out);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await pool.end();
}
