import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, FieldSourcesRepository } from '@ipodhan/shared';
import { configureUtcTimestampParsing } from '@ipodhan/shared/db';
import { writePostListingPrice, writePostListingState } from '../../src/services/data-persister';
import { selectPriceCandidates } from '../../src/scheduler/post-listing-price';

/**
 * Item 7 S5 (spec §2.1 "Post-listing price", OD-29) on Postgres (ipodhan_test). The narrow
 * write sets exactly `current_price` and `current_price_updated_at` (plus the repository's
 * own `updated_at`), one `field_sources` row per column, and the as-of instant round-trips
 * through the naive `timestamp` column with drift 0 (ist-timezone.md). An identical price
 * writes 0 rows. The cached NSE series persists across runs.
 *
 * To run (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/post-listing-price.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const NAME = 'S5 Post-Listing Price Fixture Limited';
// 12:15 IST on 2026-09-24; listed a week earlier, inside the 90-day window.
const NOW = new Date('2026-09-24T06:45:00Z');
// The exchange's own as-of: NSE lastUpdateTime "24-Sep-2026 12:17:31" IST.
const AS_OF = new Date('2026-09-24T06:47:31Z');

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;

async function cleanup() {
  const rows = await db!.select({ id: schema.ipos.id }).from(schema.ipos).where(eq(schema.ipos.companyName, NAME));
  for (const r of rows) {
    await db!.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, r.id));
    await db!.delete(schema.ipos).where(eq(schema.ipos.id, r.id));
  }
}

async function seed(): Promise<string> {
  const [row] = await db!
    .insert(schema.ipos)
    .values({
      companyName: NAME,
      slug: 's5-post-listing-price-fixture-limited',
      status: 'LISTED',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      symbol: 'S5PLPFIX',
      listingDate: '2026-09-17',
      currentPrice: '98.40',
    } as any)
    .returning({ id: schema.ipos.id });
  return row.id;
}

/** Every column as Postgres text, so a changed value in ANY column is visible. */
async function rowAsText(id: string): Promise<Record<string, string | null>> {
  const res = await pool!.query(`SELECT to_jsonb(i) AS j FROM (SELECT * FROM ipos WHERE id = $1) i`, [id]);
  const j = res.rows[0].j as Record<string, unknown>;
  return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v === null ? null : String(v)]));
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  configureUtcTimestampParsing();
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
});
beforeEach(async () => { if (db) await cleanup(); });
afterAll(async () => { if (db) await cleanup(); await pool?.end(); });

describe.skipIf(!DATABASE_URL)('post-listing price: the narrow write on Postgres (OD-29)', () => {
  it('writes exactly current_price + current_price_updated_at, two NSE provenance rows, and the as-of round-trips with drift 0', async () => {
    const id = await seed();
    const before = await rowAsText(id);
    const repo = new IPORepository(db as any, noRedis);
    const fieldSources = new FieldSourcesRepository(db as any, noRedis);

    const res = await writePostListingPrice({
      ipoRepository: repo as any,
      fieldSources: fieldSources as any,
      sourceTrackingEnabled: true,
      ipoId: id,
      existing: { currentPrice: '98.40', currentPriceUpdatedAt: null },
      price: 117.31,
      asOf: AS_OF,
      source: 'NSE',
    });
    expect(res.outcome).toBe('updated');

    const after = await rowAsText(id);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]).sort();
    expect(changed).toEqual(['current_price', 'current_price_updated_at', 'updated_at']);

    const text = await pool!.query(`SELECT current_price::text AS p, current_price_updated_at::text AS t FROM ipos WHERE id = $1`, [id]);
    expect(text.rows[0].p).toBe('117.31');
    // The naive column stores the UTC wall clock of the exchange's as-of instant: drift 0.
    expect(text.rows[0].t).toBe('2026-09-24 06:47:31');

    const fs = await db!.select().from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, id));
    expect(fs.map((r) => `${r.tableName}.${r.fieldName}:${r.source}`).sort()).toEqual([
      'ipos.currentPrice:NSE',
      'ipos.currentPriceUpdatedAt:NSE',
    ]);

    // An identical price at the same exchange as-of: OD-73 no-op — no row changes, no provenance row.
    const again = await writePostListingPrice({
      ipoRepository: repo as any,
      fieldSources: fieldSources as any,
      sourceTrackingEnabled: true,
      ipoId: id,
      existing: { currentPrice: text.rows[0].p, currentPriceUpdatedAt: AS_OF },
      price: 117.31,
      asOf: AS_OF,
      source: 'NSE',
    });
    expect(again.outcome).toBe('unchanged');
    expect(await rowAsText(id)).toEqual(after);
    const fs2 = await db!.select({ n: sql<number>`count(*)::int` }).from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, id));
    expect(fs2[0].n).toBe(2);
  });

  it('an older exchange as-of is refused and a same-price later read moves only the as-of (round 2)', async () => {
    const id = await seed();
    const repo = new IPORepository(db as any, noRedis);
    const fieldSources = new FieldSourcesRepository(db as any, noRedis);
    const write = (price: number, asOf: Date, existing: { currentPrice: unknown; currentPriceUpdatedAt: unknown }) =>
      writePostListingPrice({ ipoRepository: repo as any, fieldSources: fieldSources as any, sourceTrackingEnabled: true, ipoId: id, existing, price, asOf, source: 'NSE' });
    await write(117.31, AS_OF, { currentPrice: '98.40', currentPriceUpdatedAt: null });
    // Read the stored as-of back through the job's own selection (the ORM path), as the job does.
    const [c] = (await selectPriceCandidates(db as any, NOW)).filter((r) => r.id === id);
    const before = await rowAsText(id);
    const stale = await write(120, new Date('2026-09-24T06:32:31Z'), { currentPrice: c.currentPrice, currentPriceUpdatedAt: c.currentPriceUpdatedAt });
    expect(stale.outcome).toBe('stale');
    expect(await rowAsText(id)).toEqual(before);
    const confirmed = await write(117.31, new Date('2026-09-24T07:02:31Z'), { currentPrice: c.currentPrice, currentPriceUpdatedAt: c.currentPriceUpdatedAt });
    expect(confirmed.outcome).toBe('confirmed');
    const t = await pool!.query(`SELECT current_price::text AS p, current_price_updated_at::text AS t FROM ipos WHERE id = $1`, [id]);
    expect(t.rows[0]).toEqual({ p: '117.31', t: '2026-09-24 07:02:31' });
  });

  it('the cached NSE series persists and is the only state column the job writes', async () => {
    const id = await seed();
    const repo = new IPORepository(db as any, noRedis);
    const selected = (await selectPriceCandidates(db as any, NOW)).filter((c) => c.id === id);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ listingDate: '2026-09-17', status: 'LISTED', nseSeries: null });

    const before = await rowAsText(id);
    await writePostListingState({ ipoRepository: repo as any, ipoId: id, patch: { nseSeries: 'EQ' } });
    const after = await rowAsText(id);
    expect(Object.keys(after).filter((k) => after[k] !== before[k]).sort()).toEqual(['price_nse_series', 'updated_at']);

    const t = await pool!.query(`SELECT price_nse_series AS series FROM ipos WHERE id = $1`, [id]);
    expect(t.rows[0]).toEqual({ series: 'EQ' });
    expect((await selectPriceCandidates(db as any, NOW)).find((c) => c.id === id)).toMatchObject({ nseSeries: 'EQ' });
  });

  it('the window is 90 IST dates from the listing day: listed 90 days ago is out, 89 days ago is in', async () => {
    const id = await seed();
    const repo = new IPORepository(db as any, noRedis);
    await repo.update(id, { listingDate: '2026-06-26' }); // today 2026-09-24 minus 90 days
    expect((await selectPriceCandidates(db as any, NOW)).some((c) => c.id === id)).toBe(false);
    await repo.update(id, { listingDate: '2026-06-27' }); // day 90 counting the listing day as day 1
    expect((await selectPriceCandidates(db as any, NOW)).some((c) => c.id === id)).toBe(true);
  });
});
