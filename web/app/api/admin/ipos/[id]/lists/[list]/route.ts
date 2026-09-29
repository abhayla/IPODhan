/**
 * /api/admin/ipos/[id]/lists/[list] -- the IPO page editor's LIST editor (spec §9.2 items 8, 20,
 * 28(b); OD-107, OD-121). Admin-only (withAdminAuth).
 *   GET  -> the list's rows (label, row key, row) and the version token a save must carry (item 20).
 *   POST -> { op, expectedVersion }: one add / edit / remove through the ONE admin list write
 *           (writeAdminListChange). A remove needs a short reason. A stale token is refused (409).
 * After a committed save the IPO's caches, the admin queue's keys and the page are dropped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { getIPOByIdKey } from '@/lib/cache/cache-keys';
import { invalidateIPOCaches } from '@/lib/cache/ipo-cache-invalidation';
import { revalidateForSlugs } from '@/lib/services/page-revalidation-service';
import { getClientIP, getUserAgent } from '@/lib/services/audit-log-service';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { tableCacheKeys } from '@/lib/admin/admin-field-save';
import { ADMIN_LISTS, readAdminList, writeAdminListChange, type AdminListName, type AdminListOp } from '@ipodhan/shared/services/admin-list-write';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; list: string }> };

async function target(context: Ctx): Promise<{ id: string; list: AdminListName } | NextResponse> {
  const { id, list } = await context.params;
  if (!UUID_RE.test(id ?? '')) return NextResponse.json({ error: 'id must be an IPO uuid' }, { status: 400 });
  if (!(ADMIN_LISTS as readonly string[]).includes(list)) return NextResponse.json({ error: `unknown list "${list}"` }, { status: 404 });
  return { id, list: list as AdminListName };
}

function parseOp(raw: unknown): AdminListOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const row = o.row && typeof o.row === 'object' && !Array.isArray(o.row) ? (o.row as Record<string, unknown>) : null;
  if (o.kind === 'add' && row) return { kind: 'add', row };
  if (o.kind === 'edit' && row && typeof o.rowKey === 'string') return { kind: 'edit', rowKey: o.rowKey, row };
  if (o.kind === 'remove' && Array.isArray(o.rowKeys) && o.rowKeys.every((k) => typeof k === 'string') && typeof o.reason === 'string') {
    return { kind: 'remove', rowKeys: o.rowKeys as string[], reason: o.reason };
  }
  return null;
}

export const GET = withAdminAuth(async (_request: NextRequest, _admin, context: Ctx) => {
  try {
    const t = await target(context);
    if (t instanceof NextResponse) return t;
    const db = await getDb();
    const data = await readAdminList(db as never, t.id, t.list);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/ipos/[id]/lists/[list]');
  }
});

export const POST = withAdminAuth(async (request: NextRequest, admin, context: Ctx) => {
  try {
    const t = await target(context);
    if (t instanceof NextResponse) return t;
    const body = (await request.json().catch(() => null)) as { op?: unknown; expectedVersion?: unknown } | null;
    const op = parseOp(body?.op);
    if (!op) return NextResponse.json({ success: false, error: 'INVALID', reason: 'op must be add {row}, edit {rowKey,row} or remove {rowKeys,reason}' }, { status: 400 });
    const db = await getDb();
    const result = await writeAdminListChange(db as never, {
      ipoId: t.id,
      list: t.list,
      op,
      expectedVersion: typeof body?.expectedVersion === 'string' ? body.expectedVersion : '',
      actor: { name: admin.adminName, adminId: admin.adminId },
      entryPoint: 'api/admin/ipos/[id]/lists/[list]',
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
    });
    if (result.kind === 'OK') {
      try {
        const redis = getRedisClient();
        await redis.del(getIPOByIdKey(result.ipoId));
        for (const key of tableCacheKeys(t.list === 'lead_managers' ? 'ipos' : t.list, result.ipoId)) await redis.del(key);
        if (typeof redis.keys === 'function') await invalidateIPOCaches(redis as never, result.ipoId, result.slug);
        await revalidateForSlugs([result.slug], { redis, revalidatePath });
      } catch (error) {
        // The write is committed; a failed cache drop only delays the reader by the TTL.
        console.warn('[admin-list-save] cache drop after commit failed:', error instanceof Error ? error.message : error);
      }
      return NextResponse.json({ success: true, data: result });
    }
    const status = result.kind === 'CONFLICT' ? 409 : result.kind === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ success: false, error: result.kind, ...result }, { status });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/ipos/[id]/lists/[list]');
  }
});
