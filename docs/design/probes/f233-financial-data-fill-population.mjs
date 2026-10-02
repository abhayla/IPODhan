#!/usr/bin/env node
// F-233 population probe (read-only, ipodhan_staging): financial_data plan rows the walk would now
// fill -- a SUPPLIED answer recorded on the plan row while the stored column is empty -- plus the
// rows refused today as MISSING_ROW_KEY, and stored values with no field_sources row (untracked).
// Usage: node docs/design/probes/f233-financial-data-fill-population.mjs
import { openReadOnlyPool, saveOutput, nowStamp, causeOf } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const missingRowKey = await pool.query(`
    SELECT count(*)::int AS rows, count(DISTINCT ipo_id)::int AS ipos
    FROM ipo_field_plan WHERE table_name = 'financial_data' AND cause LIKE '%MISSING_ROW_KEY%'`);

  const fill = await pool.query(`
    WITH p AS (
      SELECT p.ipo_id, p.field_name, i.status,
             (SELECT a->>'source' FROM jsonb_array_elements(COALESCE(p.answers, '[]'::jsonb)) a
               WHERE a->>'outcome' = 'SUPPLIED' ORDER BY (a->>'rank')::int LIMIT 1) AS supplier,
             to_jsonb(fd) ->> p.field_name AS stored
      FROM ipo_field_plan p
      JOIN ipos i ON i.id = p.ipo_id
      LEFT JOIN financial_data fd ON fd.ipo_id = p.ipo_id
      WHERE p.table_name = 'financial_data')
    SELECT supplier, status, count(*)::int AS fields, count(DISTINCT ipo_id)::int AS ipos
    FROM p WHERE supplier IS NOT NULL AND stored IS NULL
    GROUP BY supplier, status ORDER BY fields DESC`);

  const sample = await pool.query(`
    SELECT i.slug, p.field_name,
           (SELECT a->>'value' FROM jsonb_array_elements(COALESCE(p.answers, '[]'::jsonb)) a
             WHERE a->>'outcome' = 'SUPPLIED' ORDER BY (a->>'rank')::int LIMIT 1) AS supplied_value
    FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
    LEFT JOIN financial_data fd ON fd.ipo_id = p.ipo_id
    WHERE p.table_name = 'financial_data' AND to_jsonb(fd) ->> p.field_name IS NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.answers, '[]'::jsonb)) a WHERE a->>'outcome' = 'SUPPLIED')
    ORDER BY i.slug, p.field_name LIMIT 8`);

  const storedNoProvenance = await pool.query(`
    SELECT count(*)::int AS fields, count(DISTINCT p.ipo_id)::int AS ipos
    FROM ipo_field_plan p JOIN financial_data fd ON fd.ipo_id = p.ipo_id
    WHERE p.table_name = 'financial_data' AND to_jsonb(fd) ->> p.field_name IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM field_sources s WHERE s.ipo_id = p.ipo_id AND s.table_name = 'financial_data'
                        AND s.row_key = '' AND lower(s.field_name) = replace(p.field_name, '_', ''))`);

  const dupRows = await pool.query(`SELECT count(*)::int AS n FROM (SELECT ipo_id FROM financial_data GROUP BY ipo_id HAVING count(*) > 1) d`);

  const out = {
    measured_at: nowStamp(),
    database: 'ipodhan_staging',
    plan_rows_refused_missing_row_key: missingRowKey.rows[0],
    would_fill_by_supplier_status: fill.rows,
    would_fill_sample: sample.rows,
    stored_values_without_provenance: storedNoProvenance.rows[0],
    ipos_with_two_financial_data_rows: dupRows.rows[0].n,
  };
  saveOutput('f233-financial-data-fill-population', out);
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.error('probe failed:', causeOf(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
