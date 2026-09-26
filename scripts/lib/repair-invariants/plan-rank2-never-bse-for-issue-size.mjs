// Class invariant for scripts/assert-repair-held.mjs (item 3 slice S2, #731):
// after repair-plan-rows-to-manifest-version.ts has re-ranked every
// non-terminal `ipo_field_plan` row to the current manifest, no `issue_size`
// plan row should still carry `rank2_source = 'BSE'` -- that value is the
// hand-off shape the card measured on staging BEFORE this slice (454 rows /
// 64 IPOs at version 1, 192 issue-size-family rows with rank2 = BSE). The
// CURRENT manifest ranks `issue_size` [DOC, CHITTORGARH, ...] for every IPO
// type (see scraper/config/field-manifest.json) -- BSE never appears in
// rank2 for this field at the current version. Any row where it still does
// is either a row the repair missed (a regression in the tool) or a fresh
// SUPPLIED-then-requeued row that picked up a stale rank list some other
// way -- either way, a real regression this invariant is built to catch,
// never a false positive: a SUPPLIED row's ranks are frozen at whatever it
// was walked with, so a SUPPLIED issue_size row with rank2=BSE is EXCLUDED
// here (that is the audit trail of what actually happened, not a live
// mis-plan) -- the invariant is scoped to non-terminal rows, the exact
// population the repair tool itself re-ranks.
//
// Two call shapes, same contract as the other invariants in this directory:
//   1. Module form (preferred, in-process): `export default async function(pool)`
//      returning { count, details }.
//   2. CLI form: `node scripts/lib/repair-invariants/plan-rank2-never-bse-for-issue-size.mjs`
//      connects its own pool from DATABASE_URL/DATABASE_* env and prints the
//      violation count as the LAST line of stdout.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';
import { resolveDiscreteDbParams } from '../pg-connection-params.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: Array<{slug: string, tableName: string, rowKey: string, state: string}>}>}
 */
export default async function planRank2NeverBseForIssueSizeInvariant(pool) {
  const { rows } = await pool.query(
    `SELECT i.slug, p.table_name AS "tableName", p.row_key AS "rowKey", p.state
       FROM ipo_field_plan p
       JOIN ipos i ON i.id = p.ipo_id
      WHERE p.field_name = 'issue_size'
        AND p.rank2_source = 'BSE'
        AND p.state <> 'SUPPLIED'
      ORDER BY i.slug`
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
          ...resolveDiscreteDbParams(),
          ssl: false,
          max: 1,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 1 }
  );
  const result = await planRank2NeverBseForIssueSizeInvariant(pool);
  await pool.end();
  console.log(JSON.stringify(result.details));
  console.log(result.count);
}
