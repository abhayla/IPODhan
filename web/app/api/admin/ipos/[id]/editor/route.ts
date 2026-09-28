/**
 * GET /api/admin/ipos/[id]/editor -- the IPO page editor's data (spec §9.2 items 2, 5, 7, 17, 20, 24;
 * §9.3). Admin-only (withAdminAuth): the per-source values are fetched by the editor through its own
 * logged-in request and are never part of the public page payload or its cache keys (item 24).
 * Never cached: every field's value is returned with the version token it was read with (item 20).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { loadIpoEditor } from '@/lib/admin/ipo-editor-data';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAdminAuth(async (_request: NextRequest, _admin, context: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id ?? '')) return NextResponse.json({ error: 'id must be an IPO uuid' }, { status: 400 });
    const db = await getDb();
    const payload = await loadIpoEditor(db as never, id);
    if (!payload) return NextResponse.json({ error: `IPO ${id} not found` }, { status: 404 });
    return NextResponse.json({ success: true, data: payload }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/ipos/[id]/editor');
  }
});
