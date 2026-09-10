// implements: R-158
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative import, NOT the `@ipodhan/shared` package alias: in a worktree
// checkout with junctioned node_modules, `@ipodhan/shared/db/schema` resolves
// through the node_modules symlink back to the PRIMARY checkout's source
// tree, not this worktree's edited schema.ts (verified: `require.resolve`
// returns a path under the primary checkout). A relative import always
// resolves within this worktree, which is what a test of THIS slice's schema
// change must exercise. CI checks out a single tree with no such crossing.
import * as schema from '../../../packages/shared/src/db/schema';
import { normalizeCompanyNameForMatching } from '../../../packages/shared/src/utils/company-name-normalizer';

/**
 * Item 1 slice s1 (row-key prep, F-74). Proves a REAL insert into
 * `promoters`, `peer_companies` and `ipo_intermediaries` lands a populated
 * `normalized_name` — the thing an in-memory mock cannot prove, since it is
 * the widened schema's own column + index that this integration test targets.
 *
 * SKIPS CLEANLY when no database is configured (pattern: T-403,
 * document-fetch-state-repository.integration.test.ts).
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/child-table-normalized-name.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'R-158: DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000158a1';

let pool: Pool | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });

  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipoIntermediaries).where(eq(schema.ipoIntermediaries.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${IPO_ID}::uuid, 'R158 Fixture Ltd.', 'r158-fixture-ltd', 'SME', 'OPEN', '2026-09-08', '2026-09-10')
  `);
});

afterAll(async () => {
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipoIntermediaries).where(eq(schema.ipoIntermediaries.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`normalized_name lands on a real insert (${SKIP_REASON})`, () => {
  it('promoters: inserted row carries a populated normalized_name', async () => {
    const db = drizzle(pool!, { schema });
    const name = 'Sunil Sharma';
    const [row] = await db
      .insert(schema.promoters)
      .values({
        ipoId: IPO_ID,
        name,
        normalizedName: normalizeCompanyNameForMatching(name),
        sharesHeld: null,
        waca: null,
        wacaLastYear: null,
        isPromoterGroup: false,
      } as never)
      .returning();
    expect((row as { normalizedName: string }).normalizedName).toBe('sunil sharma');
  });

  it('peer_companies: inserted row carries a populated normalized_name', async () => {
    const db = drizzle(pool!, { schema });
    const companyName = 'ABC (India) Ltd';
    const [row] = await db
      .insert(schema.peerCompanies)
      .values({
        ipoId: IPO_ID,
        companyName,
        normalizedName: normalizeCompanyNameForMatching(companyName),
        isListed: true,
      } as never)
      .returning();
    // Item 12 slice B: the key SHORTENED from 'abc india' because a TRAILING
    // country token is now dropped - 'ABC (India) Ltd' -> 'abc'. The PROPERTY
    // this test exists to prove is unchanged and still asserted: the column
    // lands POPULATED on a real insert, which an in-memory mock cannot show.
    // Only the literal moved. A leading or medial country word is still kept -
    // pinned by the negative cases in company-name-normalizer.test.ts.
    expect((row as { normalizedName: string }).normalizedName).toBe('abc');
  });

  it('ipo_intermediaries: inserted row carries a populated normalized_name', async () => {
    const db = drizzle(pool!, { schema });
    const name = 'JM Financial Services Ltd';
    const [row] = await db
      .insert(schema.ipoIntermediaries)
      .values({
        ipoId: IPO_ID,
        role: 'BRLM',
        name,
        normalizedName: normalizeCompanyNameForMatching(name),
        sebiRegNo: null,
        contactPerson: null,
        phone: null,
        email: null,
        grievanceEmail: null,
      } as never)
      .returning();
    expect((row as { normalizedName: string }).normalizedName).toBe('jm financial services');
  });
});
