/**
 * §9.2 item 27 (OD-120): the one-click re-apply of an admin value a relaunch cleared. The handle is
 * the relaunch-clear audit row (relaunch-admin-clear.ts); the value goes back through the ONE admin
 * write (`writeAdminFieldValue`) with a version token read now, so it lands with ADMIN provenance, a
 * hold and its own audit row like any admin save. An EMPTY value re-applies as an admin empty with its
 * original reason (OD-121). A value already re-applied is refused.
 */
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema';
import { readAdminFieldVersion, type AdminActor, type AdminFieldWriteInput } from './admin-field-write';
import { RELAUNCH_CLEARED_AUDIT_ACTION } from './relaunch-admin-clear';

export { RELAUNCH_CLEARED_AUDIT_ACTION };
export const RELAUNCH_REAPPLY_ENTRY_POINT = 'api/admin/relaunch-reapply';

type Db = NodePgDatabase<typeof schema>;

export type RelaunchReapplyBuild = { ok: true; input: AdminFieldWriteInput } | { ok: false; status: 400 | 404 | 409; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowsOf(r: unknown): Record<string, unknown>[] {
  return ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[])) ?? [];
}

export async function buildRelaunchReapplyInput(db: Db, auditId: string, actor: AdminActor): Promise<RelaunchReapplyBuild> {
  if (typeof auditId !== 'string' || !UUID.test(auditId)) return { ok: false, status: 400, reason: 'audit must be a relaunch-clear audit row id' };
  const row = rowsOf(
    await db.execute(sql`
      SELECT id, ipo_id, table_name, field_name, old_value, details FROM audit_logs
       WHERE id = ${auditId}::uuid AND action_type = ${RELAUNCH_CLEARED_AUDIT_ACTION} AND success = true`)
  )[0] as
    | { id: string; ipo_id: string | null; table_name: string; field_name: string; old_value: string | null; details: Record<string, unknown> | null }
    | undefined;
  if (!row || !row.ipo_id) return { ok: false, status: 404, reason: `no relaunch-cleared value ${auditId}` };
  const done = rowsOf(
    await db.execute(sql`
      SELECT id FROM audit_logs WHERE ipo_id = ${row.ipo_id}::uuid AND details->>'reappliedFrom' = ${auditId} AND success = true LIMIT 1`)
  );
  if (done.length > 0) return { ok: false, status: 409, reason: `the cleared value ${auditId} was already re-applied` };

  const version = await readAdminFieldVersion(db, row.ipo_id, row.table_name, row.field_name);
  if (!version) return { ok: false, status: 400, reason: `${row.table_name}.${row.field_name} is not admin-writable` };
  const d = row.details ?? {};
  const prev = (d.previousLineage ?? {}) as Record<string, unknown>;
  const detail = { reappliedFrom: auditId, relaunchDocumentId: d.documentId ?? null };
  const base = {
    ipoId: row.ipo_id,
    tableName: row.table_name,
    fieldName: row.field_name,
    expectedVersion: version.version,
    actor,
    entryPoint: RELAUNCH_REAPPLY_ENTRY_POINT,
    detail,
    overrideReason: 'Re-applied after a relaunch cleared it (OD-120); the value passed its check when first saved',
  };
  if (d.adminEmpty === true) {
    const reason = typeof d.emptyReason === 'string' && d.emptyReason ? d.emptyReason : 'kept empty';
    return {
      ok: true,
      input: { ...base, empty: { reason: `Re-applied after relaunch (OD-120): ${reason}` }, mode: { kind: 'typed', sourceNote: 'Re-applied after relaunch (OD-120)' } },
    };
  }
  const label = typeof prev.sourceLabel === 'string' && prev.sourceLabel ? prev.sourceLabel : null;
  const note = typeof prev.sourceNote === 'string' && prev.sourceNote ? prev.sourceNote : null;
  return {
    ok: true,
    input: {
      ...base,
      value: row.old_value,
      mode: label
        ? { kind: 'storedPick', sourceLabel: label, readDate: typeof prev.readDate === 'string' ? prev.readDate : null, value: row.old_value }
        : { kind: 'typed', sourceNote: `Re-applied after relaunch (OD-120)${note ? `: ${note}` : ''}` },
    },
  };
}
