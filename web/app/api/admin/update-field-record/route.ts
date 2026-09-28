/**
 * API Route: Update one field of one row in a several-rows-per-IPO table
 * GET   /api/admin/update-field-record?ipoId&tableName&fieldName&recordId -> current value + version token
 * PATCH /api/admin/update-field-record                                  -> save through the ONE admin write
 *
 * Tables: documents, peer_companies (`ADMIN_ROW_TABLES`). ipo_reviews is retired (OD-125, #1243)
 * and refused. Every save goes through `saveAdminFieldValue` (spec §9.2 items 3, 11, 20): the row
 * is addressed by its natural row key (peer_companies: normalized_name, re-derived when company_name
 * is edited, R-158; documents: the id), and the value, ADMIN provenance under that row key, the
 * row's hold, the audit row (with the admin id) and the version check commit together.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { getDocumentsKey, getPeerCompaniesKey } from '@/lib/cache/cache-keys';
import { getClientIP, getUserAgent } from '@/lib/services/audit-log-service';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { saveAdminFieldValue, adminWriteResponse } from '@/lib/admin/admin-field-save';
import { ADMIN_ROW_TABLES, readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';

interface UpdateFieldRecordRequest {
  recordId: string;
  ipoId: string;
  tableName: string;
  fieldName: string;
  value?: unknown;
  /** OD-121: delete the value; the reason is required. */
  emptyReason?: string;
  /** 'pick' saves the named source's STORED answer (value sent with a pick is ignored, OD-109). */
  mode?: 'pick' | 'typed';
  sourceLabel?: string;
  sourceNote?: string;
  /** Legacy name for the typed source note. */
  editNote?: string;
  overrideReason?: string;
  expectedVersion: string;
}

function refuseTable(tableName: string): NextResponse {
  return NextResponse.json(
    { error: `Unknown table: ${tableName}. Supported: ${ADMIN_ROW_TABLES.join(', ')}` },
    { status: 400 }
  );
}

/** The read-side cache key each row table's repository reads (shared helpers, never hand-typed). */
function entityCacheKey(tableName: string, ipoId: string): string | null {
  if (tableName === 'documents') return getDocumentsKey(ipoId);
  if (tableName === 'peer_companies') return getPeerCompaniesKey(ipoId);
  return null;
}

export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const url = new URL(request.url);
    const ipoId = url.searchParams.get('ipoId');
    const tableName = url.searchParams.get('tableName');
    const fieldName = url.searchParams.get('fieldName');
    const recordId = url.searchParams.get('recordId');
    if (!ipoId || !tableName || !fieldName || !recordId) {
      return NextResponse.json({ error: 'ipoId, tableName, fieldName and recordId are required' }, { status: 400 });
    }
    if (!ADMIN_ROW_TABLES.includes(tableName)) return refuseTable(tableName);
    const db = await getDb();
    const version = await readAdminFieldVersion(db as never, ipoId, tableName, fieldName, { recordId });
    if (!version) return NextResponse.json({ error: `${tableName}.${fieldName} row ${recordId} not found` }, { status: 404 });
    return NextResponse.json({ success: true, data: version });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/update-field-record');
  }
});

export const PATCH = withAdminAuth(async (request: NextRequest, adminContext) => {
  let body: UpdateFieldRecordRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }
  try {
    const { recordId, ipoId, tableName, fieldName } = body ?? ({} as UpdateFieldRecordRequest);
    if (!recordId || !ipoId || !tableName || !fieldName) {
      return NextResponse.json({ error: 'recordId, ipoId, tableName, and fieldName are required' }, { status: 400 });
    }
    if (!ADMIN_ROW_TABLES.includes(tableName)) return refuseTable(tableName);

    const mode =
      body.mode === 'pick'
        ? { kind: 'pick' as const, sourceLabel: body.sourceLabel ?? '' }
        : { kind: 'typed' as const, sourceNote: body.sourceNote ?? body.editNote ?? '' };
    const result = await saveAdminFieldValue({
      ipoId,
      tableName,
      row: { recordId },
      fieldName,
      value: mode.kind === 'pick' ? undefined : body.value,
      empty: typeof body.emptyReason === 'string' ? { reason: body.emptyReason } : undefined,
      mode,
      overrideReason: body.overrideReason,
      expectedVersion: body.expectedVersion,
      actor: { name: adminContext.adminName, adminId: adminContext.adminId },
      entryPoint: 'api/admin/update-field-record',
      detail: { recordId },
      ipAddress: getClientIP(request) ?? null,
      userAgent: getUserAgent(request) ?? null,
    });

    if (result.kind === 'OK') {
      const key = entityCacheKey(tableName, ipoId);
      if (key) {
        try {
          await getRedisClient().del(key);
        } catch (error) {
          console.warn('[Admin API] row cache drop after commit failed:', error instanceof Error ? error.message : error);
        }
      }
    }
    return adminWriteResponse(result, result.kind === 'OK' ? { recordId, rowKey: result.rowKey } : undefined);
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/update-field-record');
  }
});
