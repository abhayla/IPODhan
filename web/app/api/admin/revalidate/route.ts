import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { getRedisClient } from '@/lib/cache/redis-client';
import { revalidateForSlugs } from '@/lib/services/page-revalidation-service';

/**
 * POST /api/admin/revalidate
 *
 * Body: `{ slugs: string[] }`. Called once per scraper cycle with the IPOs that
 * cycle actually wrote to, so a correction reaches the reader in the same cycle
 * instead of behind two independent cache timers (OD-40).
 *
 * Auth is the SAME `requireAdminAuth()` Bearer gate already protecting
 * `/api/admin/status/update` and every other `/api/admin/*` route — no new
 * secret, no new access-control decision, one more call site of a mechanism
 * already in production.
 *
 * The handler stays this thin on purpose: everything worth testing lives in
 * `revalidateForSlugs`, which takes its Redis and `revalidatePath` as arguments
 * and is unit-tested. A route whose logic is inline can only be covered by an
 * integration test, and integration tests do not run in the PR gate here.
 */
export async function POST(request: Request) {
  const authError = await requireAdminAuth();
  if (authError) return authError;

  let slugs: unknown = [];
  try {
    const body = await request.json();
    slugs = (body as { slugs?: unknown })?.slugs ?? [];
  } catch {
    return NextResponse.json({ error: 'Body must be JSON: { slugs: string[] }' }, { status: 400 });
  }

  try {
    const redis = getRedisClient();
    const result = await revalidateForSlugs(slugs, { redis, revalidatePath });
    // Named, not counted: the caller compares this list against what it sent,
    // and a bare count would hide which slug was dropped (signal-ownership R1).
    console.log('[api/admin/revalidate]', JSON.stringify(result));
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[api/admin/revalidate] failed:', error);
    return NextResponse.json({ error: 'Revalidation failed' }, { status: 500 });
  }
}
