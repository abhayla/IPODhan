// implements: R-158
/**
 * PATCH /api/admin/update-field-record (round 3, contract 2 item A2): the route is a thin entry
 * point into the ONE admin write. It addresses the row by its record id, passes the authenticated
 * admin (name AND id) as the actor, and maps the result. The peer rename -> row-key re-derivation
 * itself lives in the shared function (update-field-record-derived-key-registry.test.ts, and the
 * ipodhan_test integration test, which renames a peer and reads provenance + hold under the new key).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each file's first test dynamically imports a route module (its whole graph); on a loaded
// machine that alone can pass 5 s, so these files get a longer per-test limit.
vi.setConfig({ testTimeout: 30_000 });
import { NextRequest } from 'next/server';
import { getPeerCompaniesKey } from '@/lib/cache/cache-keys';

vi.mock('@/lib/middleware/admin-auth', () => ({
  withAdminAuth: (handler: any) => (request: any, ...args: any[]) =>
    handler(request, { adminId: 'admin-7', adminName: 'Asha', isAuthenticated: true }, ...args),
}));

const del = vi.fn().mockResolvedValue(1);
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: vi.fn(() => ({ del })) }));

const save = vi.fn();
vi.mock('@/lib/admin/admin-field-save', async (orig) => ({
  ...(await orig<object>()),
  saveAdminFieldValue: (...a: unknown[]) => save(...a),
}));

const req = (body: object) =>
  new NextRequest('http://localhost/api/admin/update-field-record', { method: 'PATCH', body: JSON.stringify(body) });

describe('PATCH /api/admin/update-field-record goes through the ONE admin write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the row, the value and the authenticated admin (name + id); drops the peer cache key', async () => {
    save.mockResolvedValue({
      kind: 'OK', ipoId: 'ipo-1', slug: 's', tableName: 'peer_companies', fieldName: 'companyName',
      rowKey: 'beta industries', oldValue: 'Acme Ltd', newValue: 'Beta Industries Ltd', version: 'v2',
    });
    const { PATCH } = await import('@/app/api/admin/update-field-record/route');
    const res = await PATCH(req({
      recordId: 'peer-1', ipoId: 'ipo-1', tableName: 'peer_companies', fieldName: 'companyName',
      value: 'Beta Industries Ltd', sourceNote: 'RHP p.212', expectedVersion: 'v1',
    }));
    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      ipoId: 'ipo-1',
      tableName: 'peer_companies',
      row: { recordId: 'peer-1' },
      fieldName: 'companyName',
      value: 'Beta Industries Ltd',
      expectedVersion: 'v1',
      actor: { name: 'Asha', adminId: 'admin-7' },
      mode: { kind: 'typed', sourceNote: 'RHP p.212' },
    });
    expect((await res.json()).data).toMatchObject({ rowKey: 'beta industries', recordId: 'peer-1' });
    expect(del).toHaveBeenCalledWith(getPeerCompaniesKey('ipo-1'));
  });

  it('maps a refusal (e.g. a no-identity rename) to 400 and drops no cache', async () => {
    save.mockResolvedValue({ kind: 'INVALID', reason: 'peer_companies.companyName needs a value with an identity' });
    const { PATCH } = await import('@/app/api/admin/update-field-record/route');
    const res = await PATCH(req({
      recordId: 'peer-1', ipoId: 'ipo-1', tableName: 'peer_companies', fieldName: 'companyName',
      value: '   ', sourceNote: 'x', expectedVersion: 'v1',
    }));
    expect(res.status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it('a table outside ADMIN_ROW_TABLES never reaches the write', async () => {
    const { PATCH } = await import('@/app/api/admin/update-field-record/route');
    const res = await PATCH(req({ recordId: 'a', ipoId: 'ipo-1', tableName: 'admin_users', fieldName: 'isOwner', value: true, expectedVersion: 'v' }));
    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});
