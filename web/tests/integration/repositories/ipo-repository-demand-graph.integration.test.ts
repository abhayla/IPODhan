import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Redis from 'ioredis';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { db } from '@/lib/db/index';
import { ipos, ipoDemandGraph } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * Regression test for #954: `/api/ipos/[slug]/demand-graph` returned a 500
 * (`DatabaseError`) for every IPO that had demand-graph rows.
 *
 * RCA: `getLatestDemandSnapshot()` selects `MAX(${ipoDemandGraph.timestamp})`
 * as a raw `sql<Date>` expression. Because that column is a raw sql fragment
 * (not `.from(table)`'s known column), drizzle never runs
 * `PgTimestamp.mapFromDriverValue()` on it -- the driver value comes back as
 * the naive-timestamp TEXT Postgres emits (e.g. '2026-09-17 04:42:34'), not a
 * Date, despite the `sql<Date>` type annotation (compile-time only). The code
 * then reused that raw string directly as an `eq()` parameter against the
 * real `timestamp` column; drizzle's `PgTimestamp.mapToDriverValue()` assumes
 * a Date and calls `.toISOString()` unconditionally, throwing `TypeError:
 * value.toISOString is not a function` for every IPO with demand data. This
 * test uses the REAL repository method against a real Postgres connection
 * (ipodhan_test) -- a mocked db can't reproduce a driver-serialization bug.
 *
 * A no-op Redis stand-in is used instead of a real Redis connection: this
 * repository method's cache-aside wrapper only needs `get`/`setex`, and the
 * defect is entirely in the DB query path.
 */

const noopRedis = {
  get: async () => null,
  setex: async () => 'OK',
  set: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as unknown as Redis;

describe('IPORepository demand-graph regression (#954)', () => {
  let repository: IPORepository;
  let ipoId: string;

  beforeAll(async () => {
    repository = new IPORepository(db, noopRedis);

    await db.delete(ipos).where(eq(ipos.slug, 'test-demand-graph-ipo'));

    const [created] = await db
      .insert(ipos)
      .values({
        slug: 'test-demand-graph-ipo',
        companyName: 'Test Demand Graph Company',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'LISTED',
        sector: 'Technology',
        issueSize: '500',
        priceRangeMin: 100,
        priceRangeMax: 120,
        lotSize: 125,
      })
      .returning();
    ipoId = created.id;

    await db.insert(ipoDemandGraph).values([
      {
        ipoId,
        timestamp: new Date('2026-09-17T04:42:34.000Z'),
        pricePoint: '1700.00',
        isCutOff: false,
        cumulativeQuantity: 4858208,
        exchange: 'NSE',
      },
      {
        ipoId,
        timestamp: new Date('2026-09-17T04:42:34.000Z'),
        pricePoint: null,
        isCutOff: true,
        cumulativeQuantity: 1000000,
        exchange: 'NSE',
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(ipos).where(eq(ipos.slug, 'test-demand-graph-ipo'));
  });

  it('getLatestDemandSnapshot does not throw and returns the real stats (was: TypeError: value.toISOString is not a function)', async () => {
    const snapshot = await repository.getLatestDemandSnapshot(ipoId);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.timestamp).toBeInstanceOf(Date);
    expect(snapshot?.timestamp.toISOString()).toBe('2026-09-17T04:42:34.000Z');
    expect(snapshot?.totalCutOffBids).toBe(1000000);
    expect(snapshot?.pricePoints).toBe(1); // COUNT(DISTINCT price_point) excludes the NULL cut-off row
  });

  it('getDemandGraph still returns rows for the same IPO', async () => {
    const rows = await repository.getDemandGraph(ipoId);
    expect(rows.length).toBe(2);
  });
});
