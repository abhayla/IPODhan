/**
 * OD-142 + §9.2 item 18, the reader and admin surfaces, end to end on ipodhan_test:
 *  (b) a field the corrected offering type makes not applicable (§1.11: lot size on a BUYBACK)
 *      disappears from the IPO detail payload (IPORepository.findBySlug, which the page and
 *      /api/ipos/[slug] both read), while the column and the admin audit row keep the value;
 *  (a) the Mopshop correction's "source no longer first" item renders in the admin queue (the SQL
 *      page query through AdminQueueService) as its own labelled item, never a disagreement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { adminQueueCacheKeys } from '@/lib/cache/cache-keys';
import { AdminQueueService } from '@/lib/services/admin-queue-service';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { RULE_FILTER_LABELS } from '@/lib/admin/queue/conflict-rule-filter';
import { writeAdminFieldValue, readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';
import { generateFieldPlan } from '@ipodhan/shared/services/field-plan-generator';
import * as schema from '@ipodhan/shared/db/schema';
import manifestJson from '../../../../scraper/config/field-manifest.json';

const manifest = manifestJson as never;
const tag = `od142-${Date.now().toString(36)}`;
const ipoId = randomUUID();
const slug = `${tag}-ipo`;
const noRedis = new Proxy({}, { get: () => async () => null }) as never;

async function cleanup(): Promise<void> {
  for (const t of ['audit_logs', 'data_conflicts', 'field_sources', 'field_protection_metadata', 'ipo_field_plan']) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE ipo_id = ${ipoId}`);
  }
  await db.execute(sql`DELETE FROM ipos WHERE id = ${ipoId}`);
}

async function dropQueueCache(): Promise<void> {
  try {
    await getRedisClient().del(...adminQueueCacheKeys());
  } catch {
    // No Redis here: the cache helpers fall back to the database.
  }
}

async function save(fieldName: string, value: unknown) {
  const v = await readAdminFieldVersion(db as never, ipoId, 'ipos', fieldName);
  return writeAdminFieldValue(
    db as never,
    {
      ipoId,
      tableName: 'ipos',
      fieldName,
      value,
      mode: { kind: 'typed', sourceNote: 'RHP cover page' },
      expectedVersion: v!.version,
      actor: { name: 'od142-admin', adminId: 'admin-od142' },
      entryPoint: 'test',
    },
    undefined,
    { planManifest: manifest }
  );
}

describe('OD-142 / item 18 on the reader payload and the admin queue (ipodhan_test)', () => {
  beforeAll(async () => {
    await cleanup();
    await db.execute(sql`INSERT INTO ipos (id, slug, company_name, category, segment, listing_exchanges, status, offering_type, open_date, lot_size, price_range_min, price_range_max)
      VALUES (${ipoId}, ${slug}, ${`${tag} Distribution Ltd`}, 'MAINBOARD', 'MAINBOARD', '["BSE"]'::jsonb, 'UPCOMING', 'FPO', '2026-10-20', 1200, 95, 100)`);
    await db.execute(sql`INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_by)
      VALUES (${ipoId}, 'ipos', '', 'openDate', 'NSE', 90, 'test')`);
    // The plan the cycle planted for the stored (wrong) type, every row settled by its rank 1.
    const rows = generateFieldPlan({ id: ipoId, segment: 'MAINBOARD', listingExchanges: ['BSE'] }, manifest);
    await db.insert(schema.ipoFieldPlan).values(
      rows.map((r) => ({
        ipoId,
        tableName: r.tableName,
        rowKey: '',
        fieldName: r.fieldName,
        rank1Source: r.rank1Source,
        rank2Source: r.rank2Source,
        rank3Source: r.rank3Source,
        state: 'SUPPLIED' as const,
        chosenSource: r.rank1Source,
        chosenRank: 1,
        attempts: 1,
        manifestVersion: r.manifestVersion,
        policyOrigin: r.policyOrigin,
      }))
    );
  });

  afterAll(async () => {
    await cleanup();
    await dropQueueCache();
  });

  it('(a) the Mopshop correction FPO/MAINBOARD -> IPO/SME shows one "source no longer first" item per kept value, not a disagreement', async () => {
    expect((await save('offeringType', 'IPO')).kind).toBe('OK');
    expect((await save('segment', 'SME')).kind).toBe('OK');
    await dropQueueCache();
    const service = new AdminQueueService(db as never, getRedisClient() as never);
    const r = await service.getQueue({ page: 1, pageSize: 100, ipo: slug });
    const items = r.entries.flatMap((e) => (e.type === 'item' ? [e.item] : []));
    const moved = items.filter((i) => i.ruleFilter === 'OD-142');
    const openDate = moved.find((i) => i.fieldName === 'openDate');
    expect(openDate, JSON.stringify(items.map((i) => [i.fieldName, i.ruleFilter]))).toBeDefined();
    expect(moved.filter((i) => i.fieldName === 'openDate')).toHaveLength(1);
    expect(openDate!.reason).toBe(RULE_FILTER_LABELS['OD-142']);
    expect(openDate!.reason).toContain('source no longer first');
    expect(openDate!.sources).toEqual([
      { source: 'NSE', value: '2026-10-20' },
      { source: 'BSE', value: null },
    ]);
    const disagreementView = await service.getQueue({ page: 1, pageSize: 100, ipo: slug, kind: 'disagreement' });
    expect(disagreementView.entries).toHaveLength(0);

    // The kept value still reaches the reader (IPO type: open date applies).
    const page = await new IPORepository(db as never, noRedis).findBySlug(slug);
    expect(String(page!.openDate)).toContain('2026-10-20');
    expect(page!.lotSize).toBe(1200);
  });

  it('(b) corrected to BUYBACK: lot size and price band (§1.11 not applicable) leave the payload; the column keeps them', async () => {
    expect((await save('offeringType', 'BUYBACK')).kind).toBe('OK');
    const page = await new IPORepository(db as never, noRedis).findBySlug(slug);
    expect(page!.offeringType).toBe('BUYBACK');
    expect(page!.lotSize).toBeNull();
    expect(page!.priceRangeMin).toBeNull();
    expect(page!.priceRangeMax).toBeNull();
    // Still-applicable fields are untouched (face value: na only for INVITS/REITS).
    expect(String(page!.openDate)).toContain('2026-10-20');
    const stored = await db.execute(sql`SELECT lot_size, price_range_max::text AS pmax FROM ipos WHERE id = ${ipoId}`);
    expect(stored.rows).toEqual([{ lot_size: 1200, pmax: '100' }]);
  });
});
