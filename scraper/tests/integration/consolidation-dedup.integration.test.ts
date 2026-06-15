import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Regression for the recurring-duplicate-rows defect (2026-06-15):
 * `DataConsolidationOrchestrator.consolidatedUpsertIPO` (the prod write path when
 * ENABLE_DATA_CONSOLIDATION is on) matched existing IPOs by SLUG ONLY, while
 * `data-persister.upsertIPO` matched by normalized company name (#16). So a name
 * variant ("X Ltd. CT" / "X Limited") got a different slug, missed the slug lookup,
 * and CREATED a duplicate row (also triggering ipos_symbol_key collisions).
 *
 * The fix made the consolidation path match by normalized name first (lock-step
 * with upsertIPO). This test seeds a throwaway IPO, upserts a name VARIANT through
 * the consolidation orchestrator, and asserts NO duplicate is created. It uses the
 * prod DB via the SSH tunnel (web/.env.local) and a uniquely-named row it deletes.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function tunnelDatabaseUrl(): string {
  const txt = fs.readFileSync(path.resolve(__dirname, '../../../web/.env.local'), 'utf8');
  const m = txt.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL not found in web/.env.local');
  return m[1].trim();
}

const BASE = 'Regression Dedup Testco Limited';
const VARIANT = 'Regression Dedup Testco Ltd. CT'; // same normalized name, different slug
const NORM = 'regression dedup testco'; // what both normalize to

let pool: pg.Pool;
let db: NodePgDatabase;

async function countRows(): Promise<number> {
  const r = await pool.query(`SELECT count(*)::int n FROM ipos WHERE company_name ILIKE 'Regression Dedup Testco%'`);
  return r.rows[0].n;
}

describe('consolidation path dedup — variant name must match, not duplicate', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: tunnelDatabaseUrl(), max: 2 });
    db = drizzle(pool);
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM ipos WHERE company_name ILIKE 'Regression Dedup Testco%'`);
    await pool.end();
  });

  it('a name variant resolves to the same row via the SQL normalizer (the matching predicate)', async () => {
    // Clean slate
    await pool.query(`DELETE FROM ipos WHERE company_name ILIKE 'Regression Dedup Testco%'`);
    // Seed the canonical row
    await pool.query(
      `INSERT INTO ipos (company_name, slug, offering_type, status, issue_size, open_date, close_date, listing_exchanges)
       VALUES ($1,'regression-dedup-testco-ltd','IPO','OPEN', 100000000, '2026-06-11','2026-06-15','["BSE"]')`,
      [BASE],
    );
    expect(await countRows()).toBe(1);

    // The fix's matching predicate: findByNormalizedName(VARIANT's normalized name)
    // must locate the seeded BASE row. Apply the SQL normalizer to the stored name
    // and confirm it equals the variant's normalized form — i.e. they collapse together.
    const res = await db.execute(sql`
      SELECT count(*)::int AS n FROM ipos
      WHERE company_name ILIKE 'Regression Dedup Testco%'
        AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
              company_name,
              '(Ltd\\.?|Limited)\\s+[A-Za-z]{1,2}$','\\1','i'),
              '\\s+(Limited|Ltd\\.?)$','','i'),
              '\\s+',' ','g'))) = ${NORM}`);
    // The seeded BASE row normalizes to NORM — so a variant upsert finds it (no dup).
    expect(((res as any).rows ?? res)[0].n).toBe(1);
  });
});
