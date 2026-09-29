import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { applyExchangeOverride } from '../../../packages/shared/src/services/exchange-override';
import { fieldSourceCacheKeys } from '../../../packages/shared/src/repositories/field-sources-repository';
import type { FieldFetcher, FieldFetcherAnswer, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';

/**
 * OD-106 / OD-117 / §2.7 / §9.2 items 7, 16, 25, 28(a). An admin holds `ipos.close_date` through the
 * REAL admin write path; a walk pass (production hold deps, production override transaction, the
 * Notifier stubbed) reads the held field's sources:
 *   - NSE now states a NEWER, different date -> the exchange date replaces the admin's, provenance
 *     is NSE, the hold is released, an audit row (SYSTEM, OD-106) keeps the admin value, one alert;
 *   - NSE states the SAME date it stated when the admin saved -> nothing changes.
 * Values are F-131's (Dhanwel): held close date 2026-06-29, NSE's relaunch board 2026-08-21.
 *
 * Runs only against `ipodhan_test` (refuses any other database).
 */
process.env.ENABLE_VERDICT_WRITER = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const IPO_ID = '00000000-0000-4000-8000-0000000d1061';
const SLUG = 'od106-exchange-override-proof-ipo';
const HELD = '2026-06-29';
const NSE_NEW = '2026-08-21';
/** What NSE said before the admin saved, on a hold saved before exchangeAtSave existed. */
const NSE_OLD = '2026-07-10';

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)('OD-106: a newer exchange date replaces an admin-held E-1 date (ipodhan_test)', () => {
  let pool: Pool;
  let redis: Redis;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let planRepo: IpoFieldPlanRepository;
  let walkFieldPlanForIPO: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let buildFieldPlanWalkHoldDeps: typeof import('../../src/services/field-plan-walk-deps.js').buildFieldPlanWalkHoldDeps;
  let buildExchangeOverrideHook: typeof import('../../src/services/exchange-override-hook.js').buildExchangeOverrideHook;
  let redisClaims: typeof import('../../src/services/live-slot-miss-monitor.js').redisClaims;
  let invalidateIPOCaches: typeof import('../../src/services/cache-invalidator.js').invalidateIPOCaches;

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID));
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO_ID}::uuid`);
    const keys = await redis.keys(`*${IPO_ID}*`);
    if (keys.length > 0) await redis.del(...keys);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const current = (await pool.query('select current_database()')).rows[0].current_database as string;
    if (current !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${current}', not 'ipodhan_test'.`);
    db = drizzle(pool, { schema });
    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();
    ({ walkFieldPlanForIPO } = await import('../../src/services/field-plan-walk.js'));
    ({ buildFieldPlanWalkHoldDeps } = await import('../../src/services/field-plan-walk-deps.js'));
    ({ buildExchangeOverrideHook } = await import('../../src/services/exchange-override-hook.js'));
    ({ redisClaims } = await import('../../src/services/live-slot-miss-monitor.js'));
    ({ invalidateIPOCaches } = await import('../../src/services/cache-invalidator.js'));
    planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    await cleanup();
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
    if (redis) await redis.quit();
  }, 60000);

  /** The IPO as NSE first published it: close date + NSE provenance with NSE's witness. */
  async function seed(nseAtSave: string, bseAtSave?: string) {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector, close_date)
      VALUES (${IPO_ID}::uuid, 'OD106 Exchange Override Proof Limited', ${SLUG}, 'MAINBOARD', 'OPEN',
              'Proof Registrar Ltd', 'Proof Sector', ${nseAtSave}::date)`);
    const at = new Date('2026-06-20T05:00:00Z');
    await db.insert(schema.fieldSources).values({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'closeDate',
      source: 'NSE',
      confidence: 100,
      witnesses: [
        { source: 'NSE', value: nseAtSave, at: at.toISOString(), outcome: 'SUPPLIED' },
        ...(bseAtSave ? [{ source: 'BSE', value: bseAtSave, at: at.toISOString(), outcome: 'SUPPLIED' }] : []),
      ],
      updatedAt: at,
      createdAt: at,
    } as never);
  }

  async function adminHolds(value: string | null, typed = true) {
    const v = await readAdminFieldVersion(db as never, IPO_ID, 'ipos', 'closeDate');
    const saved = await writeAdminFieldValue(db as never, {
      ipoId: IPO_ID,
      tableName: 'ipos',
      fieldName: 'closeDate',
      value,
      // OD-121: a null value is the admin deleting the date (an admin EMPTY, item 28(a)).
      ...(value === null ? { empty: { reason: 'the relaunched offer has no close date yet' } } : {}),
      mode: typed ? { kind: 'typed', sourceNote: 'exchange circular, page 1' } : { kind: 'typed', sourceNote: 're-save' },
      expectedVersion: v!.version,
      actor: { name: 'od106-test-admin', adminId: 'admin-od106-it' },
      entryPoint: 'test',
      overrideReason: 'proof fixture',
    });
    expect(saved.kind, JSON.stringify(saved)).toBe('OK');
  }

  /**
   * MAJOR-1: turn the admin's save into one saved BEFORE this change: no exchangeAtSave in the
   * lineage. `previousSource` is what the ADMIN row says the value came from before the save.
   */
  async function makeLegacyHold(previousSource: string) {
    await db.execute(sql`
      UPDATE field_sources
         SET data_lineage = data_lineage - 'exchangeAtSave' - 'exchangeBaselineOrigin',
             previous_source = ${previousSource}
       WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'closeDate'`);
  }

  /** 'THROW' = the fetcher throws (a FAILED witness); an object = that exact fetcher answer. */
  type Says = string | 'THROW' | FieldFetcherAnswer;
  function fetcherFor(says: Says | undefined, whenAbsent: FieldFetcherAnswer): FieldFetcher {
    return async () => {
      if (says === 'THROW') throw new Error('ECONNRESET reading the exchange (integration fixture)');
      if (says === undefined) return whenAbsent;
      return typeof says === 'string' ? { outcome: 'SUPPLIED', value: says } : says;
    };
  }

  async function walkOnce(nseSays: Says, bseSays?: Says) {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    const [plan] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName: 'close_date',
        rank1Source: 'NSE',
        rank2Source: 'BSE',
        rank3Source: 'CHITTORGARH',
        state: 'PENDING',
        manifestVersion: 2,
        nextDueAt: null,
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });
    const nse = fetcherFor(nseSays, { outcome: 'NOT_AVAILABLE_YET' });
    const bse = fetcherFor(bseSays, { outcome: 'NOT_AVAILABLE_YET' });
    const cg: FieldFetcher = async () => ({ outcome: 'NOT_PRINTED' });
    const orchestrator = {
      consolidatedUpsertIPO: async () => {
        throw new Error('a held field must never reach the writer');
      },
      consolidatedUpsertChildRows: async () => {
        throw new Error('a held field must never reach the writer');
      },
    } as unknown as FieldPlanWalkOrchestrator;
    const alerts: Array<{ title: string; opts: { body?: string; dedupeKey?: string } }> = [];
    const production = buildFieldPlanWalkHoldDeps(redis as never);
    expect(typeof production.onHeldFieldAnswers).toBe('function');
    const deps = {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { NSE: nse, BSE: bse, CHITTORGARH: cg },
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({
        ranks: ['NSE', 'BSE', 'CHITTORGARH'],
        documentType: 'PRICE_BAND_AD' as const,
        origin: { kind: 'registry' as const, version: 2 },
        na: false,
      })) as never,
      ...production,
      // The production hook with the test database and a stubbed Notifier (never a real alert).
      onHeldFieldAnswers: buildExchangeOverrideHook({
        apply: (input) => applyExchangeOverride(db as never, input),
        send: async (_sev, title, opts) => {
          alerts.push({ title, opts });
          return { sent: true };
        },
        ...redisClaims(redis as never),
        invalidateCaches: (id, slug, field) => invalidateIPOCaches(redis as never, id, slug, field),
        env: 'it',
      }),
    };
    const result = await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    return { plan, alerts, result };
  }

  async function state() {
    const [ipo] = await db.select({ closeDate: schema.ipos.closeDate }).from(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    const [fs] = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.fieldName, 'closeDate')));
    const [hold] = await db
      .select()
      .from(schema.fieldProtectionMetadata)
      .where(and(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID), eq(schema.fieldProtectionMetadata.fieldName, 'closeDate')));
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO_ID));
    const queue = await db
      .select()
      .from(schema.dataConflicts)
      .where(and(eq(schema.dataConflicts.ipoId, IPO_ID), eq(schema.dataConflicts.fieldName, 'closeDate')));
    return { ipo, fs, hold, audits, queue };
  }

  beforeEach(async () => {
    await cleanup();
  });

  it('NSE newly states a different date: it replaces the admin date, the hold is released, audit + one alert', async () => {
    await seed(HELD);
    await adminHolds(HELD);
    const before = await state();
    expect((before.fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: HELD });
    expect(before.hold.isProtected).toBe(true);
    // MINOR: the override clears the IPO's cached reads (the same SSOT keys every IPO write drops).
    await redis.set(`ipo:id:${IPO_ID}`, 'stale');
    await redis.set(`ipo:slug:${SLUG}`, 'stale');
    // MINOR-4: and the field-source cache keys (FieldSourcesRepository's key builder).
    const fsKeys = fieldSourceCacheKeys(IPO_ID, 'ipos', 'closeDate', '');
    for (const k of fsKeys) await redis.set(k, 'stale');

    const { plan, alerts, result } = await walkOnce(NSE_NEW);
    expect(await redis.exists(`ipo:id:${IPO_ID}`)).toBe(0);
    expect(await redis.exists(`ipo:slug:${SLUG}`)).toBe(0);
    for (const k of fsKeys) expect(await redis.exists(k)).toBe(0);
    expect(result.fieldsSkippedProtected).toBe(1);

    const after = await state();
    expect(after.ipo.closeDate).toBe(NSE_NEW);
    expect(after.fs.source).toBe('NSE');
    expect(after.fs.previousValue).toBe(HELD);
    expect(after.fs.previousSource).toBe('ADMIN');
    expect(after.fs.updatedBy).toBe('SYSTEM');
    expect(after.hold.isProtected).toBe(false);
    const override = after.audits.filter((a) => a.actionType === 'Exchange Override');
    expect(override).toHaveLength(1);
    expect(override[0]).toMatchObject({ adminUser: 'SYSTEM', fieldName: 'closeDate', oldValue: HELD, newValue: NSE_NEW });
    expect((override[0].details as any).reason).toBe('OD-106');
    // The admin's own save is still in the trail.
    expect(after.audits.some((a) => a.actionType === 'Field Updated' && a.newValue === HELD)).toBe(true);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('OD106 Exchange Override Proof Limited');
    expect(alerts[0].opts.body).toContain(HELD);
    expect(alerts[0].opts.body).toContain(NSE_NEW);
    expect(alerts[0].opts.dedupeKey).toMatch(new RegExp(`^admin-od106:it:${IPO_ID}:closeDate:\\d{4}-\\d{2}-\\d{2}$`));
    expect(await redis.exists(alerts[0].opts.dedupeKey!)).toBe(1);

    // The row is no longer held: the claim is released with no held-read stamp.
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(row.claimedAt).toBeNull();
    expect(String(row.cause ?? '')).not.toContain('[held-read:');
  });

  it('NSE states the SAME date it stated when the admin saved: nothing changes', async () => {
    // The admin replaced NSE's 2026-08-21 with 2026-06-29 on purpose; NSE still says 2026-08-21.
    await seed(NSE_NEW);
    await adminHolds(HELD);
    const before = await state();
    expect((before.fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: NSE_NEW });

    const { plan, alerts } = await walkOnce(NSE_NEW);

    const after = await state();
    expect(after.ipo.closeDate).toBe(HELD);
    expect(after.fs.source).toBe('ADMIN');
    expect(after.fs.updatedAt?.getTime()).toBe(before.fs.updatedAt?.getTime());
    expect(after.hold.isProtected).toBe(true);
    expect(after.audits.filter((a) => a.actionType === 'Exchange Override')).toHaveLength(0);
    expect(alerts).toHaveLength(0);
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(String(row.cause ?? '')).toContain('[held-read:');
  });

  it('MAJOR-1: a hold saved before exchangeAtSave: the first held read records the baseline and keeps; a later different read replaces', async () => {
    await seed(NSE_OLD);
    await adminHolds(HELD);
    await makeLegacyHold('CHITTORGARH');
    const before = await state();
    expect((before.fs.dataLineage as any).exchangeAtSave).toBeUndefined();

    // First held read: NSE says what it said before the admin saved (unknown to us). No override.
    const first = await walkOnce(NSE_OLD);
    const mid = await state();
    expect(mid.ipo.closeDate).toBe(HELD);
    expect(mid.fs.source).toBe('ADMIN');
    expect(mid.hold.isProtected).toBe(true);
    expect(mid.audits.filter((a) => a.actionType === 'Exchange Override')).toHaveLength(0);
    expect(first.alerts).toHaveLength(0);
    // Recorded in the same transaction as the held read: NSE's answer, BSE stated nothing yet.
    expect((mid.fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: NSE_OLD, BSE: null });
    expect((mid.fs.dataLineage as any).exchangeBaselineOrigin).toEqual({ NSE: 'FIRST_HELD_READ', BSE: 'FIRST_HELD_READ' });

    // A later read where NSE says something different from that baseline replaces the admin date.
    const second = await walkOnce(NSE_NEW);
    const after = await state();
    expect(after.ipo.closeDate).toBe(NSE_NEW);
    expect(after.fs.source).toBe('NSE');
    expect(after.hold.isProtected).toBe(false);
    expect(after.audits.filter((a) => a.actionType === 'Exchange Override')).toHaveLength(1);
    expect(second.alerts).toHaveLength(1);
  });

  it('MAJOR-1: a hold saved before exchangeAtSave whose ADMIN row says previous_source NSE rebuilds the baseline and replaces at the first read', async () => {
    await seed(NSE_OLD);
    await adminHolds(HELD);
    await makeLegacyHold('NSE');
    const before = await state();
    expect(before.fs.previousValue).toBe(NSE_OLD);

    const { alerts } = await walkOnce(NSE_NEW);
    const after = await state();
    expect(after.ipo.closeDate).toBe(NSE_NEW);
    expect(after.hold.isProtected).toBe(false);
    const [override] = after.audits.filter((a) => a.actionType === 'Exchange Override');
    expect((override.details as any).exchangeAtSave).toMatchObject({ NSE: NSE_OLD });
    expect(alerts).toHaveLength(1);
  });

  it('MAJOR-1: rebuilt from previous_value, NSE still saying that value keeps the admin date', async () => {
    await seed(NSE_OLD);
    await adminHolds(HELD);
    await makeLegacyHold('NSE');

    const { alerts } = await walkOnce(NSE_OLD);
    const after = await state();
    expect(after.ipo.closeDate).toBe(HELD);
    expect(after.hold.isProtected).toBe(true);
    expect(alerts).toHaveLength(0);
  });

  it('ROUND 3 probe: a legacy hold re-saved with no stored NSE witness keeps the rejected NSE value as its baseline', async () => {
    // NSE said 10-05, the admin set 10-06 (a legacy hold: no exchangeAtSave, previous_source NSE).
    await seed('2026-10-05');
    await adminHolds('2026-10-06');
    await makeLegacyHold('NSE');
    // No stored NSE witness at the re-save: absence of evidence is "unknown", never "stated nothing".
    await db.execute(sql`UPDATE field_sources SET witnesses = NULL WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'closeDate'`);
    await adminHolds('2026-10-07', false);
    const saved = await state();
    expect(saved.ipo.closeDate).toBe('2026-10-07');
    // Carried forward from the prior hold's known baseline (previous_value, NSE); BSE unknown.
    expect((saved.fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: '2026-10-05' });

    // NSE still says the value the admin rejected: the admin value stays.
    const still = await walkOnce('2026-10-05');
    const mid = await state();
    expect(mid.ipo.closeDate).toBe('2026-10-07');
    expect(mid.hold.isProtected).toBe(true);
    expect(still.alerts).toHaveLength(0);
    expect(mid.audits.filter((a) => a.actionType === 'Exchange Override')).toHaveLength(0);

    // NSE later states a new date: it replaces the admin value.
    const moved = await walkOnce('2026-10-09');
    const after = await state();
    expect(after.ipo.closeDate).toBe('2026-10-09');
    expect(after.fs.source).toBe('NSE');
    expect(after.hold.isProtected).toBe(false);
    expect(moved.alerts).toHaveLength(1);
  });

  it('ROUND 3 MINOR: NSE (rank 1) still states the rejected value and BSE changes: the hold is NOT released', async () => {
    await seed('2026-10-05', '2026-10-05');
    await adminHolds('2026-10-06');
    const saved = await state();
    expect((saved.fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: '2026-10-05', BSE: '2026-10-05' });

    const { alerts } = await walkOnce('2026-10-05', '2026-10-08');
    const after = await state();
    // Releasing here would let the walk write NSE's 10-05, the value the admin rejected.
    expect(after.ipo.closeDate).toBe('2026-10-06');
    expect(after.hold.isProtected).toBe(true);
    expect(alerts).toHaveLength(0);
  });

  // OD-141 (owner 2026-09-29, narrows OD-106; section 9.2 item 28(a)): only the highest-ranked
  // exchange that states the field (NSE for close_date on a MAINBOARD IPO) releases an admin value.
  // Round-3 finding (#1287): NSE CHECK_FAILED + BSE moved released the hold, and the next walk (NSE
  // first) wrote NSE's 2026-10-01, the date the admin had rejected.
  describe('OD-141: only the top-ranked stating exchange releases', () => {
    const REJECTED = '2026-10-01';
    const ADMIN_DATE = '2026-10-03';
    const BSE_MOVED = '2026-10-05';
    const NSE_MOVED = '2026-10-09';

    function assertKeptWithOneQueueRow(st: Awaited<ReturnType<typeof state>>, adminValue: string | null, alerts: unknown[]) {
      expect(st.ipo.closeDate).toBe(adminValue);
      expect(st.fs.source).toBe('ADMIN');
      expect(st.hold.isProtected).toBe(true);
      expect(st.audits.filter((a) => a.actionType === 'Exchange Override')).toHaveLength(0);
      expect(alerts).toHaveLength(0);
      expect(st.queue).toHaveLength(1);
      expect(st.queue[0]).toMatchObject({ source1: 'ADMIN', value1: adminValue, source2: 'BSE', value2: BSE_MOVED, resolvedAt: null });
      expect((st.queue[0].evidence as any)).toMatchObject({ origin: 'OD141_LOWER_RANK_EXCHANGE', rule: 'OD-141', topSource: 'NSE' });
    }

    for (const [label, nseRead] of [
      ['NSE CHECK_FAILED', { outcome: 'CHECK_FAILED', reason: 'close date before open date' } as FieldFetcherAnswer],
      ['NSE read FAILED (fetcher threw)', 'THROW' as const],
      ['NSE states the rejected date', REJECTED],
      ['NSE stated a date at save and now prints nothing', { outcome: 'NOT_PRINTED' } as FieldFetcherAnswer],
    ] as const) {
      it(`${label} + BSE moves: NOT released, BSE's value is one queue disagreement; NSE moving later releases`, async () => {
        await seed(REJECTED, REJECTED);
        await adminHolds(ADMIN_DATE);
        expect(((await state()).fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: REJECTED, BSE: REJECTED });

        const first = await walkOnce(nseRead, BSE_MOVED);
        assertKeptWithOneQueueRow(await state(), ADMIN_DATE, first.alerts);

        // The same BSE value on the next read is not a second row (deduped by suggestion_key).
        const again = await walkOnce(nseRead, BSE_MOVED);
        assertKeptWithOneQueueRow(await state(), ADMIN_DATE, again.alerts);

        // NSE (rank 1) publishes a newer date: that releases, from NSE, with one alert and one audit.
        const moved = await walkOnce(NSE_MOVED, BSE_MOVED);
        const after = await state();
        expect(after.ipo.closeDate).toBe(NSE_MOVED);
        expect(after.fs.source).toBe('NSE');
        expect(after.hold.isProtected).toBe(false);
        const override = after.audits.filter((a) => a.actionType === 'Exchange Override');
        expect(override).toHaveLength(1);
        expect(override[0]).toMatchObject({ adminUser: 'SYSTEM', oldValue: ADMIN_DATE, newValue: NSE_MOVED });
        expect((override[0].details as any)).toMatchObject({ reason: 'OD-106', releaseRule: 'OD-141', source: 'NSE' });
        expect(moved.alerts).toHaveLength(1);
      });
    }

    it('item 28(a): an admin EMPTY follows the same rule (NSE failed + BSE moved keeps it empty; NSE moving fills it)', async () => {
      await seed(REJECTED, REJECTED);
      await adminHolds(null);
      const saved = await state();
      expect(saved.ipo.closeDate).toBeNull();
      expect((saved.fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: REJECTED, BSE: REJECTED });

      const first = await walkOnce({ outcome: 'CHECK_FAILED', reason: 'unparseable' }, BSE_MOVED);
      assertKeptWithOneQueueRow(await state(), null, first.alerts);

      // NSE still states the date the admin deleted: still empty.
      const still = await walkOnce(REJECTED, BSE_MOVED);
      expect((await state()).ipo.closeDate).toBeNull();
      expect(still.alerts).toHaveLength(0);

      const moved = await walkOnce(NSE_MOVED, BSE_MOVED);
      const after = await state();
      expect(after.ipo.closeDate).toBe(NSE_MOVED);
      expect(after.hold.isProtected).toBe(false);
      expect(moved.alerts).toHaveLength(1);
    });

    it('NSE stated nothing at save and still states nothing: BSE is the top STATING exchange and its newer date releases', async () => {
      await seed(REJECTED);
      await db.execute(sql`
        UPDATE field_sources SET source = 'BSE',
               witnesses = ${JSON.stringify([
                 { source: 'NSE', value: null, at: '2026-06-20T05:00:00.000Z', outcome: 'NOT_PRINTED' },
                 { source: 'BSE', value: REJECTED, at: '2026-06-20T05:00:00.000Z', outcome: 'SUPPLIED' },
               ])}::jsonb
         WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'closeDate'`);
      await adminHolds(ADMIN_DATE);
      expect(((await state()).fs.dataLineage as any).exchangeAtSave).toEqual({ NSE: null, BSE: REJECTED });

      const { alerts } = await walkOnce({ outcome: 'NOT_PRINTED' }, BSE_MOVED);
      const after = await state();
      expect(after.ipo.closeDate).toBe(BSE_MOVED);
      expect(after.fs.source).toBe('BSE');
      expect(after.hold.isProtected).toBe(false);
      expect(after.queue).toHaveLength(0);
      expect(alerts).toHaveLength(1);
    });
  });
});
