/**
 * C1 (Tier A review of the admin-accounts branch): the dynamic admin routes resolve a table only
 * from an explicit allow-list. An admin/auth table name (admin_users, admin_sessions — present
 * once the accounts branch merges) must 404 on every dynamic route, read or write.
 */
import { describe, it, expect, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/admin-auth', () => ({ requireAdminAuth: async () => null }));
vi.mock('@/lib/middleware/admin-auth', () => ({
  withAdminAuth: (handler: any) => (request: any, ...args: any[]) =>
    handler(request, { adminId: 'admin-1', adminName: 'Admin', isAuthenticated: true }, ...args),
}));
vi.mock('@/lib/db', () => ({ db: {}, getDb: async () => ({}) }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: () => ({}) }));

import { resolveDynamicTable, DYNAMIC_TABLE_NAMES } from '@/lib/admin/dynamic-table-allow-list';
import * as listRoute from '@/app/api/admin/dynamic/[table]/list/route';
import * as tableRoute from '@/app/api/admin/dynamic/[table]/route';
import * as idRoute from '@/app/api/admin/dynamic/[table]/[id]/route';

const AUTH_NAMES = ['adminUsers', 'admin_users', 'adminSessions', 'admin_sessions', 'constructor', '__proto__'];
const req = (method: string) =>
  new NextRequest('http://localhost/api/admin/dynamic/x', { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });

describe('dynamic table allow-list (C1)', () => {
  it('contains no table whose SQL name starts with admin_', () => {
    for (const name of DYNAMIC_TABLE_NAMES) {
      const t = resolveDynamicTable(name, 'read');
      expect(t, name).not.toBeNull();
      expect(getTableName(t!)).not.toMatch(/^admin_/);
    }
  });

  it('resolves no admin/auth or prototype name, read or write', () => {
    for (const n of AUTH_NAMES) {
      expect(resolveDynamicTable(n, 'read')).toBeNull();
      expect(resolveDynamicTable(n, 'write')).toBeNull();
    }
  });

  it('protection holds and the audit trail are read-only (§9.2 item 11)', () => {
    expect(resolveDynamicTable('fieldProtectionMetadata', 'read')).not.toBeNull();
    expect(resolveDynamicTable('fieldProtectionMetadata', 'write')).toBeNull();
    expect(resolveDynamicTable('auditLogs', 'write')).toBeNull();
  });

  for (const name of ['adminUsers', 'admin_users']) {
    it(`GET /dynamic/${name}/list -> 404`, async () => {
      const r = await listRoute.GET(req('GET'), { params: Promise.resolve({ table: name }) } as never);
      expect(r.status).toBe(404);
    });
    it(`POST /dynamic/${name} -> 404`, async () => {
      const r = await tableRoute.POST(req('POST'), { params: Promise.resolve({ table: name }) } as never);
      expect(r.status).toBe(404);
    });
    for (const verb of ['GET', 'PATCH', 'DELETE'] as const) {
      it(`${verb} /dynamic/${name}/[id] -> 404`, async () => {
        const handler = (idRoute as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>)[verb];
        const r = await handler(req(verb), { params: Promise.resolve({ table: name, id: 'x' }) });
        expect(r.status).toBe(404);
      });
    }
  }
});
