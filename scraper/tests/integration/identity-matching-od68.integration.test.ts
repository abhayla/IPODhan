import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, resolveIpoRow, IdentityHeldForReviewError } from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { normalizeIdentityCompanyName } from '../../../packages/shared/src/utils/identity-decoration';

/**
 * OD-68 / OD-69 (docs/design/data-sourcing-pull-model.md §2.3.3.2, scenarios S1, S2, S6, S7),
 * proven on the REAL `resolveIpoRow` + `IPORepository.create` against Postgres (ipodhan_test).
 *
 * Each case seeds the row that already existed (copied from ipodhan_staging on 2026-09-23:
 * name, segment, open date, price band, symbol, CIN), feeds the incoming record in the shape the
 * source really sent it, and runs exactly what `upsertIPO` does — resolve, and create only when
 * nothing bound — then COUNTS the rows that fold to that company.
 *
 * To run (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/identity-matching-od68.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'identity-matching-od68: DATABASE_URL not set (see file header)';

const ID = {
  rays: '00000000-0000-4000-9068-000000000001',
  himalayanSolar: '00000000-0000-4000-9068-000000000002',
  technocraft: '00000000-0000-4000-9068-000000000003',
  gv: '00000000-0000-4000-9068-000000000004',
  mergeA: '00000000-0000-4000-9068-000000000005',
  mergeB: '00000000-0000-4000-9068-000000000006',
};
const SEEDED = Object.values(ID);
const FOLDS = ['rays of belief', 'himalayan solar', 'himalaya nutravedics', 'technocraft ventures', 'technocrats plasma systems', 'g v electricals', 'od68 merge probe'];

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let repo: IPORepository | null = null;

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
  scan: async () => ['0', []],
} as never;

async function rowsFolding(fold: string): Promise<{ id: string; slug: string; companyName: string }[]> {
  const all = await db!.select({ id: schema.ipos.id, slug: schema.ipos.slug, companyName: schema.ipos.companyName }).from(schema.ipos);
  return all.filter((r) => normalizeIdentityCompanyName(r.companyName) === fold);
}

async function cleanup() {
  const all = await db!.select({ id: schema.ipos.id, companyName: schema.ipos.companyName }).from(schema.ipos);
  const ids = all.filter((r) => SEEDED.includes(r.id) || FOLDS.includes(normalizeIdentityCompanyName(r.companyName))).map((r) => r.id);
  if (ids.length === 0) return;
  await db!.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, ids));
  await db!.delete(schema.ipoSlugRedirects).where(inArray(schema.ipoSlugRedirects.ipoId, ids));
  await db!.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
}

/** What upsertIPO does with an incoming record: resolve once; create only when nothing bound. */
async function ingest(rec: {
  companyName: string;
  openDate: string | null;
  priceRangeMin: number | null;
  segment: 'MAINBOARD' | 'SME';
  symbol?: string | null;
}): Promise<'bound' | 'created' | 'held'> {
  const bound = await resolveIpoRow(repo!, {
    companyName: rec.companyName,
    normalizedName: normalizeCompanyNameForMatching(rec.companyName),
    slug: generateIPOSlug(rec.companyName),
    symbol: rec.symbol ?? null,
    openDate: rec.openDate,
    priceRangeMin: rec.priceRangeMin,
    segment: rec.segment,
  });
  if (bound) return 'bound';
  try {
    await repo!.create({
      companyName: rec.companyName,
      slug: generateIPOSlug(rec.companyName),
      offeringType: 'IPO',
      segment: rec.segment,
      status: 'UPCOMING',
      openDate: rec.openDate,
      priceRangeMin: rec.priceRangeMin,
      symbol: rec.symbol ?? null,
    } as never);
    return 'created';
  } catch (e) {
    if (e instanceof IdentityHeldForReviewError) return 'held';
    throw e;
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
  repo = new IPORepository(db as never, noRedis);
});

beforeEach(async () => {
  if (!db) return;
  await cleanup();
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, price_range_min, price_range_max, symbol, cin)
    VALUES
      (${ID.rays}::uuid, 'Rays of Belief Limited- For Profit Social Enterprise', 'rays-of-belief-ltd', 'IPO', 'MAINBOARD', 'LISTED', '2026-09-01', 227, 239, 'MOMSBELIEF', 'U85110DL2017PLC322623'),
      (${ID.himalayanSolar}::uuid, 'Himalayan Solar Ltd.', 'himalayan-solar-ltd', 'IPO', 'SME', 'UPCOMING', '2026-09-25', 98, 103, 'HIMALAYAN', 'U40100HR2015PLC056609'),
      (${ID.technocraft}::uuid, 'Technocraft Ventures Ltd.', 'technocraft-ventures-ltd', 'IPO', 'MAINBOARD', 'LISTED', '2026-08-07', 212, 212, 'TECHNOCRAF', NULL),
      (${ID.gv}::uuid, 'G.V.Electricals Ltd.', 'g-v-electricals-ltd', 'IPO', 'SME', 'LISTED', '2026-07-31', 130, 130, 'GVELECTRIC', NULL)
  `);
});

afterAll(async () => {
  if (db) await cleanup();
  await pool?.end();
});

describe.skipIf(!DATABASE_URL)('OD-68 matching on the real resolver + create path (ipodhan_test)', () => {
  it('S1/S7 Rays of Belief: the aggregator shape "Rays of Belief Ltd. O" (price 0, no symbol) lands in the ONE existing row', async () => {
    const outcome = await ingest({ companyName: 'Rays of Belief Ltd. O', openDate: '2026-09-01', priceRangeMin: null, segment: 'MAINBOARD' });
    const rows = await rowsFolding('rays of belief');
    expect({ outcome, rows: rows.map((r) => r.slug) }).toEqual({ outcome: 'bound', rows: ['rays-of-belief-ltd'] });
  });

  it('S1 as it happened on 2026-09-01: the row had no open date or band yet, and "Rays of Belief Ltd. O" arrived — no second row', async () => {
    await db!.execute(sql`UPDATE ipos SET open_date = NULL, price_range_min = NULL, price_range_max = NULL, symbol = NULL, cin = NULL WHERE id = ${ID.rays}::uuid`);
    const outcome = await ingest({ companyName: 'Rays of Belief Ltd. O', openDate: '2026-09-01', priceRangeMin: null, segment: 'MAINBOARD' });
    const rows = await rowsFolding('rays of belief');
    expect(['bound', 'held']).toContain(outcome);
    expect(rows.map((r) => r.slug)).toEqual(['rays-of-belief-ltd']);
  });

  it('S3 title text: "Rays of Belief Limited" with a different band but the same open date binds by the identity fold, never a new row', async () => {
    await db!.execute(sql`UPDATE ipos SET symbol = NULL, price_range_min = NULL WHERE id = ${ID.rays}::uuid`);
    const outcome = await ingest({ companyName: 'Rays of Belief Limited', openDate: '2026-09-01', priceRangeMin: 227, segment: 'MAINBOARD' });
    expect(outcome).toBe('bound');
    expect((await rowsFolding('rays of belief')).map((r) => r.slug)).toEqual(['rays-of-belief-ltd']);
  });

  it('S7 Rays of Belief: the BSE shape "Rays of Belief Limited" (same open date + band) lands in the ONE existing row', async () => {
    const outcome = await ingest({ companyName: 'Rays of Belief Limited', openDate: '2026-09-01', priceRangeMin: 227, segment: 'MAINBOARD' });
    expect(outcome).toBe('bound');
    expect((await rowsFolding('rays of belief')).map((r) => r.slug)).toEqual(['rays-of-belief-ltd']);
  });

  it('S2 hold: a name-matching record whose open date CONTRADICTS the row is held — no second row, not written into the first', async () => {
    const outcome = await ingest({ companyName: 'Rays of Belief Ltd.', openDate: '2026-09-15', priceRangeMin: 227, segment: 'MAINBOARD' });
    expect(outcome).toBe('held');
    expect((await rowsFolding('rays of belief')).map((r) => r.slug)).toEqual(['rays-of-belief-ltd']);
  });

  it('S1 suffix-only duplicate (G.V. Electricals shape): "G.V. Electricals Ltd. O" lands in the ONE existing row', async () => {
    const outcome = await ingest({ companyName: 'G.V. Electricals Ltd. O', openDate: '2026-07-31', priceRangeMin: 130, segment: 'SME' });
    expect(outcome).toBe('bound');
    expect((await rowsFolding('g v electricals')).map((r) => r.slug)).toEqual(['g-v-electricals-ltd']);
  });

  it('S6 look-alike: Himalaya Nutravedics India Limited is NOT Himalayan Solar Limited — two rows', async () => {
    const outcome = await ingest({ companyName: 'Himalaya Nutravedics India Limited', openDate: '2026-09-22', priceRangeMin: 100, segment: 'SME', symbol: 'HNIL' });
    expect(outcome).toBe('created');
    expect((await rowsFolding('himalayan solar')).length).toBe(1);
    expect((await rowsFolding('himalaya nutravedics')).length).toBe(1);
  });

  it('S6 look-alike: Technocrats Plasma Systems Ltd. is NOT Technocraft Ventures Ltd. — two rows', async () => {
    const outcome = await ingest({ companyName: 'Technocrats Plasma Systems Ltd.', openDate: '2026-08-14', priceRangeMin: 132, segment: 'SME', symbol: 'TECHNOCRAT' });
    expect(outcome).toBe('created');
    expect((await rowsFolding('technocraft ventures')).length).toBe(1);
    expect((await rowsFolding('technocrats plasma systems')).length).toBe(1);
  });
});

describe.skipIf(!DATABASE_URL)('OD-69 merge refusal on the real mergeDuplicateInto (ipodhan_test)', () => {
  async function seedPair(a: { cin: string | null; open: string }, b: { cin: string | null; open: string }) {
    await db!.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, cin)
      VALUES
        (${ID.mergeA}::uuid, 'OD68 Merge Probe Ltd', 'od68-merge-probe-a', 'IPO', 'SME', 'UPCOMING', ${a.open}, ${a.cin}),
        (${ID.mergeB}::uuid, 'OD68 Merge Probe Limited', 'od68-merge-probe-b', 'IPO', 'SME', 'UPCOMING', ${b.open}, ${b.cin})
    `);
  }

  it('refuses a pair whose CIN differs, even with forceDifferentName', async () => {
    await seedPair({ cin: 'U11111DL2017PLC000001', open: '2026-10-01' }, { cin: 'U22222DL2017PLC000002', open: '2026-10-01' });
    await expect(repo!.mergeDuplicateInto(ID.mergeA, ID.mergeB, { apply: false, forceDifferentName: true })).rejects.toThrow(/cin disagrees/);
  });

  it('refuses a pair whose open date differs by even one day (Himalayan Solar / Himalaya Nutravedics were 3 apart)', async () => {
    await seedPair({ cin: null, open: '2026-10-01' }, { cin: null, open: '2026-10-02' });
    await expect(repo!.mergeDuplicateInto(ID.mergeA, ID.mergeB, { apply: false })).rejects.toThrow(/open date/i);
  });

  it('still plans a merge for one IPO stored twice (same open date, no disagreeing identifier)', async () => {
    await seedPair({ cin: null, open: '2026-10-01' }, { cin: 'U33333DL2017PLC000003', open: '2026-10-01' });
    const plan = await repo!.mergeDuplicateInto(ID.mergeA, ID.mergeB, { apply: false });
    expect(plan.applied).toBe(false);
  });
});

it.skipIf(!!DATABASE_URL)(SKIP_REASON, () => {});
