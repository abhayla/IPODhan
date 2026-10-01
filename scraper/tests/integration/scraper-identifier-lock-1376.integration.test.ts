/**
 * #1376 on the real database (ipodhan_test only): a scraper write of a CIN / ISIN / symbol takes the
 * SAME per-value advisory lock admin saves take (identifierLockKey, #1371) and, under it, never puts a
 * value on a second row of the same offering (OD-68: "two IPOs ... that should never happen").
 *
 * The race is interleaved deterministically: an admin-shaped transaction holds the value's lock and
 * writes row A; the scraper write of the same value on row B is started and observed WAITING on the
 * advisory lock (pg_locks), then the admin commits. Before #1376 the scraper write never waited and
 * both rows ended with one CIN.
 *
 * Spec basis: OD-68; §2.3.3 rule 3 ("a shared CIN or ISIN proves the same COMPANY ..., not the same
 * offering"), so only a row of the same offering (OD-35 type + 180-day window, `sameOfferingAs`)
 * refuses; §9.2 item 26.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { lockIdentifierValues, identifierLockKey } from '@ipodhan/shared/services/admin-identifier-alias';
import { getTestDb, cleanupTestDb } from '../test-utils/db';

const A = '00000000-0000-4000-8137-6000000000a1';
const B = '00000000-0000-4000-8137-6000000000b1';
const OFS = '00000000-0000-4000-8137-6000000000c1';
const IDS = [A, B, OFS];
const CIN = 'U12345MH2020PLC137601';
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;
const rows = (r: any) => (r.rows ?? r) as any[];
let db: any;

async function cleanup() {
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
  await db.execute(sql`DELETE FROM ipos WHERE id IN (${A}::uuid, ${B}::uuid, ${OFS}::uuid) OR slug LIKE 'lock1376-%'`);
}
async function insertIpo(id: string, slug: string, offeringType = 'IPO') {
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, status, segment, offering_type, open_date)
    VALUES (${id}::uuid, ${'Lock 1376 ' + slug}, ${slug}, 'UPCOMING', 'MAINBOARD', ${offeringType}, '2026-10-20')`);
}
const cinOf = async (id: string) => rows(await db.execute(sql`SELECT cin FROM ipos WHERE id = ${id}::uuid`))[0]?.cin ?? null;
async function waitForAdvisoryWaiter(timeoutMs = 5000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const n = rows(await db.execute(sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`))[0].n;
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
/** Runs `scraperWrite` while an admin-shaped transaction holds CIN's lock and has written it on A. */
async function raceAgainstAdmin<T>(scraperWrite: () => Promise<T>): Promise<{ result: T; waited: boolean }> {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const admin = db.transaction(async (tx: any) => {
    await lockIdentifierValues(tx, [identifierLockKey('cin', CIN)]);
    await tx.update(schema.ipos).set({ cin: CIN }).where(eq(schema.ipos.id, A));
    locked();
    await released;
  });
  await isLocked;
  const write = scraperWrite();
  const waited = await waitForAdvisoryWaiter(3000);
  release();
  await admin;
  return { result: await write, waited };
}

describe('scraper identifier writes take the admin per-value lock (#1376, ipodhan_test)', () => {
  beforeAll(async () => {
    db = await getTestDb();
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
  });
  beforeEach(async () => {
    await cleanup();
    await insertIpo(A, 'lock1376-a');
    await insertIpo(B, 'lock1376-b');
  });
  afterAll(async () => {
    if (db) await cleanup();
    await cleanupTestDb();
  });

  it('update: the scraper write waits for the admin save, then refuses the CIN the admin gave row A', async () => {
    const repo = new IPORepository(db, noRedis);
    const { result, waited } = await raceAgainstAdmin(() => repo.updateReportingHolds(B, { cin: CIN } as never));
    expect(waited, 'the scraper write must wait on the value lock').toBe(true);
    expect(await cinOf(A)).toBe(CIN);
    expect(await cinOf(B)).toBeNull();
    expect(result.dropped).toContain('cin');
  });

  it('create: a new row is created without a CIN another row of the same offering holds', async () => {
    const repo = new IPORepository(db, noRedis);
    const { result, waited } = await raceAgainstAdmin(() =>
      repo.create({
        companyName: 'Lock 1376 Created', slug: 'lock1376-created', status: 'UPCOMING', segment: 'MAINBOARD',
        offeringType: 'IPO', openDate: '2026-10-21', cin: CIN,
      } as never)
    );
    expect(waited).toBe(true);
    expect(result.cin ?? null).toBeNull();
    expect(await cinOf(A)).toBe(CIN);
  });

  it('a row of a DIFFERENT offering (an OFS of the same company) may carry the same CIN (spec §2.3.3 rule 3)', async () => {
    await insertIpo(OFS, 'lock1376-ofs', 'OFS');
    await db.update(schema.ipos).set({ cin: CIN }).where(eq(schema.ipos.id, A));
    const repo = new IPORepository(db, noRedis);
    const r = await repo.updateReportingHolds(OFS, { cin: CIN } as never);
    expect(r.dropped).not.toContain('cin');
    expect(await cinOf(OFS)).toBe(CIN);
  });

  it('re-writing the value a row already holds is not a new claim and is never dropped', async () => {
    await db.update(schema.ipos).set({ cin: CIN }).where(inArray(schema.ipos.id, [A, B]));
    const repo = new IPORepository(db, noRedis);
    const r = await repo.updateReportingHolds(B, { cin: CIN } as never);
    expect(r.dropped).not.toContain('cin');
  });
});
