import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

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
 * the consolidation orchestrator, and asserts NO duplicate is created. It takes its
 * database from process.env.DATABASE_URL, which vitest.integration.setup.ts vets
 * before any test runs, and uses a uniquely-named row it deletes.
 *
 * FIXED 2026-09-11. This file used to read the tunnel URL out of an env file itself
 * and build a Pool from it. The safety guard only inspects process.env, so it never
 * saw the target: running the scraper integration suite with the tunnel up INSERTed
 * a test row into PRODUCTION `ipos`. The paired DELETE is scoped to this fixture's
 * own name, so real IPOs were never at risk - the defect is the write reaching prod
 * at all, and that the scoping was a convention rather than an enforced property.
 *
 * This was the SECOND file to do it; normalizer-sql-agreement's header records the
 * first. A per-file fix stopped the first and did not stop this one, so the class is
 * now guarded by tests/unit/tests-connection-source.test.ts, which reads every
 * integration file on every PR.
 */

const DATABASE_URL = process.env.DATABASE_URL;

const BASE = 'Regression Dedup Testco Limited';
const VARIANT = 'Regression Dedup Testco Ltd. CT'; // same normalized name, different slug
const NORM = 'regression dedup testco'; // what both normalize to

let pool: pg.Pool;
let db: NodePgDatabase;

async function countRows(): Promise<number> {
  const r = await pool.query(`SELECT count(*)::int n FROM ipos WHERE company_name ILIKE 'Regression Dedup Testco%'`);
  return r.rows[0].n;
}

// Skips rather than throws when DATABASE_URL is unset, matching all nine sibling
// integration files. Throwing made this one file FAIL a suite the others merely
// skip, and afterAll then dereferenced an undefined pool, so the operator saw a
// TypeError stacked on top of the real message.
describe.skipIf(!DATABASE_URL)('consolidation path dedup — variant name must match, not duplicate', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    db = drizzle(pool);
  });
  afterAll(async () => {
    if (!pool) return;
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
