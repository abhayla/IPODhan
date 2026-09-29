/**
 * API Route: re-apply an admin value a relaunch cleared (spec §9.2 item 27, OD-120)
 * GET  /api/admin/relaunch-reapply?audit=<id>  -> a one-button confirm page (the alert's link)
 * POST /api/admin/relaunch-reapply             -> re-apply through the ONE admin write
 *
 * Admin session + same-origin (withAdminAuth). The GET never writes: a link opened from the alert
 * shows the value and one button, whose same-origin POST does the write, so a cross-site link cannot
 * re-apply anything. The write is `saveAdminFieldValue` (value, ADMIN provenance, hold, audit, a
 * fresh version token, then the cache drop), built by `buildRelaunchReapplyInput`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getClientIP, getUserAgent } from '@/lib/services/audit-log-service';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { saveAdminFieldValue } from '@/lib/admin/admin-field-save';
import { buildRelaunchReapplyInput, RELAUNCH_CLEARED_AUDIT_ACTION } from '@ipodhan/shared/services/relaunch-reapply';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem">${body}</body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const auditId = new URL(request.url).searchParams.get('audit') ?? '';
    if (!UUID.test(auditId)) return page('Re-apply', '<p>This link has no valid cleared-value id.</p>', 400);
    const db = await getDb();
    const res = (await db.execute(sql`
      SELECT a.table_name, a.field_name, a.old_value, a.details, i.slug, i.company_name
        FROM audit_logs a JOIN ipos i ON i.id = a.ipo_id
       WHERE a.id = ${auditId}::uuid AND a.action_type = ${RELAUNCH_CLEARED_AUDIT_ACTION}`)) as unknown as {
      rows: Array<{ table_name: string; field_name: string; old_value: string | null; details: Record<string, unknown> | null; slug: string; company_name: string }>;
    };
    const row = res.rows[0];
    if (!row) return page('Re-apply', '<p>No relaunch-cleared value with this id.</p>', 404);
    const empty = row.details?.adminEmpty === true;
    const what = empty ? 'keep this field empty (as you had it)' : `set it back to <b>${escapeHtml(row.old_value ?? '')}</b>`;
    const says = row.details?.newFilingValue == null ? 'does not state it' : `says <b>${escapeHtml(String(row.details.newFilingValue))}</b>`;
    return page(
      'Re-apply a cleared value',
      `<h1 style="font-size:1.25rem">${escapeHtml(row.company_name)}: ${escapeHtml(`${row.table_name}.${row.field_name}`)}</h1>
<p>The relaunch filing cleared your value. The new filing ${says}.</p>
<form method="post" action="/api/admin/relaunch-reapply"><input type="hidden" name="audit" value="${escapeHtml(auditId)}">
<button type="submit" style="font-size:1rem;padding:.6rem 1.2rem">Re-apply: ${what}</button></form>
<p><a href="/ipos/${encodeURIComponent(row.slug)}?edit=${encodeURIComponent(row.field_name)}">Open the editor instead</a></p>`
    );
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/relaunch-reapply');
  }
});

export const POST = withAdminAuth(async (request: NextRequest, adminContext) => {
  let auditId = '';
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  try {
    if (isJson) auditId = String(((await request.json()) as { audit?: unknown }).audit ?? '');
    else auditId = String((await request.formData()).get('audit') ?? '');
  } catch {
    return NextResponse.json({ error: 'Send the cleared-value id as `audit`' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const actor = { name: adminContext.adminName, adminId: adminContext.adminId };
    const built = await buildRelaunchReapplyInput(db as never, auditId, actor);
    if (!built.ok) {
      return isJson
        ? NextResponse.json({ error: built.reason }, { status: built.status })
        : page('Re-apply', `<p>${escapeHtml(built.reason)}</p>`, built.status);
    }
    const result = await saveAdminFieldValue({ ...built.input, ipAddress: getClientIP(request) ?? null, userAgent: getUserAgent(request) ?? null });
    if (result.kind !== 'OK') {
      const status = result.kind === 'CONFLICT' ? 409 : result.kind === 'NOT_FOUND' ? 404 : 400;
      const reason = 'reason' in result ? result.reason : 'the field changed after it was cleared; open the editor';
      return isJson ? NextResponse.json({ error: reason, result }, { status }) : page('Re-apply', `<p>${escapeHtml(reason)}</p>`, status);
    }
    if (isJson) return NextResponse.json({ success: true, data: result });
    return NextResponse.redirect(new URL(`/ipos/${encodeURIComponent(result.slug)}?edit=${encodeURIComponent(result.fieldName)}`, request.url), 303);
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/relaunch-reapply');
  }
});
