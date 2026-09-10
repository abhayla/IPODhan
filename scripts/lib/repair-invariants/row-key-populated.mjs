// Invariant for scripts/assert-repair-held.mjs (T-466 class): proves the
// normalized_name backfill on promoters, peer_companies and ipo_intermediaries
// (applied to staging ~01:00 IST 2026-09-10) holds across real scraper
// cycles. This is the missing measurement tool named in the S2 row-key
// contract — slice s2's gated unique constraint
// (web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql) is only
// safe to apply once these three tables are provably clean.
//
// A row VIOLATES this invariant if either:
//   1. its normalized_name is null or '' (unbackfilled / a new write path
//      that skipped normalizeCompanyNameForMatching), or
//   2. it participates in a duplicate row-key group — the exact key each
//      table's slice-s2 unique constraint will enforce:
//        - promoters:          (ipo_id, normalized_name)
//        - peer_companies:     (ipo_id, normalized_name)
//        - ipo_intermediaries: (ipo_id, role, normalized_name)
//      ipo_intermediaries is keyed on ROLE too — the staging scan (schema.ts
//      comment on ipoIntermediaries.uniqueIntermediariesIpoRoleNormalizedName)
//      found real, correct collisions like ICICI Bank appearing as both
//      SPONSOR_BANK and PUBLIC_ISSUE_BANK for one IPO. Two distinct roles,
//      two distinct rows — NOT a duplicate. Folding role into the key is
//      what keeps this invariant from wrongly flagging that pair.
//
// Blank normalized_name rows are excluded from the duplicate-group query —
// they are already counted once under rule 1, and grouping on '' would
// otherwise treat every unbackfilled row as one giant fake collision.
//
// Two call shapes, matching the invariant contract:
//   1. Module form (preferred, in-process): `export default async function(pool)`
//      returning { count, details }.
//   2. CLI form: prints the violation count as the LAST line of stdout.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @typedef {{table: string, kind: 'blank'|'duplicate', ipoId: string, key: string, ids: string[]}} ViolationDetail */

async function blankRows(pool, table, nameCol) {
  const { rows } = await pool.query(
    `SELECT id, ipo_id FROM ${table} WHERE normalized_name IS NULL OR normalized_name = ''`
  );
  return rows.map((r) => ({
    table,
    kind: 'blank',
    ipoId: r.ipo_id,
    key: '',
    ids: [r.id],
  }));
}

async function duplicateGroups(pool, table, keyCols) {
  const groupBy = keyCols.join(', ');
  const { rows } = await pool.query(
    `SELECT ${groupBy}, array_agg(id::text) AS ids, count(*) AS c
       FROM ${table}
      WHERE normalized_name IS NOT NULL AND normalized_name <> ''
      GROUP BY ${groupBy}
     HAVING count(*) > 1`
  );
  return rows.map((r) => ({
    table,
    kind: 'duplicate',
    ipoId: r.ipo_id,
    key: keyCols.filter((c) => c !== 'ipo_id').map((c) => r[c]).join(':'),
    ids: r.ids,
  }));
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: ViolationDetail[]}>}
 */
export default async function rowKeyPopulatedInvariant(pool) {
  const details = [
    ...(await blankRows(pool, 'promoters', 'name')),
    ...(await blankRows(pool, 'peer_companies', 'company_name')),
    ...(await blankRows(pool, 'ipo_intermediaries', 'name')),
    ...(await duplicateGroups(pool, 'promoters', ['ipo_id', 'normalized_name'])),
    ...(await duplicateGroups(pool, 'peer_companies', ['ipo_id', 'normalized_name'])),
    ...(await duplicateGroups(pool, 'ipo_intermediaries', ['ipo_id', 'role', 'normalized_name'])),
  ];
  // Count is ROWS in violation, not groups — a 3-row duplicate group is 3
  // violating rows, and blank rows already come one detail per row.
  const count = details.reduce((sum, d) => sum + (d.kind === 'blank' ? 1 : d.ids.length), 0);
  return { count, details };
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
          max: 2,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 2 }
  );
  try {
    const { count, details } = await rowKeyPopulatedInvariant(pool);
    for (const d of details) {
      if (d.kind === 'blank') {
        console.error(`  VIOLATION (blank): ${d.table} id=${d.ids[0]} ipo_id=${d.ipoId} — null/empty normalized_name`);
      } else {
        console.error(`  VIOLATION (duplicate): ${d.table} ipo_id=${d.ipoId} key=${d.key} — ${d.ids.length} rows: ${d.ids.join(', ')}`);
      }
    }
    if (!count) console.error('  ok: promoters, peer_companies, ipo_intermediaries all have a populated, unique row key');
    console.log(String(count));
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: row-key-populated invariant crashed: ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}
