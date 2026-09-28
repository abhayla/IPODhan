/**
 * API Route: Update Field Value
 * GET   /api/admin/update-field?ipoId&tableName&fieldName  -> current value + version token
 * PATCH /api/admin/update-field                             -> save through the ONE admin write
 *
 * Every save goes through `saveAdminFieldValue` (spec §9.2 item 11): value, ADMIN provenance,
 * protection, audit row and version check in one transaction, then the cache drop. This route only
 * parses the request and maps the result: INVALID -> 400, NOT_FOUND -> 404, CONFLICT -> 409.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getClientIP, getUserAgent } from '@/lib/services/audit-log-service';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { saveAdminFieldValue, adminWriteResponse } from '@/lib/admin/admin-field-save';
import { readAdminFieldVersion, type AdminWriteMode } from '@ipodhan/shared/services/admin-field-write';

interface UpdateFieldRequest {
  ipoId: string;
  tableName: string;
  fieldName: string;
  value?: unknown;
  /** OD-121: delete the value; the reason is required. */
  emptyReason?: string;
  /** 'pick' (with sourceLabel + readDate) or 'typed' (with sourceNote). Defaults to 'typed'. */
  mode?: 'pick' | 'typed';
  sourceLabel?: string;
  readDate?: string | null;
  sourceNote?: string;
  /** Legacy name for the typed source note. */
  editNote?: string;
  overrideReason?: string;
  expectedVersion: string;
}

export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const url = new URL(request.url);
    const ipoId = url.searchParams.get('ipoId');
    const tableName = url.searchParams.get('tableName');
    const fieldName = url.searchParams.get('fieldName');
    if (!ipoId || !tableName || !fieldName) {
      return NextResponse.json({ error: 'ipoId, tableName and fieldName are required' }, { status: 400 });
    }
    const db = await getDb();
    const version = await readAdminFieldVersion(db as never, ipoId, tableName, fieldName);
    if (!version) return NextResponse.json({ error: `${tableName}.${fieldName} is not admin-writable` }, { status: 400 });
    return NextResponse.json({ success: true, data: version });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/update-field');
  }
});

export const PATCH = withAdminAuth(async (request: NextRequest, adminContext) => {
  let body: UpdateFieldRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }
  if (!body || !body.ipoId || !body.tableName || !body.fieldName) {
    return NextResponse.json({ error: 'ipoId, tableName, and fieldName are required' }, { status: 400 });
  }

  const mode: AdminWriteMode =
    body.mode === 'pick'
      ? { kind: 'pick', sourceLabel: body.sourceLabel ?? '', readDate: body.readDate ?? null }
      : { kind: 'typed', sourceNote: body.sourceNote ?? body.editNote ?? '' };

  try {
    const result = await saveAdminFieldValue({
      ipoId: body.ipoId,
      tableName: body.tableName,
      fieldName: body.fieldName,
      value: body.value,
      empty: body.emptyReason !== undefined ? { reason: body.emptyReason } : undefined,
      mode,
      overrideReason: body.overrideReason,
      expectedVersion: body.expectedVersion,
      actor: { name: adminContext.adminName, adminId: adminContext.adminId },
      entryPoint: 'api/admin/update-field',
      ipAddress: getClientIP(request) ?? null,
      userAgent: getUserAgent(request) ?? null,
    });
    return adminWriteResponse(result);
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/update-field');
  }
});
