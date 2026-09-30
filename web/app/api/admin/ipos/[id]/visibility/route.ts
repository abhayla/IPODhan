/**
 * POST /api/admin/ipos/[id]/visibility — hide or unhide an IPO (§9.2 item 23, OD-116 as corrected
 * by OD-118). Never deletes. Body: { action: 'hide', reason } | { action: 'unhide', reason? }.
 *
 * Hide needs a written reason; the admin's name and account id are recorded on the row and in the
 * audit log (same transaction). The reader caches for the row are dropped at once; the address
 * answers 410 within HIDDEN_SLUGS_TTL_MS on every process.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { invalidateIPOCaches } from '@/lib/cache/ipo-cache-invalidation';
import { revalidateForSlugs } from '@/lib/services/page-revalidation-service';
import { logger } from '@/lib/logger';
import { withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import { hideIpo, unhideIpo, HIDE_REASON_MAX_LENGTH } from '@/lib/services/ipo-visibility-service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hide'), reason: z.string().max(HIDE_REASON_MAX_LENGTH) }),
  z.object({ action: z.literal('unhide'), reason: z.string().max(HIDE_REASON_MAX_LENGTH).optional() }),
]);

const STATUS_FOR: Record<string, number> = { NOT_FOUND: 404, ALREADY_HIDDEN: 409, NOT_HIDDEN: 409, REASON_REQUIRED: 400 };

export const POST = withAdminAuth(
  async (request: NextRequest, admin: AdminAuthContext, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad Request', message: 'Invalid id' }, { status: 400 });

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', message: "Body must be { action: 'hide', reason } or { action: 'unhide' }" },
        { status: 400 }
      );
    }

    // hidden_by_admin_id is a uuid: a personal account's id; the machine-token identity is recorded by name only.
    const actor = { adminName: admin.adminName, adminId: UUID_RE.test(admin.adminId ?? '') ? admin.adminId : null };
    const outcome =
      body.action === 'hide'
        ? await hideIpo(db, { ipoId: id, reason: body.reason, actor })
        : await unhideIpo(db, { ipoId: id, actor, reason: body.reason });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.code, message: outcome.message }, { status: STATUS_FOR[outcome.code] ?? 400 });
    }

    // Reader caches: best-effort, the row change above is the record either way.
    try {
      const redis = getRedisClient();
      await invalidateIPOCaches(redis, outcome.ipoId, outcome.slug);
      await revalidateForSlugs([outcome.slug], { redis, revalidatePath });
      revalidatePath('/sitemap.xml');
    } catch (error) {
      logger.warn(
        { ipoId: outcome.ipoId, error: error instanceof Error ? error.message : String(error) },
        '[item 23] cache refresh after visibility change failed; pages refresh on their timers'
      );
    }

    logger.info({ ipoId: outcome.ipoId, slug: outcome.slug, action: body.action, by: admin.adminId }, '[item 23] IPO visibility changed');
    return NextResponse.json({
      success: true,
      data: { ipoId: outcome.ipoId, slug: outcome.slug, hidden: outcome.hiddenAt !== null, hiddenAt: outcome.hiddenAt },
    });
  }
);
