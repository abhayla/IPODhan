import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared';

/**
 * Integration coverage for `IPORepository.mergeDuplicateInto` (F-55 class —
 * see `scraper/scripts/repair-merge-duplicate-ipo.ts`), the successor to the
 * raw-SQL `scripts/merge-duplicate-ipo.mjs` prototype that failed the R0
 * write ratchet. The unit tests in
 * `scraper/tests/unit/duplicate-ipo-merge.test.ts` cover the pure
 * discovery/ordering/eligibility logic without a database; this file proves
 * the actual transactional write — repoint vs delete, provenance rows,
 * slug redirect, dropped-row deletion — against real Postgres.
 *
 * SKIPS CLEANLY when no database is configured — with a reason naming the
 * class, so a skipped run is never mistaken for a passing one.
 *
 * To run:
 *   1. `ipodhan_test` rebuilt from empty (drop schemas, `cd web && npx
 *      drizzle-kit migrate`) — see the project's "ipodhan_test rebuild
 *      recipe" note; the least-privilege `ipodhan_app` role cannot itself
 *      drop/recreate the schema, so this step needs the owning role.
 *   2. From `scraper/`:
 *        DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *          npx vitest run -c vitest.integration.config.ts \
 *          tests/integration/duplicate-ipo-merge.integration.test.ts
 *
 * OWED at merge time (2026-09-09): `ipodhan_test` was reachable through the
 * tunnel but its `public` schema was not migrated, and the pooled
 * `ipodhan_app` role lacks the privilege to `DROP SCHEMA public` itself —
 * this file is written and ready, not yet run against a live DB. The
 * class-level fix is proven instead by (a) the 19 passing pure-function unit
 * tests and (b) a real-data dry-run comparison against `ipodhan_staging`
 * (docs/ops/prod-ops-recipes.md) showing the new tool's plan is byte-for-byte
 * identical to the old raw-SQL script's plan on a real duplicate pair.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'duplicate-ipo-merge: DATABASE_URL not set (see file header for the ipodhan_test recipe)';

const KEEP_ID = '00000000-0000-4000-9000-0000000000a1';
const DROP_ID = '00000000-0000-4000-9000-0000000000a2';
const IDS = [KEEP_ID, DROP_ID];

let pool: Pool | null = null;
let repo: IPORepository | null = null;

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });
  repo = new IPORepository(db as never, noRedis);

  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
  await db.delete(schema.ipoSlugRedirects).where(inArray(schema.ipoSlugRedirects.ipoId, IDS));
  await db.delete(schema.subscriptions).where(inArray(schema.subscriptions.ipoId, IDS));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, IDS));

  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, close_date, issue_size, cin)
    VALUES
      (${KEEP_ID}::uuid, 'Asset Reconstruction Company (India) Limited', 't-merge-keep', 'IPO', 'MAINBOARD', 'OPEN', '2026-09-09', '2026-09-11', 4500000000.00, NULL),
      (${DROP_ID}::uuid, 'Asset Reconstruction Co. (India) Ltd', 't-merge-drop', 'IPO', 'MAINBOARD', 'OPEN', '2026-09-09', '2026-09-11', 4500000000.00, 'U65999MH2002PLC138245')
  `);
  // One scraper-derived child row on the DROPPED side, to prove it is deleted (not repointed).
  await db
    .insert(schema.subscriptions)
    .values({ ipoId: DROP_ID, timestamp: new Date(), totalSubscription: '1.50' } as never);
});

afterAll(async () => {
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
  await db.delete(schema.ipoSlugRedirects).where(inArray(schema.ipoSlugRedirects.ipoId, IDS));
  await db.delete(schema.subscriptions).where(inArray(schema.subscriptions.ipoId, IDS));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, IDS));
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`IPORepository.mergeDuplicateInto against real Postgres (${SKIP_REASON})`, () => {
  it('dry run (apply: false) plans the merge without writing anything', async () => {
    const plan = await repo!.mergeDuplicateInto(KEEP_ID, DROP_ID, { apply: false });
    expect(plan.applied).toBe(false);
    expect(plan.keepSlug).toBe('t-merge-keep');
    expect(plan.droppedSlug).toBe('t-merge-drop');
    // cin is absent on the survivor and present on the dropped row -> carried.
    expect(plan.patch.some((p) => p.column === 'cin')).toBe(true);
    expect(plan.toDelete.some((d) => d.table === 'subscriptions' && d.count === 1)).toBe(true);

    // Nothing written: the dropped row still exists, no redirect written.
    const [dropStillThere] = await repo!['db']
      .select({ id: schema.ipos.id })
      .from(schema.ipos)
      .where(sql`${schema.ipos.id} = ${DROP_ID}`);
    expect(dropStillThere).toBeDefined();
  });

  it('apply: true merges the dropped row into the survivor, all in one transaction', async () => {
    const result = await repo!.mergeDuplicateInto(KEEP_ID, DROP_ID, { apply: true });
    expect(result.applied).toBe(true);
    expect(result.provenanceWritten.some((p) => p.fieldName === 'cin')).toBe(true);

    const db = drizzle(pool!, { schema });

    // dropped row is gone
    const dropRows = await db.select().from(schema.ipos).where(sql`${schema.ipos.id} = ${DROP_ID}`);
    expect(dropRows).toHaveLength(0);

    // survivor carried cin from the dropped row
    const [survivor] = await db.select().from(schema.ipos).where(sql`${schema.ipos.id} = ${KEEP_ID}`);
    expect(survivor.cin).toBe('U65999MH2002PLC138245');

    // subscriptions row was DELETED with the dropped row, not repointed
    const subs = await db.select().from(schema.subscriptions).where(inArray(schema.subscriptions.ipoId, IDS));
    expect(subs).toHaveLength(0);

    // slug redirect written
    const redirects = await db
      .select()
      .from(schema.ipoSlugRedirects)
      .where(sql`${schema.ipoSlugRedirects.oldSlug} = 't-merge-drop'`);
    expect(redirects).toHaveLength(1);
    expect(redirects[0].ipoId).toBe(KEEP_ID);

    // provenance row for the carried field, with previous_source recorded
    const prov = await db
      .select()
      .from(schema.fieldSources)
      .where(sql`${schema.fieldSources.ipoId} = ${KEEP_ID} AND ${schema.fieldSources.fieldName} = 'cin'`);
    expect(prov).toHaveLength(1);
    expect(prov[0].updatedBy).toBe('merge-duplicate-ipo');
  });

  it('refuses (throws) when the two rows open on different dates', async () => {
    // Re-seed a fresh pair with disagreeing open dates to prove the eligibility gate.
    const db = drizzle(pool!, { schema });
    const A = '00000000-0000-4000-9000-0000000000b1';
    const B = '00000000-0000-4000-9000-0000000000b2';
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, close_date)
      VALUES
        (${A}::uuid, 'Different Dates Ltd', 't-merge-diffdate-a', 'IPO', 'MAINBOARD', 'OPEN', '2026-09-09', '2026-09-11'),
        (${B}::uuid, 'Different Dates Ltd', 't-merge-diffdate-b', 'IPO', 'MAINBOARD', 'OPEN', '2026-09-10', '2026-09-12')
      ON CONFLICT DO NOTHING
    `);
    try {
      await expect(repo!.mergeDuplicateInto(A, B, { apply: false })).rejects.toThrow(/different dates/);
    } finally {
      await db.delete(schema.ipos).where(inArray(schema.ipos.id, [A, B]));
    }
  });
});
