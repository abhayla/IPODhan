// implements: item-1-slice-s2 fix round (F-1 / GitHub #443)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, inArray } from 'drizzle-orm';
// Relative import, NOT the `@ipodhan/shared` package alias — see the same
// note in child-table-normalized-name.integration.test.ts (worktree
// node_modules junctions resolve the alias back to the PRIMARY checkout).
import * as schema from '../../../packages/shared/src/db/schema';
import { PeerCompanyRepository } from '../../src/repositories/peer-company-repository';

/**
 * Item 1 slice s2 fix round, F-1 / GitHub #443: `filing-persister.ts` and
 * `data-persister.ts` used to delete an IPO's peer rows and re-insert as two
 * SEPARATE statements — a failing insert (a duplicate row key, a bad
 * connection, anything) left the IPO with ZERO peer rows, permanently. The
 * fix gives `PeerCompanyRepository` a `replaceForIpo(ipoId, rows)` that (a)
 * de-dupes rows that normalise to the same key BEFORE the write, so a
 * same-document collision never reaches the database, and (b) wraps the
 * delete and the insert in ONE transaction, so any OTHER failure rolls back
 * the delete too.
 *
 * This is a REAL-DATABASE test (not a mock) because the thing under proof —
 * "does a failed write really leave the old rows in place" — is exactly
 * what a mocked `db.transaction` cannot demonstrate: a mock's `transaction`
 * callback can be *called* without ever being *atomic*. Only a live
 * Postgres rollback proves it.
 *
 * SKIPS CLEANLY when no database is configured (pattern: T-403,
 * document-fetch-state-repository.integration.test.ts).
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/peer-company-replace-atomicity.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'item-1-slice-s2 fix round: DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000158f1';
// A syntactically valid UUID that is guaranteed not to be a row in `ipos` —
// used to force a real FK violation (23503) partway through a batch insert.
const NONEXISTENT_IPO_ID = '00000000-0000-4000-8000-00000015dead';

let pool: Pool | null = null;

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

  const db = drizzle(pool, { schema });
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${IPO_ID}::uuid, 'S158F1 Fixture Ltd.', 's158f1-fixture-ltd', 'SME', 'OPEN', '2026-09-08', '2026-09-10')
  `);
}, 30000);

afterAll(async () => {
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await pool.end();
}, 30000);

describe.skipIf(!DATABASE_URL)(`PeerCompanyRepository.replaceForIpo atomicity (${SKIP_REASON})`, () => {
  it('a document with two peers that normalise to the same key writes ONE row, no throw', async () => {
    const db = drizzle(pool!, { schema });
    const repo = new PeerCompanyRepository(db);

    await repo.replaceForIpo(IPO_ID, [
      {
        ipoId: IPO_ID,
        companyName: 'ABC Ltd',
        normalizedName: 'abc',
        isListed: true,
      },
      {
        ipoId: IPO_ID,
        companyName: 'ABC Limited',
        normalizedName: 'abc',
        isListed: true,
      },
    ] as never);

    const rows = await db
      .select()
      .from(schema.peerCompanies)
      .where(eq(schema.peerCompanies.ipoId, IPO_ID));

    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe('ABC Limited');
  });

  it('a forced failure during the insert leaves the previously stored peer rows intact (no data loss)', async () => {
    const db = drizzle(pool!, { schema });
    const repo = new PeerCompanyRepository(db);

    // Baseline: one real, valid peer row for this IPO.
    await repo.replaceForIpo(IPO_ID, [
      {
        ipoId: IPO_ID,
        companyName: 'Baseline Peer Ltd',
        normalizedName: 'baseline peer',
        isListed: true,
      },
    ] as never);

    const baseline = await db
      .select()
      .from(schema.peerCompanies)
      .where(eq(schema.peerCompanies.ipoId, IPO_ID));
    expect(baseline).toHaveLength(1);

    // Force a real failure partway through the replace: one row in the
    // batch carries an ipoId with no matching `ipos` row, which violates
    // the peer_companies -> ipos foreign key on insert.
    let caught: unknown;
    try {
      await repo.replaceForIpo(IPO_ID, [
        {
          ipoId: IPO_ID,
          companyName: 'Would-be New Peer Ltd',
          normalizedName: 'would be new peer',
          isListed: true,
        },
        {
          ipoId: NONEXISTENT_IPO_ID,
          companyName: 'Orphan Peer Ltd',
          normalizedName: 'orphan peer',
          isListed: true,
        },
      ] as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe('23503');

    // The baseline row must still be there — the delete rolled back with
    // the failed insert, not committed on its own.
    const afterFailure = await db
      .select()
      .from(schema.peerCompanies)
      .where(eq(schema.peerCompanies.ipoId, IPO_ID));
    expect(afterFailure).toHaveLength(1);
    expect(afterFailure[0].companyName).toBe('Baseline Peer Ltd');
  });
});
