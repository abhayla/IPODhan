/**
 * Web side of the ONE admin field write (spec §9.2 items 10, 11). Every admin route that saves a
 * field value calls `saveAdminFieldValue`; nothing in `web/app/api/admin` writes a field value
 * directly. The transaction (value + ADMIN provenance + protection + audit + version check) lives in
 * `@ipodhan/shared/services/admin-field-write`; this wrapper adds what must happen AFTER commit:
 * dropping the real cache keys (F-171 — named keys, never a pattern passed to DEL) and revalidating
 * the IPO page, so a reader sees the save on the next request.
 */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  writeAdminFieldValue,
  type AdminFieldWriteInput,
  type AdminFieldWriteResult,
  type TypedValueCheck,
} from '@ipodhan/shared/services/admin-field-write';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { getIPOByIdKey } from '@/lib/cache/cache-keys';
import { revalidateForSlugs } from '@/lib/services/page-revalidation-service';

export interface AdminFieldSaveDeps {
  write: typeof writeAdminFieldValue;
  getDb: typeof getDb;
  redis: () => { del(key: string): Promise<unknown> };
  revalidatePath: (path: string) => void;
  checkTypedValue?: TypedValueCheck;
}

const defaultDeps: AdminFieldSaveDeps = {
  write: writeAdminFieldValue,
  getDb,
  redis: () => getRedisClient(),
  revalidatePath,
};

export async function saveAdminFieldValue(
  input: AdminFieldWriteInput,
  deps: AdminFieldSaveDeps = defaultDeps
): Promise<AdminFieldWriteResult> {
  const db = await deps.getDb();
  const result = await deps.write(db as never, input, deps.checkTypedValue);
  if (result.kind === 'OK') {
    try {
      const redis = deps.redis();
      await redis.del(getIPOByIdKey(result.ipoId));
      // Drops getIPOBySlugKey, getIPODetailKey and getIPOProvenanceKey for the slug and
      // revalidates /ipos/<slug> (the same path the authenticated revalidate endpoint runs).
      await revalidateForSlugs([result.slug], { redis, revalidatePath: deps.revalidatePath });
    } catch (error) {
      // The write is committed; a failed cache drop only delays the reader by the TTL.
      console.warn('[admin-field-save] cache drop after commit failed:', error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Map a write result to the HTTP answer every admin route gives: 400 / 404 / 409 / 200 (#1159). */
export function adminWriteResponse(result: AdminFieldWriteResult, extra?: Record<string, unknown>): NextResponse {
  switch (result.kind) {
    case 'INVALID':
      return NextResponse.json({ success: false, error: 'INVALID', reason: result.reason }, { status: 400 });
    case 'NOT_FOUND':
      return NextResponse.json({ success: false, error: 'NOT_FOUND', reason: result.reason }, { status: 404 });
    case 'CONFLICT':
      return NextResponse.json(
        {
          success: false,
          error: 'CONFLICT',
          reason: 'the field changed after the editor opened; review the newer value and save again if still needed',
          currentValue: result.currentValue,
          setBy: result.setBy,
          setAt: result.setAt,
          currentVersion: result.currentVersion,
        },
        { status: 409 }
      );
    case 'OK':
      return NextResponse.json({
        success: true,
        data: {
          ipoId: result.ipoId,
          tableName: result.tableName,
          fieldName: result.fieldName,
          oldValue: result.oldValue,
          value: result.newValue,
          version: result.version,
          ...extra,
        },
      });
  }
}
