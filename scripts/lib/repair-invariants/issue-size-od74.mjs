// Class invariant for scripts/assert-repair-held.mjs (OD-74, item 14, part of #728):
// every ipos row that scraper/scripts/repair-issue-size-chittorgarh-once-od74.ts
// repaired must STILL hold the printed total it wrote. Violations: (a) a row still
// stamped by the tool whose value drifted from the lineage's printedRupees; (b) any
// issueSize provenance row where BSE/NSE/MONEYCONTROL replaced CHITTORGARH (OD-73
// ranks CHITTORGARH above all three, so this must never happen for ANY IPO).
//
// Module form: export default async function(pool) -> { count, details }.
// CLI form: prints the violation count as the LAST stdout line.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL = 'repair-issue-size-chittorgarh-once-od74';

export default async function issueSizeOd74Invariant(pool) {
  const { rows } = await pool.query(
    `SELECT i.slug, i.issue_size::text AS "issueSize", fs.source, fs.updated_by AS "updatedBy",
            fs.data_lineage->>'printedRupees' AS "printedRupees"
       FROM field_sources fs
       JOIN ipos i ON i.id = fs.ipo_id
      WHERE fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
        AND (
              -- (a) a row this tool wrote no longer holds the printed total
              (fs.updated_by = $1 AND i.issue_size IS DISTINCT FROM (fs.data_lineage->>'printedRupees')::numeric)
              -- (b) a lower-ranked source overwrote a CHITTORGARH value (a write-back
              --     replaces the lineage, so (a) alone would go blind; the carried
              --     previous_source is what survives)
           OR (fs.source IN ('BSE','NSE','MONEYCONTROL') AND fs.previous_source = 'CHITTORGARH')
        )
      ORDER BY i.slug`,
    [TOOL]
  );
  return { count: rows.length, details: rows };
}
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const envPath = join(__dirname, '..', '..', '..', 'web', '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  installUtcTimestampParsing();
  const pool = createUtcPool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          ssl: false,
          max: 1,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 1 }
  );
  const result = await issueSizeOd74Invariant(pool);
  await pool.end();
  console.log(JSON.stringify(result.details));
  console.log(result.count);
}
