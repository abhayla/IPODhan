import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, like } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared';
import { configureUtcTimestampParsing } from '@ipodhan/shared/db';
import { writeDelistingState } from '../../src/services/data-persister';
import { runPostListingPriceJob, selectPriceCandidates } from '../../src/scheduler/post-listing-price';
import { readNsePrice, type QuoteOutcome } from '../../src/scrapers/post-listing-quote';

/**
 * #983 / OD-38 (spec §2.3.3.3) on Postgres (ipodhan_test): the delisting count is persisted
 * across runs, three consecutive real NSE delisting reports set DELISTED with the third read's
 * instant, an UNKNOWN run never does, and an outage-wide run is voided by the canary. NSE bodies
 * are the REAL captured ones (fixtures/post-listing-price/delisting-read-shapes-2026-09-26.json).
 *
 * To run (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/delisting-strikes.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const PREFIX = 'T983 Delisting Fixture';
const shapes = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/post-listing-price/delisting-read-shapes-2026-09-26.json'), 'utf8'),
).responses as Record<string, { status: number; body: string }>;
const failures = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/post-listing-price/endpoint-failure-shapes-2026-09-24.json'), 'utf8'),
).responses as Record<string, string>;

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;

async function cleanup() {
  await db!.delete(schema.ipos).where(like(schema.ipos.companyName, `${PREFIX}%`));
}

async function seed(n: number): Promise<string> {
  const [row] = await db!
    .insert(schema.ipos)
    .values({
      companyName: `${PREFIX} ${n}`,
      slug: `t983-delisting-fixture-${n}`,
      status: 'LISTED',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      symbol: `T983FIX${n}`,
      listingDate: '2026-09-20',
    } as any)
    .returning({ id: schema.ipos.id });
  return row.id;
}

type Body = { status: number; body: string };
async function runOnce(now: Date, nseBody: Body, bseList = 5047) {
  const repo = new IPORepository(db as any, noRedis);
  const candidates = (await selectPriceCandidates(db as any, now)).filter((c) => c.companyName.startsWith(PREFIX));
  return runPostListingPriceJob({
    now,
    candidates,
    readNse: (symbol, segment, cached) => readNsePrice(symbol, segment, { cachedSeries: cached, fetchRaw: async () => nseBody }),
    readBse: async (): Promise<QuoteOutcome> => ({ kind: 'refused', exchange: 'BSE', detail: 'unused', calls: 1 }),
    loadBseScrips: async () => new Map(Array.from({ length: bseList }, (_, i) => [`INE${i}`, String(i)])),
    writePrice: async () => 'updated',
    writeState: async () => {},
    writeDelisting: async (c, next, delistAt) => {
      await writeDelistingState({ ipoRepository: repo as any, ipoId: c.id, next, delistAt });
    },
    log: () => {},
  });
}

async function read(id: string) {
  const res = await pool!.query(
    `SELECT status::text, delisting_strikes, delisting_strike_reads, delisted_at::text AS delisted_at FROM ipos WHERE id = $1`,
    [id],
  );
  return res.rows[0];
}

// 10:00, 10:15, 10:30, 10:45 IST on Monday 2026-09-28.
const T = (m: number) => new Date(Date.UTC(2026, 8, 28, 4, 30 + m));

beforeAll(async () => {
  if (!DATABASE_URL) return;
  configureUtcTimestampParsing();
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
});
beforeEach(async () => { if (db) await cleanup(); });
afterAll(async () => { if (db) await cleanup(); await pool?.end(); });

describe.skipIf(!DATABASE_URL)('delisting detection on Postgres (#983, OD-38)', () => {
  it('three consecutive real NSE delisting reports set DELISTED at the third read; an UNKNOWN run in between neither counts nor resets', async () => {
    const id = await seed(1);
    const delisted = shapes['nse:HDFC:EQ'];
    const outage = { status: 404, body: failures['nse-GetQuoteApiRetired-EQ-404'] };
    await runOnce(T(0), delisted);
    expect(await read(id)).toMatchObject({ status: 'LISTED', delisting_strikes: 1 });
    await runOnce(T(15), outage);
    expect(await read(id)).toMatchObject({ status: 'LISTED', delisting_strikes: 1 });
    await runOnce(T(30), delisted);
    expect(await read(id)).toMatchObject({ status: 'LISTED', delisting_strikes: 2 });
    const s = await runOnce(T(45), delisted);
    const row = await read(id);
    expect(row.status).toBe('DELISTED');
    expect(row.delisting_strikes).toBe(3);
    expect(row.delisted_at).toBe('2026-09-28 05:15:00');
    expect((row.delisting_strike_reads as Array<{ at: string }>).map((r) => r.at)).toEqual([T(0), T(30), T(45)].map((d) => d.toISOString()));
    expect(s.delisting.delisted).toEqual([`${PREFIX} 1`]);
    // The job stops for it: a DELISTED row is no longer a candidate.
    expect((await selectPriceCandidates(db as any, T(60))).some((c) => c.id === id)).toBe(false);
  });

  it('UNKNOWN never delists: a no-such-symbol 404, a temporary suspension, an empty 200 and a truncated BSE list, run after run', async () => {
    const id = await seed(2);
    await runOnce(T(0), shapes['nse:ZZNOSUCHSYM:EQ']);
    await runOnce(T(15), shapes['nse:BALLARPUR:BZ']);
    await runOnce(T(30), { status: 200, body: '' });
    await runOnce(T(45), shapes['nse:HDFC:EQ'], 1200);
    expect(await read(id)).toMatchObject({ status: 'LISTED', delisting_strikes: 0, delisting_strike_reads: null, delisted_at: null });
  });

  it('an outage-wide run (every asked IPO answers delisted) is voided by the canary; a price read resets a count', async () => {
    const ids = [await seed(3), await seed(4), await seed(5)];
    const s = await runOnce(T(0), shapes['nse:HDFC:EQ']);
    expect(s.delisting.voided.length).toBe(3);
    for (const id of ids) expect(await read(id)).toMatchObject({ status: 'LISTED', delisting_strikes: 0 });
    await db!.update(schema.ipos).set({ delistingStrikes: 2, delistingStrikeReads: [{ at: 'x', exchange: 'NSE', detail: 'd' }] } as any).where(eq(schema.ipos.id, ids[0]));
    await runOnce(T(15), shapes['nse:HEROMOTORS:EQ']);
    expect(await read(ids[0])).toMatchObject({ status: 'LISTED', delisting_strikes: 0, delisting_strike_reads: null });
  });
});
