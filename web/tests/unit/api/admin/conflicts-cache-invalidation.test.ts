/**
 * A4 review item 2: a conflict resolved with NO field value applied (no `applyToDatabase`, no
 * `protectField` — a plain dismiss/mark-resolved) never goes through `saveAdminFieldValue`, so
 * nothing else drops the admin queue cache (`admin:queue:setup` / `admin:queue:counts`,
 * CacheTTL.ADMIN_QUEUE = 2 min). The resolved conflict would otherwise still show in the queue for
 * up to that TTL. Drives all three conflict-resolution routes through the REAL withAdminAuth (the
 * machine Bearer token) with `ConflictResolutionService` mocked to a bare success, and asserts each
 * one drops the queue cache keys on success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.setConfig({ testTimeout: 30_000 });
import { NextRequest } from 'next/server';
import { adminQueueCacheKeys } from '@/lib/cache/cache-keys';

const resolveConflict = vi.fn();
const bulkResolve = vi.fn();
const autoResolve = vi.fn();
vi.mock('@/lib/services/conflict-resolution', () => ({
  ConflictResolutionService: vi.fn(() => ({ resolveConflict, bulkResolve, autoResolve })),
}));

const redisDel = vi.fn().mockResolvedValue(1);
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: vi.fn(() => ({ del: redisDel })) }));

vi.mock('@/lib/admin/admin-write-audit', () => ({ auditAdminWrite: vi.fn().mockResolvedValue(undefined) }));

function authed(method: string, path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { authorization: 'Bearer machine-secret-value', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('conflict-resolution routes drop the admin queue cache on a successful resolve', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    vi.stubEnv('ADMIN_AUTH_TOKEN', 'machine-secret-value');
    resolveConflict.mockReset();
    bulkResolve.mockReset();
    autoResolve.mockReset();
    redisDel.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('POST /api/admin/conflicts (plain resolve, no value applied) drops the cache', async () => {
    resolveConflict.mockResolvedValue({ success: true, conflictId: 'c1', ipoId: 'i1', fieldName: 'issueSize', appliedValue: null, fieldProtected: false });
    const { POST } = await import('@/app/api/admin/conflicts/route');
    const res = await POST(authed('POST', '/api/admin/conflicts', {
      conflictId: 'c1', resolvedSource: 'NSE', resolutionReason: 'reviewed',
    }));
    expect(res.status).toBe(200);
    expect(redisDel).toHaveBeenCalledWith(...adminQueueCacheKeys());
  });

  it('POST /api/admin/conflicts/bulk-resolve drops the cache once any item succeeds', async () => {
    bulkResolve.mockResolvedValue({ successful: 2, failed: 0, results: [] });
    const { POST } = await import('@/app/api/admin/conflicts/bulk-resolve/route');
    const res = await POST(authed('POST', '/api/admin/conflicts/bulk-resolve', {
      conflictIds: ['c1', 'c2'], resolvedSource: 'NSE', resolutionReason: 'reviewed',
    }));
    expect(res.status).toBe(200);
    expect(redisDel).toHaveBeenCalledWith(...adminQueueCacheKeys());
  });

  it('POST /api/admin/conflicts/bulk-resolve does NOT drop the cache when nothing succeeded', async () => {
    bulkResolve.mockResolvedValue({ successful: 0, failed: 2, results: [] });
    const { POST } = await import('@/app/api/admin/conflicts/bulk-resolve/route');
    await POST(authed('POST', '/api/admin/conflicts/bulk-resolve', {
      conflictIds: ['c1', 'c2'], resolvedSource: 'NSE', resolutionReason: 'reviewed',
    }));
    expect(redisDel).not.toHaveBeenCalled();
  });

  it('POST /api/admin/conflicts/auto-resolve drops the cache when it resolved something', async () => {
    autoResolve.mockResolvedValue({ resolved: 3, skipped: 1, details: [] });
    const { POST } = await import('@/app/api/admin/conflicts/auto-resolve/route');
    const res = await POST(authed('POST', '/api/admin/conflicts/auto-resolve', {}));
    expect(res.status).toBe(200);
    expect(redisDel).toHaveBeenCalledWith(...adminQueueCacheKeys());
  });

  it('POST /api/admin/conflicts/auto-resolve does NOT drop the cache on a dry run', async () => {
    autoResolve.mockResolvedValue({ resolved: 3, skipped: 1, details: [] });
    const { POST } = await import('@/app/api/admin/conflicts/auto-resolve/route');
    await POST(authed('POST', '/api/admin/conflicts/auto-resolve', { dryRun: true }));
    expect(redisDel).not.toHaveBeenCalled();
  });
});
