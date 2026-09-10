// implements: item-1-slice-s2 (pull-model implementation loop)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Relative import, NOT the `@ipodhan/shared` package alias — see the same
// note in child-table-normalized-name.integration.test.ts (worktree
// node_modules junctions resolve the alias back to the PRIMARY checkout).
import * as schema from '../../../packages/shared/src/db/schema';
import { normalizeCompanyNameForMatching } from '../../../packages/shared/src/utils/company-name-normalizer';

/**
 * Item 1 slice s2 (row-key uniqueness). Proves the UNIQUE constraints in
 * web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql actually
 * reject a duplicate row key on a REAL database — a schema.ts declaration
 * alone proves nothing about what the live DB enforces.
 *
 * The constraint is deliberately kept OUT of meta/_journal.json (applying
 * it before a slot's normalized_name backfill completes would fail on the
 * very first pre-existing '' row — see the gated file's own header). CI's
 * `scraper-document-integration` job builds its ipodhan_test database by
 * replaying ONLY the journal (`npx drizzle-kit migrate`), so it never picks
 * up gated DDL. This test therefore READS the exact ADD CONSTRAINT
 * statements out of the committed gated file itself
 * (web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql) and
 * applies them, idempotently, in beforeAll — self-contained in CI (fresh
 * journal-only DB) and a no-op against an already hand-migrated
 * ipodhan_test. Reading the file (rather than duplicating its DDL as a
 * hardcoded string) is what keeps this test genuinely RED on a tree that
 * has not shipped the gated file yet: beforeAll throws ENOENT, not a
 * self-manufactured pass. It does NOT touch DROP DEFAULT (independent, not
 * required for these assertions, and dropping it here could break an
 * unrelated table's insert path sharing this CI job's ephemeral database).
 *
 * SKIPS CLEANLY when no database is configured (pattern: T-403,
 * document-fetch-state-repository.integration.test.ts).
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/child-table-row-key-unique-constraint.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'item-1-slice-s2: DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000158b2';

let pool: Pool | null = null;

// Repo root is 3 levels up from scraper/tests/integration/.
const GATED_SQL_PATH = join(
  __dirname,
  '../../../web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql'
);

/**
 * Read the ADD CONSTRAINT statements out of the committed gated file — the
 * SINGLE source of the DDL under test. Throws ENOENT on a tree that has not
 * shipped the file yet (the pre-slice-s2 state), which is what makes this
 * test genuinely red there instead of self-manufacturing a pass.
 */
function readConstraintDDL(): string[] {
  const sqlText = readFileSync(GATED_SQL_PATH, 'utf8');
  return sqlText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ALTER TABLE') && line.includes('ADD CONSTRAINT'))
    .map((line) => line.replace(/;$/, ''));
}

/**
 * Parse "ALTER TABLE "<table>" ADD CONSTRAINT "<name>" UNIQUE(...)" so the
 * constraint can be dropped by name before being re-applied. Table and
 * constraint names in the gated file are plain identifiers (no embedded
 * quotes), so this simple extraction is safe for this fixed DDL set.
 */
function parseTableAndConstraintName(ddl: string): { table: string; constraint: string } {
  const match = ddl.match(/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/);
  if (!match) {
    throw new Error(`Could not parse table/constraint name from DDL: ${ddl}`);
  }
  return { table: match[1], constraint: match[2] };
}

/**
 * Make the gated file authoritative over whatever ipodhan_test already
 * holds: drop each of these three constraints if present, THEN apply the
 * file's DDL fresh. Without the drop, a local database that already carries
 * the constraint (from a prior manual apply) would skip re-applying it and
 * the test would silently exercise the DATABASE's existing constraint
 * definition instead of the DDL committed in the gated file — the gap a
 * mutation on the file's constraint columns would not catch without first
 * manually dropping it (Tier A review finding, fix round 1).
 */
async function ensureConstraints(pool: Pool): Promise<void> {
  const ddlStatements = readConstraintDDL();
  expect(ddlStatements.length).toBe(3);

  for (const ddl of ddlStatements) {
    const { table, constraint } = parseTableAndConstraintName(ddl);
    await pool.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
  }

  for (const ddl of ddlStatements) {
    await pool.query(ddl);
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });

  const dbCheck = await pool.query('select current_database()');
  const currentDb = dbCheck.rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') {
    throw new Error(
      `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
        'This integration test only runs against the test database.'
    );
  }

  await ensureConstraints(pool);

  const db = drizzle(pool, { schema });
  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipoIntermediaries).where(eq(schema.ipoIntermediaries.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${IPO_ID}::uuid, 'S158B2 Fixture Ltd.', 's158b2-fixture-ltd', 'SME', 'OPEN', '2026-09-08', '2026-09-10')
  `);
}, 30000);

afterAll(async () => {
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipoIntermediaries).where(eq(schema.ipoIntermediaries.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await pool.end();
}, 30000);

describe.skipIf(!DATABASE_URL)(`row-key UNIQUE constraints reject duplicates (${SKIP_REASON})`, () => {
  it('promoters: a second row with the same (ipoId, normalizedName) is REJECTED', async () => {
    const db = drizzle(pool!, { schema });
    const name = 'Ramesh Gupta';
    const normalizedName = normalizeCompanyNameForMatching(name);

    await db.insert(schema.promoters).values({
      ipoId: IPO_ID,
      name,
      normalizedName,
      sharesHeld: null,
      waca: null,
      wacaLastYear: null,
      isPromoterGroup: false,
    } as never);

    let caught: unknown;
    try {
      await db.insert(schema.promoters).values({
        ipoId: IPO_ID,
        name: 'Ramesh Gupta (duplicate spelling)',
        normalizedName,
        sharesHeld: null,
        waca: null,
        wacaLastYear: null,
        isPromoterGroup: false,
      } as never);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string; constraint?: string } }).cause;
    expect(cause?.code).toBe('23505');
    expect(cause?.constraint).toBe('unique_promoters_ipo_id_normalized_name');
  });

  it('peer_companies: a second row with the same (ipoId, normalizedName) is REJECTED', async () => {
    const db = drizzle(pool!, { schema });
    const companyName = 'Peer Industries Ltd';
    const normalizedName = normalizeCompanyNameForMatching(companyName);

    await db.insert(schema.peerCompanies).values({
      ipoId: IPO_ID,
      companyName,
      normalizedName,
      isListed: true,
    } as never);

    let caught: unknown;
    try {
      await db.insert(schema.peerCompanies).values({
        ipoId: IPO_ID,
        companyName: 'Peer Industries Limited',
        normalizedName,
        isListed: true,
      } as never);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string; constraint?: string } }).cause;
    expect(cause?.code).toBe('23505');
    expect(cause?.constraint).toBe('unique_peer_companies_ipo_id_normalized_name');
  });

  it('ipo_intermediaries: a second row with the same (ipoId, role, normalizedName) is REJECTED', async () => {
    const db = drizzle(pool!, { schema });
    const name = 'ICICI Bank';
    const normalizedName = normalizeCompanyNameForMatching(name);

    await db.insert(schema.ipoIntermediaries).values({
      ipoId: IPO_ID,
      role: 'SPONSOR_BANK',
      name,
      normalizedName,
      sebiRegNo: null,
      contactPerson: null,
      phone: null,
      email: null,
      grievanceEmail: null,
    } as never);

    let caught: unknown;
    try {
      await db.insert(schema.ipoIntermediaries).values({
        ipoId: IPO_ID,
        role: 'SPONSOR_BANK',
        name: 'ICICI Bank Limited',
        normalizedName,
        sebiRegNo: null,
        contactPerson: null,
        phone: null,
        email: null,
        grievanceEmail: null,
      } as never);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string; constraint?: string } }).cause;
    expect(cause?.code).toBe('23505');
    expect(cause?.constraint).toBe('unique_ipo_intermediaries_ipo_id_role_normalized_name');
  });

  it('ipo_intermediaries: the SAME name under a DIFFERENT role is ACCEPTED (the ICICI case)', async () => {
    // This is the assertion that protects the real 5-collision finding on
    // staging: ICICI Bank correctly holds two roles (SPONSOR_BANK and
    // PUBLIC_ISSUE_BANK) for one IPO. A two-column (ipoId, normalizedName)
    // key would wrongly reject this; without this test, a later
    // "simplification" of the key to two columns would pass every other
    // test in this file and silently reintroduce that data-loss bug.
    const db = drizzle(pool!, { schema });
    const name = 'ICICI Bank';
    const normalizedName = normalizeCompanyNameForMatching(name);

    // Row already inserted above under SPONSOR_BANK for this IPO+name.
    const [row] = await db
      .insert(schema.ipoIntermediaries)
      .values({
        ipoId: IPO_ID,
        role: 'PUBLIC_ISSUE_BANK',
        name,
        normalizedName,
        sebiRegNo: null,
        contactPerson: null,
        phone: null,
        email: null,
        grievanceEmail: null,
      } as never)
      .returning();

    expect((row as { role: string }).role).toBe('PUBLIC_ISSUE_BANK');

    const rows = await db
      .select()
      .from(schema.ipoIntermediaries)
      .where(eq(schema.ipoIntermediaries.ipoId, IPO_ID));
    const iciciRows = rows.filter((r) => r.normalizedName === normalizedName);
    expect(iciciRows.length).toBe(2);
    expect(iciciRows.map((r) => r.role).sort()).toEqual(['PUBLIC_ISSUE_BANK', 'SPONSOR_BANK']);
  });
});
