// Class invariant for scripts/assert-repair-held.mjs (OD-74 item 14, part of #728; OD-77).
// Violations:
//  (a) a row still stamped by the tool whose value drifted from the lineage's printedRupees;
//  (b) an IPO the tracked page store (scraper/scripts/data/od74-issue-size/manifest.json
//      `expected`, status WRITE) says must hold the CHITTORGARH printed total, whose issue_size
//      differs from it or whose provenance is no longer CHITTORGARH. Read from the committed
//      manifest, never from the row's lineage: a first lower-ranked write replaces the lineage and
//      a second one replaces previous_source too, so a lineage-based check clears itself (review
//      round 1, MINOR);
//  (c) any ipos row storing issue_size = 0 (OD-77: TENDER/BUYBACK derive NOT_APPLICABLE, the
//      others carry NOT_SOURCED; a stored 0 is never a real issue size).
//
// Module form: default export (pool) -> { count, details }.
// CLI form: prints the violation count as the LAST stdout line.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL = 'repair-issue-size-chittorgarh-once-od74';

export function loadExpected(manifestPath = join(__dirname, '..', '..', '..', 'scraper', 'scripts', 'data', 'od74-issue-size', 'manifest.json')) {
  if (!existsSync(manifestPath)) return [];
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return Object.entries(m.expected ?? {})
    .filter(([, e]) => e.status === 'WRITE' && e.printedRupees !== null)
    .map(([slug, e]) => ({ slug, printedRupees: String(e.printedRupees) }));
}

export default async function issueSizeOd74Invariant(pool, expected = loadExpected()) {
  const { rows } = await pool.query(
    `WITH exp AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(slug text, "printedRupees" text))
     SELECT i.slug, i.issue_size::text AS "issueSize", fs.source::text AS source, fs.updated_by AS "updatedBy", 'a:drifted-from-own-write' AS why
       FROM field_sources fs JOIN ipos i ON i.id = fs.ipo_id
      WHERE fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
        AND fs.updated_by = $1 AND i.issue_size IS DISTINCT FROM (fs.data_lineage->>'printedRupees')::numeric
     UNION ALL
     SELECT i.slug, i.issue_size::text, fs.source::text, fs.updated_by, 'b:not-the-printed-total'
       FROM exp JOIN ipos i ON i.slug = exp.slug
       LEFT JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
      WHERE i.issue_size IS DISTINCT FROM exp."printedRupees"::numeric OR fs.source IS DISTINCT FROM 'CHITTORGARH'
     UNION ALL
     SELECT i.slug, i.issue_size::text, NULL::text, NULL::text, 'c:stored-zero'
       FROM ipos i WHERE i.issue_size = 0
     ORDER BY 1`,
    [TOOL, JSON.stringify(expected)]
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
