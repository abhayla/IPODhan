/**
 * Spec §9.2 items 8, 9 (OD-107) and §9.4 (the admin queue). End to end on ipodhan_test: an admin
 * changes a list (the one list write), the real scraper writer then brings a different list, and the
 * admin queue — the SQL page query (queueCte) through AdminQueueService — shows that suggestion as
 * its own item: rows to add / remove, a link to the list editor, never counted as a disagreement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { AdminQueueService } from '@/lib/services/admin-queue-service';
import { adminQueueCacheKeys } from '@/lib/cache/cache-keys';
import { readAdminList, writeAdminListChange, listRowKey } from '@ipodhan/shared/services/admin-list-write';
import { PromotersRepository } from '@ipodhan/shared/repositories/promoters-repository';

const tag = `b08q-${Date.now().toString(36)}`;
const ipoId = randomUUID();
const slug = `${tag}-ipo`;
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;

async function dropQueueCache(): Promise<void> {
  try {
    await getRedisClient().del(...adminQueueCacheKeys());
  } catch {
    // No Redis in this environment: the cache helpers fall back to the database.
  }
}

async function cleanup(): Promise<void> {
  for (const t of ['audit_logs', 'data_conflicts', 'field_sources', 'field_protection_metadata', 'promoters']) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE ipo_id = ${ipoId}`);
  }
  await db.execute(sql`DELETE FROM ipos WHERE id = ${ipoId}`);
}

describe('admin queue shows an OD-107 list suggestion (ipodhan_test)', () => {
  beforeAll(async () => {
    await db.execute(sql`INSERT INTO ipos (id, slug, company_name, segment, status, offering_type, open_date, close_date)
      VALUES (${ipoId}, ${slug}, ${`${tag} Ltd`}, 'MAINBOARD', 'UPCOMING', 'IPO', '2026-10-20', '2026-10-22')`);
    await db.execute(sql`INSERT INTO promoters (ipo_id, name, normalized_name, is_promoter_group)
      VALUES (${ipoId}, 'Ramesh Kumar', 'ramesh kumar', false), (${ipoId}, 'Suresh Kumar', 'suresh kumar', false)`);
  });

  afterAll(async () => {
    await cleanup();
    await dropQueueCache();
  });

  it('admin-owned promoters + a scraper run with a different list -> one suggestion item linking to the list editor', async () => {
    const actor = { name: 'b08q-admin', adminId: 'admin-b08q' };
    const opened = await readAdminList(db as never, ipoId, 'promoters');
    const removed = await writeAdminListChange(db as never, {
      ipoId,
      list: 'promoters',
      op: { kind: 'remove', rowKeys: [listRowKey('promoters', { normalizedName: 'suresh kumar' })], reason: 'not a promoter per the RHP' },
      actor,
      entryPoint: 'test',
      expectedVersion: opened.version,
    });
    expect(removed.kind, JSON.stringify(removed)).toBe('OK');

    await new PromotersRepository(db as never, noRedis).replacePromoters(ipoId, [
      { ipoId, name: 'Ramesh Kumar', normalizedName: 'ramesh kumar', isPromoterGroup: false },
      { ipoId, name: 'Suresh Kumar', normalizedName: 'suresh kumar', isPromoterGroup: false },
      { ipoId, name: 'Dinesh Kumar', normalizedName: 'dinesh kumar', isPromoterGroup: true },
    ] as never);

    await dropQueueCache();
    const service = new AdminQueueService(db as never, getRedisClient() as never);
    const r = await service.getQueue({ page: 1, pageSize: 50, ipo: slug });
    const items = r.entries.flatMap((e) => (e.type === 'item' ? [e.item] : []));
    const sug = items.filter((i) => i.ruleFilter === 'OD-107');
    expect(sug, JSON.stringify(items.map((i) => [i.id, i.ruleFilter]))).toHaveLength(1);
    expect(sug[0].tableName).toBe('promoters');
    expect(sug[0].suggestion).toMatchObject({ list: 'promoters', writer: 'DRHP', add: ['Dinesh Kumar', 'Suresh Kumar'], remove: [] });
    expect(sug[0].editorHref).toBe(`/ipos/${slug}?edit=promoters`);
    // never a source disagreement: this IPO has no other conflict, so its disagreement count is 0
    expect(items.filter((i) => i.kind === 'conflict' && i.ruleFilter === null)).toHaveLength(0);
    const disagreementView = await service.getQueue({ page: 1, pageSize: 50, ipo: slug, kind: 'disagreement' });
    expect(disagreementView.entries).toHaveLength(0);
  });
});
