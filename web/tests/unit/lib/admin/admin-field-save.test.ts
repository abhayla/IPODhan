import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db', () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { saveAdminFieldValue, adminWriteResponse, TABLE_CACHE_KEYS, type AdminFieldSaveDeps } from '@/lib/admin/admin-field-save';
import { getAdminQueueCountsKey, getAdminQueueSetupKey } from '@/lib/cache/cache-keys';
import { ADMIN_WRITABLE_TABLES, ADMIN_ROW_TABLES, type AdminFieldWriteInput, type AdminFieldWriteResult } from '@ipodhan/shared/services/admin-field-write';

const input: AdminFieldWriteInput = {
  ipoId: 'ipo-1',
  tableName: 'ipos',
  fieldName: 'registrar',
  value: 'X',
  mode: { kind: 'typed', sourceNote: 'RHP p1' },
  expectedVersion: 'v1',
  actor: { name: 'admin', adminId: 'admin-t1' },
  entryPoint: 'test',
};

function deps(result: AdminFieldWriteResult) {
  const del = vi.fn(async () => 1);
  const revalidatePath = vi.fn();
  const write = vi.fn(async () => result);
  const d: AdminFieldSaveDeps = { write: write as never, getDb: (async () => ({})) as never, redis: () => ({ del }), revalidatePath };
  return { d, del, revalidatePath, write };
}

const OK: AdminFieldWriteResult = { kind: 'OK', ipoId: 'ipo-1', slug: 'acme-ltd', tableName: 'ipos', fieldName: 'registrar', oldValue: 'A', newValue: 'X', version: 'v2' };

describe('saveAdminFieldValue — F-171 cache drop after commit', () => {
  it('drops the real named keys (never a pattern) and revalidates the IPO page on OK', async () => {
    const { d, del, revalidatePath, write } = deps(OK);
    await saveAdminFieldValue(input, d);
    // §2.8 / item 18: the deployed field manifest rides every save so a type/segment/venue save can rebuild the plan.
    expect(write).toHaveBeenCalledWith({}, input, undefined, { planManifest: expect.objectContaining({ version: expect.any(Number), fields: expect.objectContaining({ 'ipos.segment': expect.anything() }) }) });
    const keys = del.mock.calls.map((c) => c[0]).sort();
    expect(keys).toEqual([
      'admin:queue:counts',
      'admin:queue:setup',
      'ipo:detail:acme-ltd',
      'ipo:fieldplan:provenance:acme-ltd',
      'ipo:id:ipo-1',
      'ipo:slug:acme-ltd',
    ]);
    expect(keys.some((k) => k.includes('*'))).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith('/ipos/acme-ltd');
  });

  it('M3: an ipos save also clears the list/search keys, resolving each pattern to real names before DEL', async () => {
    const del = vi.fn(async () => 1);
    const keys = vi.fn(async (p: string) => (p === 'ipo:list:*' ? ['ipo:list:abc'] : []));
    const d: AdminFieldSaveDeps = { write: (async () => OK) as never, getDb: (async () => ({})) as never, redis: () => ({ del, keys }), revalidatePath: vi.fn() };
    await saveAdminFieldValue(input, d);
    const deleted = del.mock.calls.flat() as string[];
    expect(keys).toHaveBeenCalledWith('ipo:list:*');
    expect(keys).toHaveBeenCalledWith('ipo:search:*');
    expect(deleted).toContain('ipo:list:abc');
    expect(deleted.some((k) => k.includes('*'))).toBe(false);
  });

  it.each([
    ['ipo_details', 'details:ipo-1'],
    ['financial_data', 'financial:ipo-1'],
    ['ipo_financials', 'financials:enhanced:ipo-1'],
    ['listing_performance', 'listing:ipo-1'],
    ['ipo_scores', 'score:ipo-1'],
    ['peer_companies', 'peers:ipo-1'],
    ['documents', 'documents:ipo-1'],
  ])('M3: a save in %s drops the table own key %s', async (tableName, key) => {
    const { d, del } = deps({ ...OK, tableName } as AdminFieldWriteResult);
    await saveAdminFieldValue({ ...input, tableName }, d);
    expect(del.mock.calls.map((c) => c[0])).toContain(key);
  });

  it('OD-136: a save in ANY admin-writable table drops the admin queue keys (the fixed item leaves the queue at once)', async () => {
    for (const tableName of [...ADMIN_WRITABLE_TABLES, ...ADMIN_ROW_TABLES]) {
      const { d, del } = deps({ ...OK, tableName } as AdminFieldWriteResult);
      await saveAdminFieldValue({ ...input, tableName }, d);
      const deleted = del.mock.calls.map((c) => c[0]);
      expect(deleted, tableName).toContain(getAdminQueueSetupKey());
      expect(deleted, tableName).toContain(getAdminQueueCountsKey());
    }
  });

  it('M3: every admin-writable table has a cache-key entry', () => {
    for (const t of [...ADMIN_WRITABLE_TABLES, ...ADMIN_ROW_TABLES]) expect(Object.keys(TABLE_CACHE_KEYS)).toContain(t);
  });

  it('drops nothing when the write refused', async () => {
    const { d, del, revalidatePath } = deps({ kind: 'INVALID', reason: 'bad' });
    await saveAdminFieldValue(input, d);
    expect(del).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// OD-140 (§9.2 items 4, 14): the admin-only non-IPO route saves through this SAME wrapper — there
// is no second write path for OFS/NCD/RIGHTS/BUYBACK/TENDER/REIT rows (item 11, OD-119 "the OFS
// rows are admin-editable like any IPO in the same editor, under the same rules").
describe('saveAdminFieldValue on a non-IPO (OFS) row — OD-140', () => {
  const ofsInput: AdminFieldWriteInput = {
    ipoId: 'ofs-ipo-1',
    tableName: 'ipos',
    fieldName: 'registrar',
    value: 'KFin Technologies',
    mode: { kind: 'typed', sourceNote: 'typed by admin' },
    expectedVersion: 'v1',
    actor: { name: 'admin', adminId: 'admin-t1' },
    entryPoint: 'admin-ipos-edit-non-ipo-page',
  };

  it('passes an OFS row straight through to the shared write — nothing in the wrapper gates on offering type', async () => {
    const OFS_OK: AdminFieldWriteResult = {
      kind: 'OK',
      ipoId: 'ofs-ipo-1',
      slug: 'acme-ofs',
      tableName: 'ipos',
      fieldName: 'registrar',
      oldValue: null,
      newValue: 'KFin Technologies',
      version: 'v2',
    };
    const { d, write } = deps(OFS_OK);
    const result = await saveAdminFieldValue(ofsInput, d);

    // Read back: the OK result IS the saved value returned by the one write function — the same
    // shape the update-field route hands the editor to render immediately (item 10, no re-fetch).
    expect(result).toEqual(OFS_OK);
    expect(write).toHaveBeenCalledWith({}, ofsInput, undefined, expect.objectContaining({ planManifest: expect.anything() }));
  });

  it('drops the same cache keys and revalidates the same slug path for an OFS row as for an IPO row', async () => {
    const OFS_OK: AdminFieldWriteResult = {
      kind: 'OK',
      ipoId: 'ofs-ipo-1',
      slug: 'acme-ofs',
      tableName: 'ipos',
      fieldName: 'registrar',
      oldValue: null,
      newValue: 'KFin Technologies',
      version: 'v2',
    };
    const { d, del, revalidatePath } = deps(OFS_OK);
    await saveAdminFieldValue(ofsInput, d);
    expect(del).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/ipos/acme-ofs');
  });
});

describe('adminWriteResponse — #1159 status mapping', () => {
  it('INVALID -> 400 with the reason', async () => {
    const r = adminWriteResponse({ kind: 'INVALID', reason: 'ipos.lotSize: expected a whole number' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'INVALID', reason: 'ipos.lotSize: expected a whole number' });
  });
  it('CONFLICT -> 409 with the newer value and who set it', async () => {
    const r = adminWriteResponse({ kind: 'CONFLICT', currentValue: 'Newer', setBy: 'other-admin', setAt: '2026-09-28 10:00:00', currentVersion: 'v9' });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'CONFLICT', currentValue: 'Newer', setBy: 'other-admin', currentVersion: 'v9' });
  });
  it('NOT_FOUND -> 404, OK -> 200 with the new version', async () => {
    expect(adminWriteResponse({ kind: 'NOT_FOUND', reason: 'x' }).status).toBe(404);
    const ok = adminWriteResponse(OK);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, data: { value: 'X', version: 'v2' } });
  });
});

describe('every rewired admin entry point writes only through the shared function', () => {
  const root = path.resolve(__dirname, '../../../..');
  const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
  it.each([
    'app/api/admin/update-field/route.ts',
    'app/api/admin/conflicts/resolve/route.ts',
    'lib/services/conflict-resolution.ts',
  ])('%s calls saveAdminFieldValue and has no direct value write', (file) => {
    const src = read(file);
    expect(src).toContain('saveAdminFieldValue(');
    expect(src).not.toMatch(/\.update\(\s*(ipos|financialData|listingPerformance|subscriptions|gmpRecords|ipoDetails)\b/);
  });
  it('#1243: update-field-record no longer writes ipo_reviews', () => {
    expect(read('app/api/admin/update-field-record/route.ts')).not.toMatch(/ipoReviews|ipo_reviews:\s/);
  });
});
