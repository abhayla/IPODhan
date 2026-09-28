/**
 * GET /api/admin/queue — the admin data-quality queue (OD-63, OD-136, spec §9.4).
 *
 * Admin-only (withAdminAuth): the response carries per-source values, which never reach a reader
 * (§9.2 item 24, OD-61). Read-only: the queue never writes; every item links to the IPO-page editor,
 * the one place an admin value is written (§9.4).
 *
 * Query (all optional, validated; view filters only — the default view is everything):
 *   page (>=1), pageSize (1..200, default 50), group (1|2|3), kind (disagreement|missing|ruled),
 *   reason (a reason label as shown in counts.byReason), ipo (an IPO slug: that IPO item by item).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { AdminQueueService } from '@/lib/services/admin-queue-service';
import { QueueQuerySchema } from '@/lib/admin/queue/queue-query';

export const dynamic = 'force-dynamic';

export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = QueueQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid query', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    const q = parsed.data;
    const service = new AdminQueueService(db, getRedisClient());
    const queue = await service.getQueue({
      page: q.page,
      pageSize: q.pageSize,
      group: q.group as 1 | 2 | 3 | undefined,
      kind: q.kind,
      reason: q.reason,
      ipo: q.ipo,
    });
    return NextResponse.json({ success: true, ...queue }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/queue');
  }
});
