import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { updateIPOStatuses } from '@/lib/services/status-updater-service';

/**
 * POST /api/admin/status/update
 *
 * Applies time-based IPO status transitions
 * (UPCOMING -> OPEN -> CLOSED -> LISTED) based on each IPO's dates, and
 * invalidates the affected caches. Idempotent — safe to call repeatedly.
 *
 * Triggered on a schedule by the scraper one-shot after each run (GitHub #4),
 * so statuses stay current without the bit-rotted scheduler. Admin-only.
 */
export async function POST() {
  const authError = await requireAdminAuth();
  if (authError) return authError;

  try {
    const result = await updateIPOStatuses();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[api/admin/status/update] failed:', error);
    return NextResponse.json({ error: 'Status update failed' }, { status: 500 });
  }
}
