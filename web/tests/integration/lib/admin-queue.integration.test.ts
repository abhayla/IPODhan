/**
 * The admin queue against a real Postgres (ipodhan_test): fixture IPOs in all three OD-136 groups,
 * both populations (unresolved conflicts, no-value plan rows), an admin hold, a ruled conflict and a
 * resolved conflict. Asserts the EXACT order the service returns for those IPOs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { AdminQueueService } from '@/lib/services/admin-queue-service';
import { orderQueue, type QueueEntry } from '@/lib/admin/queue/queue-order';

const tag = `a4q-${Date.now().toString(36)}`;
const ids = { up: randomUUID(), cl: randomUUID(), l1: randomUUID(), l2: randomUUID(), l3: randomUUID() };
const slug = (k: string) => `${tag}-${k}`;

async function ipo(id: string, k: string, status: string, open: string | null, close: string | null, listing: string | null) {
  await db.execute(sql`INSERT INTO ipos (id, slug, company_name, segment, status, offering_type, open_date, close_date, listing_date)
    VALUES (${id}, ${slug(k)}, ${`${tag} ${k} Ltd`}, 'MAINBOARD', ${status}, 'IPO', ${open}, ${close}, ${listing})`);
}

async function plan(ipoId: string, table: string, field: string, state: string, reason: string | null, rowKey = '') {
  await db.execute(sql`INSERT INTO ipo_field_plan (ipo_id, table_name, row_key, field_name, state, reason_code, manifest_version)
    VALUES (${ipoId}, ${table}, ${rowKey}, ${field}, ${state}, ${reason}, 1)`);
}

async function conflict(ipoId: string, field: string, s1: string, v1: string | null, s2: string, v2: string | null, resolved = false) {
  await db.execute(sql`INSERT INTO data_conflicts (ipo_id, table_name, field_name, source1, value1, source2, value2, resolved_at)
    VALUES (${ipoId}, 'ipos', ${field}, ${s1}, ${v1}, ${s2}, ${v2}, ${resolved ? sql`now()` : sql`NULL`})`);
}

const label = (e: QueueEntry) =>
  e.type === 'item'
    ? `${e.group}:${e.item.ipo.slug.slice(tag.length + 1)}:${e.item.kind}:${e.item.fieldName}:${e.item.reason.slice(0, 18)}`
    : `3:${e.summary.ipo.slug.slice(tag.length + 1)}:${e.summary.conflicts}/${e.summary.missing}/${e.summary.flagged}/${e.summary.ruled}`;

describe('admin queue on ipodhan_test (OD-136 order)', () => {
  beforeAll(async () => {
    await ipo(ids.up, 'up', 'UPCOMING', '2026-10-10', '2026-10-14', null);
    await ipo(ids.cl, 'cl', 'CLOSED', '2026-09-20', '2026-09-24', '2026-09-29');
    await ipo(ids.l1, 'l1', 'LISTED', '2025-01-01', '2025-01-03', '2025-01-08');
    await ipo(ids.l2, 'l2', 'LISTED', '2026-08-01', '2026-08-03', '2026-08-08');
    await ipo(ids.l3, 'l3', 'LISTED', '2024-04-20', '2024-04-24', '2024-05-01'); // no plan rows at all
    // population (c): a stored lot_size of 1 is refused by validateIPOData. On 'up' the plan row
    // for lot_size is also missing (stanbik-like), so that field must appear ONCE with both reasons.
    await db.execute(sql`UPDATE ipos SET lot_size = 1 WHERE id IN (${ids.up}, ${ids.l3})`);

    // group 1 (shown fields) and group 2 (other fields) for the two live IPOs
    await plan(ids.up, 'ipos', 'price_range_max', 'NOT_AVAILABLE_YET', 'NOT_PUBLISHED_YET');
    await plan(ids.up, 'ipos', 'lot_size', 'CHECK_FAILED', null);
    await plan(ids.up, 'ipos', 'company_website', 'EXHAUSTED', null);
    await plan(ids.up, 'ipos', 'isin', 'SUPPLIED', null); // has a value: not in the queue
    await plan(ids.up, 'ipos', 'face_value', 'NOT_AVAILABLE_YET', null); // admin-held below: handled
    await conflict(ids.up, 'issueSize', 'CHITTORGARH', '3000000000', 'BSE', '2600624600');
    await conflict(ids.up, 'lotSize', 'NSE', '100', 'NSE', '120'); // OD-75: shown, labelled
    await conflict(ids.up, 'symbol', 'NSE', 'A', 'BSE', 'B', true); // resolved: not in the queue
    await plan(ids.cl, 'ipos', 'listing_date', 'NOT_AVAILABLE_YET', null);
    await conflict(ids.cl, 'registrar', 'NSE', 'Mudra RTA Ventures Pvt Ltd', 'BSE', 'Mudra RTA Ventures Private Limited');
    // group 3
    await plan(ids.l1, 'ipos', 'symbol', 'EXHAUSTED', 'SOURCE_UNREACHABLE');
    await conflict(ids.l2, 'faceValue', 'NSE', '10', 'BSE', '0'); // OD-60
    await plan(ids.l2, 'peer_companies', 'pe_ratio', 'CHECK_FAILED', null, 'xyz ltd');

    await db.execute(sql`INSERT INTO field_protection_metadata (table_name, field_name, ipo_id, is_protected, auto_protected, manually_edited_at, manually_edited_by)
      VALUES ('ipos', 'faceValue', ${ids.up}, true, true, now(), 'test-admin')`);
  });

  afterAll(async () => {
    const all = Object.values(ids);
    for (const id of all) {
      await db.execute(sql`DELETE FROM field_protection_metadata WHERE ipo_id = ${id}`);
      await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${id}`);
      await db.execute(sql`DELETE FROM ipo_field_plan WHERE ipo_id = ${id}`);
      await db.execute(sql`DELETE FROM ipos WHERE id = ${id}`);
    }
  });

  it('returns the fixture items in the exact OD-136 order, nothing hidden', async () => {
    const service = new AdminQueueService(db as never, getRedisClient());
    const mine = (await service.loadItems()).filter((i) => i.ipo.slug.startsWith(`${tag}-`));
    expect(orderQueue(mine).map(label)).toEqual([
      '1:cl:missing:listingDate:no reason recorded', // CLOSED lists 09-29: nearest date first
      '1:cl:conflict:registrar:the values mean th', // OD-59 ruled row: still shown, after missing
      '1:up:conflict:issueSize:disagreement',
      '1:up:missing:lotSize:no reason recorded',
      '1:up:missing:priceRangeMax:NOT_PUBLISHED_YET',
      '1:up:conflict:lotSize:a source changed i',
      '2:up:missing:companyWebsite:no reason recorded',
      '3:l2:0/1/0/1',
      '3:l1:0/1/0/0',
      '3:l3:0/0/1/0', // no plan rows: reached only through the field check (population c)
    ]);
    const lot = mine.filter((i) => i.ipo.id === ids.up && i.fieldName === 'lotSize' && i.kind !== 'conflict');
    expect(lot.map((i) => [i.kind, i.reasons, i.storedValue])).toEqual([['missing', ['no reason recorded', 'FAILED_VALIDATION'], '1']]);
    const peer = mine.find((i) => i.tableName === 'peer_companies');
    expect(peer?.editorHref).toBe(`/ipos/${slug('l2')}?edit=peer_companies.peRatio&row=xyz%20ltd`);
  });

  it('serves the paged API shape with whole-queue counts and one IPO item by item', async () => {
    const service = new AdminQueueService(db as never, getRedisClient());
    const r = await service.getQueue({ page: 1, pageSize: 50, ipo: slug('l2') });
    expect(r.entries.map((e) => (e.type === 'item' ? `${e.group}:${e.item.kind}:${e.item.fieldName}` : 'ipo'))).toEqual([
      '3:missing:peRatio',
      '3:conflict:faceValue',
    ]);
    expect(r.counts.total).toBeGreaterThanOrEqual(10);
  });
});
