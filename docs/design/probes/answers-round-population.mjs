#!/usr/bin/env node
// Read-only (#1493): the OD-163 answers-only round population on ipodhan_staging, by status and offering type.
import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const byStatus = await pool.query(`
    SELECT upper(i.status::text) AS status, i.offering_type, (i.hidden_at IS NOT NULL) AS hidden,
           count(*)::int AS ipos,
           count(*) FILTER (WHERE i.answers_round_at IS NULL)::int AS round_null,
           count(*) FILTER (WHERE i.answers_round_at IS NULL AND EXISTS (
             SELECT 1 FROM field_sources f WHERE f.ipo_id = i.id
               AND (f.witnesses IS NULL OR jsonb_array_length(f.witnesses) = 0)))::int AS round_null_with_unanswered,
           count(*) FILTER (WHERE i.answers_round_at IS NULL AND i.close_date < CURRENT_DATE)::int AS round_null_closed_past
      FROM ipos i
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);
  const out = { measuredAt: nowStamp(), byStatus: byStatus.rows };
  saveOutput('answers-round-population', out);
  console.log(JSON.stringify(out, null, 2));
} finally {
  await pool.end();
}
