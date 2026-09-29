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
  STALE_EDITOR_REASON,
} from '@ipodhan/shared/services/admin-field-write';
import type { PlanManifest } from '@ipodhan/shared/services/plan-invalidating-rebuild';
import fieldManifestJson from '../../../scraper/config/field-manifest.json';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  getIPOByIdKey,
  getIpoDetailsKey,
  getFinancialDataKey,
  getIpoFinancialsKey,
  getListingPerformanceKey,
  getIPOScoreKey,
  getPeerCompaniesKey,
  getDocumentsKey,
  adminQueueCacheKeys,
} from '@/lib/cache/cache-keys';
import { invalidateIPOCaches } from '@/lib/cache/ipo-cache-invalidation';
import { revalidateForSlugs } from '@/lib/services/page-revalidation-service';

/**
 * M3 (F-171): the exact cache keys a save in each admin-writable table leaves stale, beyond the IPO's
 * id/slug/detail/provenance keys every save drops. Each is the key the table's repository reads
 * (web/lib/cache/cache-keys.ts). `ipos` also clears the list/search keys via invalidateIPOCaches.
 * A table missing here is a table whose readers keep serving the old value for the TTL — the unit
 * test asserts every admin-writable table has an entry.
 */
export const TABLE_CACHE_KEYS: Record<string, (ipoId: string) => string[]> = {
  ipos: () => [],
  ipo_details: (id) => [getIpoDetailsKey(id)],
  financial_data: (id) => [getFinancialDataKey(id)],
  ipo_financials: (id) => [getIpoFinancialsKey(id)],
  listing_performance: (id) => [getListingPerformanceKey(id)],
  ipo_scores: (id) => [getIPOScoreKey(id)],
  peer_companies: (id) => [getPeerCompaniesKey(id)],
  documents: (id) => [getDocumentsKey(id)],
};

/**
 * The table's own keys plus the admin queue's keys (OD-136): any admin save can resolve a queue item
 * (a value supplied, a hold added, a flagged value corrected), so the queue never shows it for the TTL.
 */
export function tableCacheKeys(tableName: string, ipoId: string): string[] {
  return [...(TABLE_CACHE_KEYS[tableName]?.(ipoId) ?? []), ...adminQueueCacheKeys()];
}

export interface AdminFieldSaveDeps {
  write: typeof writeAdminFieldValue;
  getDb: typeof getDb;
  redis: () => { del(...keys: string[]): Promise<unknown>; keys?(pattern: string): Promise<string[]> };
  revalidatePath: (path: string) => void;
  checkTypedValue?: TypedValueCheck;
  /**
   * §2.8 / §9.2 item 18: the manifest a type/segment/venue save rebuilds the IPO's plan from, inside
   * the write's transaction. Defaults to the deployed `scraper/config/field-manifest.json`.
   */
  planManifest?: PlanManifest;
}

const FIELD_MANIFEST = fieldManifestJson as unknown as PlanManifest;

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
  const result = await deps.write(db as never, input, deps.checkTypedValue, { planManifest: deps.planManifest ?? FIELD_MANIFEST });
  if (result.kind === 'OK') {
    try {
      const redis = deps.redis();
      await redis.del(getIPOByIdKey(result.ipoId));
      for (const key of tableCacheKeys(result.tableName, result.ipoId)) await redis.del(key);
      if (result.tableName === 'ipos' && typeof redis.keys === 'function') {
        // The PATCH /api/admin/ipos/[id] path used to call this; every ipos save now does (list/search pages).
        await invalidateIPOCaches(redis as never, result.ipoId, result.slug);
      }
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

export interface AdminFieldsSaveRequest {
  ipoId: string;
  /** SQL table name (`ipos` or a one-row-per-IPO child table). */
  tableName: string;
  /** field name (camelCase) -> typed value */
  values: Record<string, unknown>;
  /** field name -> the version token the editor opened that field with (§9.2 item 20). */
  versions: Record<string, string | undefined> | undefined;
  sourceNote: string | undefined;
  overrideReason?: string;
  actor: AdminFieldWriteInput['actor'];
  entryPoint: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AdminFieldsSaveOutcome {
  saved: string[];
  refused: { fieldName: string; result: Exclude<AdminFieldWriteResult, { kind: 'OK' }> } | null;
}

/**
 * A multi-field admin form save: every field goes through the ONE admin write, one by one, each
 * with its own token. A missing token refuses the whole save before anything is written; the first
 * refusal stops the rest (fields already saved stay saved and are listed).
 */
export async function saveAdminFieldValues(
  req: AdminFieldsSaveRequest,
  deps: AdminFieldSaveDeps = defaultDeps
): Promise<AdminFieldsSaveOutcome> {
  const fields = Object.keys(req.values);
  const missing = fields.find((f) => typeof req.versions?.[f] !== 'string' || req.versions?.[f] === '');
  if (missing) {
    return { saved: [], refused: { fieldName: missing, result: { kind: 'INVALID', reason: `${missing}: ${STALE_EDITOR_REASON}` } } };
  }
  const saved: string[] = [];
  for (const fieldName of fields) {
    const result = await saveAdminFieldValue(
      {
        ipoId: req.ipoId,
        tableName: req.tableName,
        fieldName,
        value: req.values[fieldName],
        mode: { kind: 'typed', sourceNote: req.sourceNote ?? '' },
        overrideReason: req.overrideReason,
        expectedVersion: req.versions![fieldName]!,
        actor: req.actor,
        entryPoint: req.entryPoint,
        ipAddress: req.ipAddress ?? null,
        userAgent: req.userAgent ?? null,
      },
      deps
    );
    if (result.kind !== 'OK') return { saved, refused: { fieldName, result } };
    saved.push(fieldName);
  }
  return { saved, refused: null };
}

/** HTTP answer for a multi-field save: the first refusal's status (400/404/409), else 200. */
export function adminFieldsSaveResponse(outcome: AdminFieldsSaveOutcome): NextResponse {
  if (outcome.refused) {
    const r = adminWriteResponse(outcome.refused.result);
    return NextResponse.json(
      { ...(outcome.refused.result as object), success: false, error: outcome.refused.result.kind, fieldName: outcome.refused.fieldName, saved: outcome.saved },
      { status: r.status }
    );
  }
  return NextResponse.json({ success: true, saved: outcome.saved });
}

/**
 * §9.2 item 11 (OD-121): there is no "return to the loop". An admin hold is never released by an
 * unprotect action; to remove a value the admin saves the field empty through the editor.
 */
export const UNPROTECT_GONE_MESSAGE =
  'unprotect is gone (spec §9.2 item 11, OD-121): an admin value is never handed back to the sources; to remove it, save the field empty in the field editor';

export function unprotectGoneResponse(): NextResponse {
  return NextResponse.json({ success: false, error: 'GONE', reason: UNPROTECT_GONE_MESSAGE }, { status: 410 });
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
