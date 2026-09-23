import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import {
  IPORepository,
  resolveIpoRow,
  IdentityHeldForReviewError,
  SourceKeyDuplicateError,
  SourceKeySupersededError,
  inferBoundVia,
  nseIssueKeyValue,
  releaseEndedSourceKeys,
  type SourceKeyRef,
} from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { bseSourceKeys } from '../../src/scrapers/bse-api-scraper';
import { activeBseIpoNo, recordBseDiscoveryMetadata } from '../../src/services/data-persister';

/**
 * OD-85 / OD-86 (docs/design/data-sourcing-pull-model.md §2.3.3.2 "Source record keys",
 * §2.3.3.3 relaunch exception; OD-83; F-144..F-149), proven on the REAL `resolveIpoRow`,
 * `IPORepository.create` / `bindSourceKeys` / `mergeDuplicateInto` against Postgres (ipodhan_test).
 *
 * The CORE proof is the first case: the real Dhanwel Hybrid Seeds BSE records (F-144, fetched
 * 2026-09-23) — IPO_NO 7794 "23 Jun 2026 to 23 Jun 2026" with the note "has been postponed", then
 * IPO_NO 7900 "19 Aug 2026 to 21 Aug 2026", both 2,700,000 shares, band 95–99, symbol DHANWEL.
 * Before OD-85, BSE kept serving 7794 beside 7900 and each cycle rebound it by symbol and wrote the
 * June dates back. After: one row with the August dates, 7794 SUPERSEDED, and re-reading 7794
 * writes nothing.
 *
 * `ingest` does what the live path does (BaseScraperOrchestrator step 2 + upsertIPO): resolve once;
 * a bound record records its keys (bindSourceKeys) and then writes; an unbound one creates the row
 * WITH its keys in one transaction.
 *
 * To run (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/source-record-keys-od85.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;

const NAMES = [
  'Dhanwel Hybrid Seeds Ltd', 'Dhanwel Hybird Seeds Ltd', 'IC Electricals Company Ltd', 'Hero Motors Ltd',
  'Rays of Belief Ltd', 'Himalayan Solar Ltd', 'Himalaya Nutravedics India Ltd', 'OD85 Coalx Ltd',
  'OD85 Newco Ltd', 'OD85 Reuse Ltd', 'OD85 Merge Probe Ltd', 'OD85 Race Probe Ltd', 'OD85 Race Probe Limited',
];

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let repo: IPORepository | null = null;

const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;

async function cleanup() {
  const rows = await db!.select({ id: schema.ipos.id }).from(schema.ipos).where(inArray(schema.ipos.companyName, NAMES));
  const ids = rows.map((r) => r.id);
  await db!.execute(sql`DELETE FROM audit_logs WHERE action_type IN ('IDENTITY_HELD_FOR_REVIEW', 'IDENTITY_HOLD_OVERRIDDEN')`);
  if (ids.length === 0) return;
  await db!.execute(sql`DELETE FROM ipo_merge_log WHERE keep_ipo_id IN ${sql.raw(`(${ids.map((i) => `'${i}'`).join(',')})`)}`);
  await db!.delete(schema.ipoSourceKeys).where(inArray(schema.ipoSourceKeys.ipoId, ids));
  await db!.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, ids));
  await db!.delete(schema.ipoSlugRedirects).where(inArray(schema.ipoSlugRedirects.ipoId, ids));
  await db!.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
}

interface Rec {
  companyName: string;
  openDate: string | null;
  closeDate?: string | null;
  priceRangeMin: number | null;
  priceRangeMax?: number | null;
  segment: 'MAINBOARD' | 'SME' | null;
  symbol?: string | null;
  cin?: string | null;
  isin?: string | null;
  offeringType?: string;
  offeringTypeExplicit?: boolean;
  status?: string;
  /** The live path gives an explicit OFS its own -ofs-<year> slug (computeIpoIdentitySlug). */
  slug?: string;
  keys: SourceKeyRef[];
}

type Outcome = 'bound' | 'created' | 'held' | 'duplicate' | 'superseded';

async function ingest(rec: Rec): Promise<Outcome> {
  let bound;
  try {
    bound = await resolveIpoRow(repo!, {
      companyName: rec.companyName,
      normalizedName: normalizeCompanyNameForMatching(rec.companyName),
      slug: rec.slug ?? generateIPOSlug(rec.companyName),
      symbol: rec.symbol ?? null,
      cin: rec.cin ?? null,
      isin: rec.isin ?? null,
      openDate: rec.openDate,
      priceRangeMin: rec.priceRangeMin,
      segment: rec.segment,
      offeringType: rec.offeringTypeExplicit ? rec.offeringType : undefined,
      sourceKeys: rec.keys,
    });
    if (bound) {
      await repo!.bindSourceKeys(bound.id, rec.keys, { boundVia: inferBoundVia(rec, bound as never), boundBy: 'od85.test' });
      await repo!.update(bound.id, { openDate: rec.openDate, closeDate: rec.closeDate ?? rec.openDate } as never);
      return 'bound';
    }
  } catch (e) {
    if (e instanceof SourceKeySupersededError) return 'superseded';
    if (e instanceof SourceKeyDuplicateError) return 'duplicate';
    if (e instanceof IdentityHeldForReviewError) return 'held';
    throw e;
  }
  await repo!.create({
    companyName: rec.companyName,
    slug: rec.slug ?? generateIPOSlug(rec.companyName),
    offeringType: rec.offeringType ?? 'IPO',
    segment: rec.segment,
    status: rec.status ?? 'UPCOMING',
    openDate: rec.openDate,
    closeDate: rec.closeDate ?? rec.openDate,
    priceRangeMin: rec.priceRangeMin,
    priceRangeMax: rec.priceRangeMax ?? rec.priceRangeMin,
    symbol: rec.symbol ?? null,
    cin: rec.cin ?? null,
    isin: rec.isin ?? null,
  } as never, { sourceKeys: rec.keys, boundBy: 'od85.test' });
  return 'created';
}

async function keysOf(ipoId: string) {
  return db!.select().from(schema.ipoSourceKeys).where(eq(schema.ipoSourceKeys.ipoId, ipoId));
}
async function rowsNamed(...names: string[]) {
  return db!.select().from(schema.ipos).where(inArray(schema.ipos.companyName, names)).orderBy(schema.ipos.slug);
}
const today = '2026-09-23';

/** The real BSE detail rows (F-144), through the real key builder. */
const DHANWEL_7794 = bseSourceKeys(
  { IPO_NO: '7794', ScripCode: '', ScripName: 'Dhanwel Hybrid Seeds Ltd', Symbol: 'DHANWEL', Issue_Period: '23 Jun 2026 to 23 Jun 2026',
    Issue_Size_No_of_shares: '2700000', Price_Band: '95.00-99.00', Face_Value: '10.00', Market_Lot: '1200',
    Notes: 'The issue of Dhanwel Hybrid Seeds Ltd has been postponed' },
  2_700_000, { min: 95, max: 99 }, '2026-06-23', '2026-06-23', today);
const DHANWEL_7900 = bseSourceKeys(
  { IPO_NO: '7900', ScripCode: '', ScripName: 'Dhanwel Hybrid Seeds Ltd', Symbol: 'DHANWEL', Issue_Period: '19 Aug 2026 to 21 Aug 2026',
    Issue_Size_No_of_shares: '2700000', Price_Band: '95.00-99.00', Face_Value: '10.00', Market_Lot: '1200' },
  2_700_000, { min: 95, max: 99 }, '2026-08-19', '2026-08-21', today);

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 6, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
  repo = new IPORepository(db as never, noRedis);
});
beforeEach(async () => { if (db) await cleanup(); });
afterAll(async () => { if (db) await cleanup(); await pool?.end(); });

describe.skipIf(!DATABASE_URL)('OD-85 source record keys on the real resolver + repository (ipodhan_test)', () => {
  it('CORE — Dhanwel 7794 (postponed) then 7900: ONE row with the August dates, 7794 SUPERSEDED, re-reading 7794 writes nothing', async () => {
    expect(DHANWEL_7794[0].attrs!.postponed).toBe(true);
    const base = { companyName: 'Dhanwel Hybrid Seeds Ltd', priceRangeMin: 95, priceRangeMax: 99, segment: 'SME' as const, symbol: 'DHANWEL' };
    expect(await ingest({ ...base, openDate: '2026-06-23', closeDate: '2026-06-23', keys: DHANWEL_7794 })).toBe('created');
    expect(await ingest({ ...base, openDate: '2026-08-19', closeDate: '2026-08-21', keys: DHANWEL_7900 })).toBe('bound');

    const rows = await rowsNamed('Dhanwel Hybrid Seeds Ltd');
    expect(rows.map((r) => [String(r.openDate).slice(0, 10), String(r.closeDate).slice(0, 10)])).toEqual([['2026-08-19', '2026-08-21']]);
    const keys = await keysOf(rows[0].id);
    const byValue = Object.fromEntries(keys.map((k) => [k.keyValue, k]));
    expect(byValue['7900'].state).toBe('ACTIVE');
    expect(byValue['7794'].state).toBe('SUPERSEDED');
    expect(byValue['7794'].supersededBy).toBe(byValue['7900'].id);

    const before = { row: (await rowsNamed('Dhanwel Hybrid Seeds Ltd'))[0], keys: await keysOf(rows[0].id) };
    expect(await ingest({ ...base, openDate: '2026-06-23', closeDate: '2026-06-23', keys: DHANWEL_7794 })).toBe('superseded');
    const after = { row: (await rowsNamed('Dhanwel Hybrid Seeds Ltd'))[0], keys: await keysOf(rows[0].id) };
    expect(String(after.row.openDate).slice(0, 10)).toBe('2026-08-19');
    expect(after.row.updatedAt).toEqual(before.row.updatedAt);
    expect(after.keys.length).toBe(before.keys.length);
    // F-145: bse_ipo_no follows the ACTIVE key, whichever record was read last.
    expect(await activeBseIpoNo(repo!, rows[0].id)).toBe(7900);
    await recordBseDiscoveryMetadata(repo!, rows[0].id, { bseIpoNo: 7794 });
    expect((await rowsNamed('Dhanwel Hybrid Seeds Ltd'))[0].bseIpoNo).toBe(7900);
  });

  it('IC Electricals ICEL -> ICELCO (same CIN, shares, band; older postponed) supersedes; a second CG id with a differing band is held', async () => {
    const cin = 'U31909DL2005PLC139412';
    const attrs = { shares: 4_839_600, priceMin: 94, priceMax: 99 };
    const base = { companyName: 'IC Electricals Company Ltd', priceRangeMin: 94, priceRangeMax: 99, segment: 'SME' as const, cin };
    expect(await ingest({ ...base, openDate: '2026-06-24', symbol: 'ICEL', keys: [
      { source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'ICEL|SME', attrs: { ...attrs, postponed: true }, recordOpenDate: '2026-06-24' },
      { source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '2790', attrs, recordOpenDate: '2026-06-24' },
    ] })).toBe('created');
    expect(await ingest({ ...base, openDate: '2026-07-22', symbol: 'ICELCO', keys: [
      { source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'ICELCO|SME', attrs, recordOpenDate: '2026-07-22' },
    ] })).toBe('bound');
    const [row] = await rowsNamed('IC Electricals Company Ltd');
    const keys = Object.fromEntries((await keysOf(row.id)).map((k) => [k.keyValue, k.state]));
    expect(keys).toEqual({ 'ICEL|SME': 'SUPERSEDED', 'ICELCO|SME': 'ACTIVE', '2790': 'ACTIVE' });
    expect(await ingest({ ...base, openDate: '2026-07-22', priceRangeMin: 94, keys: [
      { source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '2999', attrs: { shares: 4_839_600, priceMin: 100, priceMax: 105 }, recordOpenDate: '2026-07-22' },
    ] })).toBe('held');
    expect((await keysOf(row.id)).map((k) => k.keyValue).sort()).toEqual(['2790', 'ICEL|SME', 'ICELCO|SME']);
  });

  it('Hero Motors shape: a WITHDRAWN row\'s key does not bind the new attempt — it is RELEASED and the new record gets its own row', async () => {
    expect(await ingest({ companyName: 'Hero Motors Ltd', openDate: null, priceRangeMin: null, segment: 'MAINBOARD', status: 'WITHDRAWN',
      keys: [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '2225' }] })).toBe('created');
    const [old] = await rowsNamed('Hero Motors Ltd');
    await db!.update(schema.ipos).set({ slug: 'hero-motors-ltd-draft-2024' }).where(eq(schema.ipos.id, old.id));
    expect(await ingest({ companyName: 'Hero Motors Ltd', openDate: '2026-09-16', closeDate: '2026-09-18', priceRangeMin: 465, segment: 'MAINBOARD',
      keys: [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '2225' }, { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '7971' }] })).toBe('created');
    const rows = await rowsNamed('Hero Motors Ltd');
    expect(rows.length).toBe(2);
    expect((await keysOf(old.id)).map((k) => [k.keyValue, k.state, k.bindingValue])).toEqual([['2225', 'RELEASED', null]]);
    const fresh = rows.find((r) => r.id !== old.id)!;
    expect((await keysOf(fresh.id)).map((k) => k.state)).toEqual(['ACTIVE', 'ACTIVE']);
  });

  it('Rays of Belief: keys split across two rows -> duplicate reported, nothing written; "MOMSBELIEF " trims to the same key', async () => {
    const base = { priceRangeMin: 227, segment: 'MAINBOARD' as const, openDate: '2026-09-01' };
    expect(nseIssueKeyValue('MOMSBELIEF ', 'EQ')).toBe('MOMSBELIEF|EQ');
    await ingest({ ...base, companyName: 'Rays of Belief Ltd', symbol: 'MOMSBELIEF',
      keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'MOMSBELIEF|EQ' }] });
    const [a] = await rowsNamed('Rays of Belief Ltd');
    // the second row of the live pair (rays-of-belief-ltd-o), seeded directly as it exists on staging
    const [b] = await db!.insert(schema.ipos).values({ companyName: 'Rays of Belief Ltd', slug: 'rays-of-belief-ltd-o', offeringType: 'IPO',
      segment: 'MAINBOARD', status: 'UPCOMING', openDate: '2026-09-01', priceRangeMin: 227 } as never).returning();
    await repo!.bindSourceKeys(b.id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '7920' }], { boundVia: 'BACKFILL', boundBy: 'od85.test' });
    const snapshot = JSON.stringify(await rowsNamed('Rays of Belief Ltd'));
    expect(await ingest({ ...base, companyName: 'Rays of Belief Ltd', symbol: 'MOMSBELIEF ', keys: [
      { source: 'NSE', keyType: 'NSE_ISSUE', keyValue: nseIssueKeyValue('MOMSBELIEF ', 'EQ')! },
      { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '7920' },
    ] })).toBe('duplicate');
    expect(JSON.stringify(await rowsNamed('Rays of Belief Ltd'))).toBe(snapshot);
    expect((await keysOf(a.id)).length + (await keysOf(b.id)).length).toBe(2);
    // the trimmed symbol alone binds the one row
    expect(await ingest({ ...base, companyName: 'Rays of Belief Ltd', symbol: 'MOMSBELIEF ',
      keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: nseIssueKeyValue('MOMSBELIEF ', 'EQ')! }] })).toBe('bound');
  });

  it('look-alikes: a wrong key bind is caught by the ISIN re-check -> key DISPUTED, nothing written (Himalaya values)', async () => {
    await ingest({ companyName: 'Himalayan Solar Ltd', openDate: '2026-09-25', priceRangeMin: 98, segment: 'SME', symbol: 'HIMALAYAN',
      isin: 'INE1B7I01014', keys: [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '2716' }] });
    const [solar] = await rowsNamed('Himalayan Solar Ltd');
    expect(await ingest({ companyName: 'Himalaya Nutravedics India Ltd', openDate: '2026-09-22', priceRangeMin: null, segment: 'SME',
      isin: 'INE1OTR01013', keys: [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '2716' }] })).toBe('held');
    expect((await keysOf(solar.id)).map((k) => [k.state, k.bindingValue])).toEqual([['DISPUTED', null]]);
    expect((await rowsNamed('Himalayan Solar Ltd'))[0].updatedAt).toEqual(solar.updatedAt);
    expect(await rowsNamed('Himalaya Nutravedics India Ltd')).toEqual([]);
  });

  it('a later NSE OFS under the IPO row\'s symbol gets its own row (series in the key + type re-check)', async () => {
    await ingest({ companyName: 'OD85 Coalx Ltd', openDate: '2026-03-02', priceRangeMin: 50, segment: 'MAINBOARD', symbol: 'COALX', status: 'LISTED',
      keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'COALX|EQ' }] });
    expect(await ingest({ companyName: 'OD85 Coalx Ltd', slug: 'od85-coalx-ltd-ofs-2026', openDate: '2026-09-20', priceRangeMin: 60, segment: 'MAINBOARD',
      symbol: 'COALX', offeringType: 'OFS', offeringTypeExplicit: true, keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'COALX|OFS' }] })).toBe('created');
    // the OFS record's key never landed on the IPO row
    const rows = await rowsNamed('OD85 Coalx Ltd');
    const ipoRow = rows.find((r) => r.offeringType === 'IPO')!;
    expect((await keysOf(ipoRow.id)).map((k) => k.keyValue)).toEqual(['COALX|EQ']);
    // and a key that DID hit the IPO row fails the offering-type re-check
    expect(await ingest({ companyName: 'OD85 Coalx Ltd', openDate: '2026-03-02', priceRangeMin: 50, segment: 'MAINBOARD',
      offeringType: 'OFS', offeringTypeExplicit: true, keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'COALX|EQ' }] })).toBe('held');
  });

  it('a RELEASED NSE key (N days after listing) is reusable by a new company', async () => {
    await ingest({ companyName: 'OD85 Newco Ltd', openDate: '2026-06-01', priceRangeMin: 10, segment: 'MAINBOARD', status: 'LISTED',
      keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'REUSE|EQ' }] });
    const [old] = await rowsNamed('OD85 Newco Ltd');
    await db!.update(schema.ipos).set({ listingDate: '2026-06-10' } as never).where(eq(schema.ipos.id, old.id));
    const released = await releaseEndedSourceKeys(db as never, { nseDaysAfterListing: 30 });
    expect(released.nseReleased).toBeGreaterThanOrEqual(1);
    expect(await ingest({ companyName: 'OD85 Reuse Ltd', openDate: '2026-10-01', priceRangeMin: 20, segment: 'SME',
      keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'REUSE|EQ' }] })).toBe('created');
    const [fresh] = await rowsNamed('OD85 Reuse Ltd');
    expect((await keysOf(old.id)).map((k) => k.state)).toEqual(['RELEASED']);
    expect((await keysOf(fresh.id)).map((k) => k.state)).toEqual(['ACTIVE']);
  });

  it('merge repoints keys to the survivor and logs their ids; the table carries no partial/expression unique index', async () => {
    const [keep] = await db!.insert(schema.ipos).values({ companyName: 'OD85 Merge Probe Ltd', slug: 'od85-merge-probe-ltd', offeringType: 'IPO',
      segment: 'SME', status: 'UPCOMING', openDate: '2026-10-10', priceRangeMin: 40 } as never).returning();
    const [drop] = await db!.insert(schema.ipos).values({ companyName: 'OD85 Merge Probe Ltd', slug: 'od85-merge-probe-ltd-o', offeringType: 'IPO',
      segment: 'SME', status: 'UPCOMING', openDate: '2026-10-10', priceRangeMin: 40 } as never).returning();
    const res = await repo!.bindSourceKeys(drop.id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '8801' }], { boundVia: 'BACKFILL', boundBy: 'od85.test' });
    await repo!.mergeDuplicateInto(keep.id, drop.id, { apply: true, mergedBy: 'od85.test' } as never);
    expect((await keysOf(keep.id)).map((k) => k.id)).toEqual(res!.insertedIds);
    const log = (await db!.execute(sql`select repointed_child_counts from ipo_merge_log where keep_ipo_id = ${keep.id}`)) as unknown as { rows: { repointed_child_counts: { table: string; repointedIds: string[] }[] }[] };
    const entry = log.rows[0].repointed_child_counts.find((e) => e.table === 'ipo_source_keys')!;
    expect(entry.repointedIds).toEqual(res!.insertedIds);
    const idx = (await db!.execute(sql`
      select count(*)::int as n from pg_index i join pg_class c on c.oid = i.indrelid
      where c.relname = 'ipo_source_keys' and i.indisunique and (i.indpred is not null or i.indexprs is not null)`)) as unknown as { rows: { n: number }[] };
    expect(idx.rows[0].n).toBe(0);
  });

  it('OD-86: the relaunch pair merges despite differing open dates and IPO_NOs; without the postponed flag it is refused', async () => {
    const mk = async (slug: string, open: string, ipoNo: string, postponed: boolean) => {
      const [r] = await db!.insert(schema.ipos).values({ companyName: 'Dhanwel Hybird Seeds Ltd', slug, offeringType: 'IPO', segment: 'SME',
        status: 'UPCOMING', openDate: open, priceRangeMin: 95, priceRangeMax: 99, symbol: 'DHANWEL', bseIpoNo: Number(ipoNo) } as never).returning();
      await repo!.bindSourceKeys(r.id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ipoNo,
        attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed } }], { boundVia: 'BACKFILL', boundBy: 'od85.test' });
      return r;
    };
    const older = await mk('dhanwel-hybird-seeds-ltd', '2026-06-23', '7794', false);
    const newer = await mk('dhanwel-hybird-seeds-ltd-o', '2026-08-19', '7900', false);
    await expect(repo!.mergeDuplicateInto(newer.id, older.id, { apply: true, mergedBy: 'od85.test' } as never)).rejects.toThrow(/open date differs/);
    await db!.update(schema.ipoSourceKeys).set({ attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed: true } }).where(eq(schema.ipoSourceKeys.ipoId, older.id));
    await repo!.mergeDuplicateInto(newer.id, older.id, { apply: true, mergedBy: 'od85.test' } as never);
    expect((await rowsNamed('Dhanwel Hybird Seeds Ltd')).map((r) => r.id)).toEqual([newer.id]);
    expect((await keysOf(newer.id)).map((k) => k.keyValue).sort()).toEqual(['7794', '7900']);
  });

  it('two concurrent creates of one record (same key, two spellings) leave ONE row', async () => {
    const key: SourceKeyRef[] = [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '8899' }];
    const rec = (companyName: string): Rec => ({ companyName, openDate: '2026-11-02', priceRangeMin: 70, segment: 'SME', keys: key });
    const settled = await Promise.allSettled([ingest(rec('OD85 Race Probe Ltd')), ingest(rec('OD85 Race Probe Limited'))]);
    for (const s of settled) if (s.status === 'rejected') expect(String((s.reason as Error)?.message)).toMatch(/Failed to create IPO|duplicate/);
    // the loser re-reads on its next cycle and binds by the key
    expect(await ingest(rec('OD85 Race Probe Limited'))).toBe('bound');
    expect((await rowsNamed('OD85 Race Probe Ltd', 'OD85 Race Probe Limited')).length).toBe(1);
  });
});
