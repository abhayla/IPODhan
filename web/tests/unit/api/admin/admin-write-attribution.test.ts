/**
 * Contract 2 item A2 round 3 (spec §9.2 items 6, 11; OD-104, OD-113, OD-121; review M1/M3).
 * Every admin route that writes IPO data takes its actor from withAdminAuth's context and passes
 * BOTH the admin name and the admin id into the ONE admin write; the two "protect with no value"
 * paths are now a hold of the shown value (`holdShown`) through that write, never a bare
 * protection row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each file's first test dynamically imports a route module (its whole graph); on a loaded
// machine that alone can pass 5 s, so these files get a longer per-test limit.
vi.setConfig({ testTimeout: 30_000 });
import { NextRequest } from 'next/server';

const ADMIN = { adminId: 'admin-42', adminName: 'Ravi', isAuthenticated: true };
vi.mock('@/lib/middleware/admin-auth', () => ({
  withAdminAuth: (handler: any) => (request: any, ...args: any[]) => handler(request, ADMIN, ...args),
  getAdminIdentity: () => 'Anonymous',
}));
vi.mock('@/lib/auth/admin-auth', () => ({ requireAdminAuth: vi.fn(async () => null) }));

const save = vi.fn();
const saveMany = vi.fn();
vi.mock('@/lib/admin/admin-field-save', async (orig) => ({
  ...(await orig<object>()),
  saveAdminFieldValue: (...a: unknown[]) => save(...a),
  saveAdminFieldValues: (...a: unknown[]) => saveMany(...a),
}));

const ok = { kind: 'OK', ipoId: 'ipo-1', slug: 's', tableName: 'ipos', fieldName: 'registrar', rowKey: '', oldValue: 'A', newValue: 'A', version: 'v2' };

vi.mock('@/lib/admin/field-protection-checker', () => ({
  invalidateProtectionCache: vi.fn(async () => undefined),
  invalidateProtectionCacheForIpo: vi.fn(async () => undefined),
}));
const audit = vi.fn();
vi.mock('@/lib/services/audit-log-service', async (orig) => ({
  ...(await orig<object>()),
  logAudit: (...a: unknown[]) => audit(...a),
}));
const autoResolve = vi.fn();
vi.mock('@/lib/services/conflict-resolution', () => ({
  ConflictResolutionService: class {
    autoResolve(...a: unknown[]) {
      return autoResolve(...a);
    }
  },
}));
const anchorUpsert = vi.fn();
const anchorDelete = vi.fn();
vi.mock('@/lib/repositories/anchor-investor-repository', () => ({
  AnchorListHeldError: class extends Error {},
  AnchorInvestorRepository: class {
    upsert(...a: unknown[]) {
      return anchorUpsert(...a);
    }
    delete(...a: unknown[]) {
      return anchorDelete(...a);
    }
  },
}));
vi.mock('@/lib/services/notification-service', () => ({ sendNotification: vi.fn(async () => undefined) }));

const rows = [{ companyName: 'X Ltd', id: 'ipo-1', ipoId: 'ipo-1', slug: 's' }];
const builder: any = {
  insert: () => builder,
  values: () => builder,
  delete: () => builder,
  returning: async () => [{ id: 'row-9', name: 'r' }],
  select: () => builder,
  from: () => builder,
  where: () => builder,
  limit: async () => rows,
};
vi.mock('@/lib/db', () => ({ getDb: vi.fn(async () => builder), db: builder }));
vi.mock('@/lib/db/index', () => ({ db: builder }));
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: () => ({ del: async () => 1, get: async () => null, set: async () => 'OK', keys: async () => [] }),
}));
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: class {
    async findById(id: string) {
      return { id, slug: 's', companyName: 'X Ltd' };
    }
  },
}));

const json = (url: string, method: string, body: object) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { authorization: 'Bearer t' } });

describe('admin write routes attribute every write to the authenticated admin (name + id)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue(ok);
    saveMany.mockResolvedValue({ saved: ['registrar'], refused: null });
  });

  it('update-field PATCH passes actor {name, adminId}', async () => {
    const { PATCH } = await import('@/app/api/admin/update-field/route');
    await PATCH(json('http://l/api/admin/update-field', 'PATCH', { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'registrar', value: 'A', sourceNote: 'RHP', expectedVersion: 'v1' }));
    expect(save.mock.calls[0][0].actor).toEqual({ name: 'Ravi', adminId: 'admin-42' });
  });

  it('protection/fields POST protect=true is a holdShown write with the admin id (no bare protection row)', async () => {
    const { POST } = await import('@/app/api/admin/protection/fields/[ipoId]/route');
    const res = await POST(
      json('http://l/api/admin/protection/fields/ipo-1', 'POST', { tableName: 'ipos', fieldName: 'registrar', isProtected: true, expectedVersion: 'v1' }),
      { params: Promise.resolve({ ipoId: 'ipo-1' }) }
    );
    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'registrar', mode: { kind: 'holdShown' }, expectedVersion: 'v1',
      actor: { name: 'Ravi', adminId: 'admin-42' },
    });
  });

  it('protection/fields POST on a field showing nothing answers 400 (refused by the write)', async () => {
    save.mockResolvedValue({ kind: 'INVALID', reason: 'ipos.registrar shows no value to hold' });
    const { POST } = await import('@/app/api/admin/protection/fields/[ipoId]/route');
    const res = await POST(
      json('http://l/api/admin/protection/fields/ipo-1', 'POST', { tableName: 'ipos', fieldName: 'registrar', isProtected: true, expectedVersion: 'v1' }),
      { params: Promise.resolve({ ipoId: 'ipo-1' }) }
    );
    expect(res.status).toBe(400);
  });

  it('protection/fields/bulk protect=true holds each field through the write with its own token', async () => {
    const { POST } = await import('@/app/api/admin/protection/fields/bulk/route');
    const res = await POST(json('http://l/api/admin/protection/fields/bulk', 'POST', {
      ipoId: 'ipo-1', tableName: 'ipos', fieldNames: ['registrar', 'sector'], isProtected: true, versions: { registrar: 'v1', sector: 'v9' },
    }));
    expect(res.status).toBe(200);
    expect(save.mock.calls.map((c) => [c[0].fieldName, c[0].expectedVersion, c[0].mode.kind, c[0].actor.adminId])).toEqual([
      ['registrar', 'v1', 'holdShown', 'admin-42'],
      ['sector', 'v9', 'holdShown', 'admin-42'],
    ]);
  });

  it('conflicts/resolve accept_scraper passes actor {name, adminId}', async () => {
    const { POST } = await import('@/app/api/admin/conflicts/resolve/route');
    await POST(json('http://l/api/admin/conflicts/resolve', 'POST', {
      conflicts: [{ ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'registrar', resolution: 'accept_scraper', scraperValue: 'B', scraperSource: 'NSE', expectedVersion: 'v1' }],
    }));
    expect(save.mock.calls[0][0].actor).toEqual({ name: 'Ravi', adminId: 'admin-42' });
  });

  it('ipos/[id] PATCH is withAdminAuth-guarded and passes actor {name, adminId}', async () => {
    const { PATCH } = await import('@/app/api/admin/ipos/[id]/route');
    await PATCH(
      json('http://l/api/admin/ipos/00000000-0000-4000-8000-000000000001', 'PATCH', { lotSize: 50, versions: { lotSize: 'v1' }, sourceNote: 'RHP' }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) }
    );
    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(saveMany.mock.calls[0][0].actor).toEqual({ name: 'Ravi', adminId: 'admin-42' });
  });

  it('dynamic/[table]/[id] PATCH on ipos passes actor {name, adminId}', async () => {
    const { PATCH } = await import('@/app/api/admin/dynamic/[table]/[id]/route');
    await PATCH(
      json('http://l/api/admin/dynamic/ipos/ipo-1', 'PATCH', { registrar: 'A', versions: { registrar: 'v1' }, sourceNote: 'RHP' }),
      { params: Promise.resolve({ table: 'ipos', id: 'ipo-1' }) }
    );
    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(saveMany.mock.calls[0][0].actor).toEqual({ name: 'Ravi', adminId: 'admin-42' });
  });
});

describe('non-field admin writes record the admin (name + id) in audit_logs (Tier A round 2 M2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autoResolve.mockResolvedValue({ resolved: 3, skipped: 1, details: [] });
    anchorUpsert.mockResolvedValue({ id: 'anchor-1' });
    anchorDelete.mockResolvedValue(undefined);
  });

  const expectAttributed = (action: string) => {
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][0]).toMatchObject({ adminUser: 'Ravi', details: { adminId: 'admin-42', action } });
  };

  it('dynamic/[table] POST (create a row)', async () => {
    const { POST } = await import('@/app/api/admin/dynamic/[table]/route');
    const res = await POST(json('http://l/api/admin/dynamic/registrars', 'POST', { name: 'r' }), {
      params: Promise.resolve({ table: 'registrars' }),
    });
    expect(res.status).toBe(200);
    expectAttributed('ROW_CREATED');
  });

  it('dynamic/[table] DELETE (bulk) is refused and writes nothing', async () => {
    const { DELETE } = await import('@/app/api/admin/dynamic/[table]/route');
    const res = await DELETE(json('http://l/api/admin/dynamic/registrars', 'DELETE', {}));
    expect(res.status).toBe(405);
    expect(audit).not.toHaveBeenCalled();
  });

  it('dynamic/[table]/[id] DELETE', async () => {
    const { DELETE } = await import('@/app/api/admin/dynamic/[table]/[id]/route');
    const res = await DELETE(json('http://l/api/admin/dynamic/registrars/row-9', 'DELETE', {}), {
      params: Promise.resolve({ table: 'registrars', id: 'row-9' }),
    });
    expect(res.status).toBe(200);
    expectAttributed('ROW_DELETED');
  });

  it('conflicts/auto-resolve POST records the admin who triggered it; a dry run records nothing', async () => {
    const { POST } = await import('@/app/api/admin/conflicts/auto-resolve/route');
    expect((await POST(json('http://l/api/admin/conflicts/auto-resolve', 'POST', {}))).status).toBe(200);
    expectAttributed('CONFLICTS_AUTO_RESOLVED');
    audit.mockClear();
    expect((await POST(json('http://l/api/admin/conflicts/auto-resolve', 'POST', { dryRun: true }))).status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it('anchor-investors POST', async () => {
    const { POST } = await import('@/app/api/admin/anchor-investors/route');
    const res = await POST(
      json('http://l/api/admin/anchor-investors', 'POST', {
        ipoId: '00000000-0000-4000-8000-000000000001',
        bidDate: '2026-09-01',
        totalSharesOffered: 1000,
        totalAmountRaised: '50000',
        anchorInvestorsCount: 2,
      })
    );
    expect(res.status).toBe(200);
    expectAttributed('ANCHOR_INVESTORS_SAVED');
  });

  it('anchor-investors POST refuses an investor list: the list is edited through the list editor (OD-107)', async () => {
    const { POST } = await import('@/app/api/admin/anchor-investors/route');
    const res = await POST(
      json('http://l/api/admin/anchor-investors', 'POST', {
        ipoId: '00000000-0000-4000-8000-000000000001',
        bidDate: '2026-09-01',
        totalSharesOffered: 1000,
        totalAmountRaised: '50000',
        anchorInvestorsCount: 1,
        investorList: [{ name: 'Some Fund', type: 'Mutual Fund', shares: 10, amount: 100, percentOfIssue: 1 }],
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code ?? '').toBe('USE_LIST_EDITOR');
    expect(anchorUpsert).not.toHaveBeenCalled();
  });

  it('anchor-investors DELETE', async () => {
    const { DELETE } = await import('@/app/api/admin/anchor-investors/route');
    const res = await DELETE(json('http://l/api/admin/anchor-investors?ipoId=ipo-1', 'DELETE', {}));
    expect(res.status).toBe(200);
    expectAttributed('ANCHOR_INVESTORS_DELETED');
  });
});
