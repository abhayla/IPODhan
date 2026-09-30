/**
 * §9.2 item 23 (OD-116 as corrected by OD-118): an admin HIDES a row, never deletes it.
 *
 * Proven end to end on ipodhan_test with the REAL functions:
 *   (a) every public list / search query excludes the hidden row (admin lists opt in);
 *   (b) the address answers 410 Gone (middleware) and the page-level lookup refuses it, without
 *       falling through to a neighbouring IPO;
 *   (c) an incoming record carrying the row's symbol / CIN still BINDS the row (IpoHiddenError),
 *       so nothing is recreated;
 *   (d) the field-plan walk does not claim the row;
 *   (e) unhide restores all of it, and both actions write an audit_logs row.
 *
 * To run (from web/, ONE AT A TIME):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *   REDIS_URL=redis://localhost:6379/15 \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/ipo-hide-row.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import * as schema from '@ipodhan/shared/db/schema';
import {
  IPORepository as SharedIPORepository,
  IpoFieldPlanRepository,
  resolveIpoRow,
  IpoHiddenError,
  GMPRepository as SharedGMPRepository,
} from '@ipodhan/shared';
import { FieldProtectionService } from '@ipodhan/shared/admin/field-protection-checker';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { hideIpo, unhideIpo, IPO_HIDDEN_ACTION, IPO_UNHIDDEN_ACTION } from '@/lib/services/ipo-visibility-service';
import { isHiddenIpoSlug, resetHiddenIpoSlugCache } from '@/lib/ipo-visibility/hidden-ipo-slugs';
import { middleware } from '@/middleware';

const DATABASE_URL = process.env.DATABASE_URL;

const HIDDEN_ID = '00000000-0000-4000-9023-000000000001';
const NEIGHBOUR_ID = '00000000-0000-4000-9023-000000000002';
const HIDDEN_NAME = 'Item23 Hidden Probe Coal Ltd';
const HIDDEN_SLUG = 'item23-hidden-probe-coal-ltd';
const NEIGHBOUR_NAME = 'Item23 Hidden Probe Coal Limited';
const NEIGHBOUR_SLUG = 'item23-hidden-probe-coal-limited';
const SYMBOL = 'ITM23HID';
const CIN = 'L10100WB1973GOI028844';
const SECTOR = 'Item23 Probe Sector';

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
  scan: async () => ['0', []],
} as never;

describe.skipIf(!DATABASE_URL)('§9.2 item 23: hide a row (410, out of lists, still bound, not walked)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let webRepo: IPORepository;
  let sharedRepo: SharedIPORepository;
  let planRepo: IpoFieldPlanRepository;

  async function cleanup() {
    const ids = [HIDDEN_ID, NEIGHBOUR_ID];
    await db.delete(schema.gmpRecords).where(inArray(schema.gmpRecords.ipoId, ids));
    await db.execute(sql`DELETE FROM brlm_track_record WHERE source_ipo_id IN (${HIDDEN_ID}::uuid, ${NEIGHBOUR_ID}::uuid)`);
    await db.delete(schema.subscriptions).where(inArray(schema.subscriptions.ipoId, ids));
    await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, ids));
    await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, ids));
    await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, ids));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const { rows } = await pool.query('select current_database() as d');
    if (rows[0].d !== 'ipodhan_test') throw new Error(`Refusing to run against ${rows[0].d}`);
    db = drizzle(pool, { schema });
    webRepo = new IPORepository(db as never, noRedis);
    sharedRepo = new SharedIPORepository(db as never, noRedis);
    planRepo = new IpoFieldPlanRepository(db as never, noRedis);
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, segment, category, status, open_date, close_date, listing_date, sector, symbol, cin)
      VALUES
        (${HIDDEN_ID}::uuid, ${HIDDEN_NAME}, ${HIDDEN_SLUG}, 'IPO', 'MAINBOARD', 'MAINBOARD', 'LISTED', '2026-01-05', '2026-01-07', '2026-01-12', ${SECTOR}, ${SYMBOL}, ${CIN}),
        (${NEIGHBOUR_ID}::uuid, ${NEIGHBOUR_NAME}, ${NEIGHBOUR_SLUG}, 'IPO', 'MAINBOARD', 'MAINBOARD', 'LISTED', '2026-02-05', '2026-02-07', '2026-02-12', ${SECTOR}, NULL, NULL)
    `);
    await db.insert(schema.ipoFieldPlan).values({
      ipoId: HIDDEN_ID,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'issueSize',
      rank1Source: 'NSE',
      state: 'PENDING',
      manifestVersion: 1,
      nextDueAt: null,
    } as never);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await cleanup();
    await pool.end();
  }, 60000);

  async function publicIds(): Promise<Record<string, boolean>> {
    const list = await webRepo.findAll({ search: 'Item23 Hidden Probe', limit: 50 });
    const history = await webRepo.findHistorical({ search: 'Item23 Hidden Probe', limit: 50 } as never);
    const search = await webRepo.search('Item23 Hidden Probe Coal', 10);
    const count = await webRepo.count({ search: 'Item23 Hidden Probe' } as never);
    const peers = await webRepo.findPeers(NEIGHBOUR_ID, SECTOR, 10);
    const has = (rows: Array<{ id: string }>) => rows.some((r) => r.id === HIDDEN_ID);
    return {
      findAll: has(list.data),
      findHistorical: has(history.data as unknown as Array<{ id: string }>),
      search: has(search),
      countIncludesBoth: count === 2,
      peers: has(peers as Array<{ id: string }>),
      bySlug: (await webRepo.findBySlug(HIDDEN_SLUG)) !== null,
      byId: (await webRepo.findById(HIDDEN_ID)) !== null,
    };
  }

  async function slugStatus(): Promise<number> {
    resetHiddenIpoSlugCache();
    const res = await middleware(new NextRequest(`http://localhost/ipos/${HIDDEN_SLUG}`));
    return res.status;
  }

  async function bindOutcome(): Promise<string> {
    try {
      const row = await resolveIpoRow(sharedRepo as never, {
        companyName: 'ITEM23 HIDDEN PROBE COAL LIMITED (renamed)',
        normalizedName: 'item23 hidden probe coal renamed',
        slug: 'item23-hidden-probe-coal-renamed',
        symbol: SYMBOL,
        cin: CIN,
        openDate: '2026-01-05',
        priceRangeMin: null,
        segment: 'MAINBOARD',
      } as never);
      return row ? `bound:${row.id}` : 'none';
    } catch (error) {
      if (error instanceof IpoHiddenError) return `hidden:${error.ipoId}`;
      throw error;
    }
  }

  async function claimable(): Promise<boolean> {
    const row = await planRepo.claimNextDueField({ ipoId: HIDDEN_ID });
    if (row) await db.update(schema.ipoFieldPlan).set({ claimedAt: null } as never).where(eq(schema.ipoFieldPlan.id, row.id));
    return row !== null;
  }

  it('visible row: in every public read, 200-path, bound, walked', async () => {
    expect(await publicIds()).toEqual({
      findAll: true, findHistorical: true, search: true, countIncludesBoth: true, peers: true, bySlug: true, byId: true,
    });
    expect(await slugStatus()).toBe(200);
    expect(await bindOutcome()).toBe(`bound:${HIDDEN_ID}`);
    expect(await claimable()).toBe(true);
  });

  it('refuses a hide without a written reason', async () => {
    const out = await hideIpo(db as never, { ipoId: HIDDEN_ID, reason: '  ', actor: { adminName: 'item23-test', adminId: null } });
    expect(out).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
  });

  it('hidden row: out of every public read, 410, still bound (nothing created), not walked, audited', async () => {
    const out = await hideIpo(db as never, {
      ipoId: HIDDEN_ID,
      reason: 'Not an IPO: a listed PSU stored as a CLOSED IPO (F-174)',
      actor: { adminName: 'item23-test', adminId: null },
    });
    expect(out).toMatchObject({ ok: true, ipoId: HIDDEN_ID, slug: HIDDEN_SLUG });

    expect(await publicIds()).toEqual({
      findAll: false, findHistorical: false, search: false, countIncludesBoth: false, peers: false, bySlug: false, byId: false,
    });
    // the page-level guard: no fuzzy hand-off to the neighbour
    expect(await webRepo.findBySlugWithFallback(HIDDEN_SLUG)).toBeNull();
    // admins still see it
    expect((await webRepo.findById(HIDDEN_ID, { includeHidden: true }))?.id).toBe(HIDDEN_ID);
    const adminList = await webRepo.findAll({ search: 'Item23 Hidden Probe', limit: 50, includeHidden: true });
    expect(adminList.data.map((r) => r.id)).toContain(HIDDEN_ID);

    expect(await slugStatus()).toBe(410);
    expect(await isHiddenIpoSlug(NEIGHBOUR_SLUG)).toBe(false);

    expect(await bindOutcome()).toBe(`hidden:${HIDDEN_ID}`);
    const bySymbol = await db.select({ id: schema.ipos.id }).from(schema.ipos).where(eq(schema.ipos.symbol, SYMBOL));
    expect(bySymbol.map((r) => r.id)).toEqual([HIDDEN_ID]);

    expect(await claimable()).toBe(false);

    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.ipoId, HIDDEN_ID), eq(schema.auditLogs.actionType, IPO_HIDDEN_ACTION)));
    expect(audit).toHaveLength(1);
    expect(audit[0].newValue).toBe('Not an IPO: a listed PSU stored as a CLOSED IPO (F-174)');
    expect(audit[0].adminUser).toBe('item23-test');
  });

  it('hidden row: the lock gate refuses it; no DB trigger; visible rows still take every write', async () => {
    // (1) The gate the GMP orchestrator and every lock-checking writer asks (it finds rows by
    // dates / name, never through identity): a hidden row is locked, a visible one is not.
    const protection = new FieldProtectionService(db as never, null);
    expect(await protection.isIPOLocked(HIDDEN_ID)).toBe(true);
    expect(await protection.isIPOLocked(NEIGHBOUR_ID)).toBe(false);

    // (2) No DB trigger (round 3, OD-150): the predicate blocks writes; the database does not.
    // A DB-level block with a hand-typed table list broke every brlm_track_record write (round 2).
    // Proof it is gone: no trigger calls a hide function on any table that references ipos.id,
    // and the same raw writes land for a VISIBLE row, brlm_track_record (source_ipo_id) included.
    const triggers = await pool.query(
      `SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_proc f ON f.oid = g.tgfoid
        WHERE NOT g.tgisinternal AND f.prosrc ILIKE '%hidden_at%'`
    );
    expect(triggers.rows).toEqual([]);
    const gmpRepo = new SharedGMPRepository(db as never, noRedis);
    await gmpRepo.create({ ipoId: NEIGHBOUR_ID, timestamp: new Date(), gmp: 12, source: 'INVESTORGAIN_GMP' } as never);
    await pool.query('INSERT INTO subscriptions (ipo_id, timestamp) VALUES ($1, now())', [NEIGHBOUR_ID]);
    await pool.query(
      `INSERT INTO brlm_track_record (brlm_name, as_of_date, source_ipo_id) VALUES ('Item23 Probe BRLM', '2026-01-01', $1)`,
      [NEIGHBOUR_ID]
    );
    const neighbour = await db.select({ id: schema.gmpRecords.id }).from(schema.gmpRecords).where(eq(schema.gmpRecords.ipoId, NEIGHBOUR_ID));
    expect(neighbour).toHaveLength(1);
    const brlm = await pool.query('SELECT count(*)::int AS n FROM brlm_track_record WHERE source_ipo_id = $1', [NEIGHBOUR_ID]);
    expect(brlm.rows[0].n).toBe(1);
  });

  it('unhide restores every surface and is audited', async () => {
    const out = await unhideIpo(db as never, { ipoId: HIDDEN_ID, actor: { adminName: 'item23-test', adminId: null } });
    expect(out).toMatchObject({ ok: true, hiddenAt: null });
    expect(await publicIds()).toEqual({
      findAll: true, findHistorical: true, search: true, countIncludesBoth: true, peers: true, bySlug: true, byId: true,
    });
    expect(await slugStatus()).toBe(200);
    expect(await bindOutcome()).toBe(`bound:${HIDDEN_ID}`);
    expect(await claimable()).toBe(true);
    const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, HIDDEN_ID));
    expect(row.hiddenReason).toBeNull();
    expect(row.companyName).toBe(HIDDEN_NAME);
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.ipoId, HIDDEN_ID), eq(schema.auditLogs.actionType, IPO_UNHIDDEN_ACTION)));
    expect(audit).toHaveLength(1);
  });
});
