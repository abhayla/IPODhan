/**
 * The ONE admin LIST write (spec §9.2 items 8, 11, 28(b); OD-107, OD-121; F-174).
 *
 * `writeAdminFieldValue` (admin-field-write.ts) writes one field of one row. A list edit adds, edits
 * or removes whole rows, and after it the WHOLE list is admin-owned (OD-107). In ONE transaction:
 *   1. lock the IPO's `ipos` row FOR NO KEY UPDATE — the lock every list writer takes before it
 *      reads the hold (admin-list-hold.ts), so an admin save and a writer never interleave (item 19);
 *   2. read the current list, apply the change (a remove needs a short reason, item 28(b));
 *   3. write the list (the `ipos.lead_managers` array, the child table's rows, or the anchor row's
 *      `investor_list`);
 *   4. upsert the list's hold in `field_protection_metadata` (removing every row leaves the list
 *      admin-EMPTY, which holds like any admin value, OD-121);
 *   5. write the `audit_logs` row with the list before and after, the op, the row and the reason.
 * Lead managers also get the `field_sources` ADMIN provenance row, as any `ipos` field does (§2.7).
 * Cache keys are dropped AFTER commit by the web wrapper, as for a field save (F-171).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import {
  anchorInvestors,
  auditLogs,
  fieldProtectionMetadata,
  fieldSources,
  financialStatements,
  ipoIntermediaries,
  ipoRiskFactors,
  ipos,
  peerCompanies,
  promoters,
} from '../db/schema';
import { rowKeyForName } from '../utils/company-name-normalizer';
import { headingHashForRiskFactor } from '../utils/risk-factor-heading-key';
import { ADMIN_LIST_SPECS, lockAndReadListOwnership, type AdminListName } from './admin-list-hold';
import type { AdminActor } from './admin-field-write';

export { ADMIN_LIST_SUGGESTION_REASON, ADMIN_LISTS, listRowKey, type AdminListName } from './admin-list-hold';

type Db = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;

export const ADMIN_LIST_AUDIT_ACTION = 'List Updated';

/** A removal reason shorter than this is refused (item 28(b): "takes a short reason"). */
const MIN_REASON = 3;

export type AdminListOp =
  | { kind: 'add'; row: Row }
  | { kind: 'edit'; rowKey: string; row: Row }
  | { kind: 'remove'; rowKeys: string[]; reason: string };

export interface AdminListChangeInput {
  ipoId: string;
  list: AdminListName;
  op: AdminListOp;
  actor: AdminActor;
  entryPoint: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AdminListChangeResult =
  | { kind: 'OK'; ipoId: string; slug: string; list: AdminListName; before: string[]; after: string[] }
  | { kind: 'INVALID'; reason: string }
  | { kind: 'NOT_FOUND'; reason: string };

/** Child tables whose rows ARE the list (one row per list entry). */
const ROW_TABLES: Partial<Record<AdminListName, PgTable & { ipoId: unknown }>> = {
  promoters: promoters as never,
  peer_companies: peerCompanies as never,
  ipo_intermediaries: ipoIntermediaries as never,
  financial_statements: financialStatements as never,
  ipo_risk_factors: ipoRiskFactors as never,
};

/** Columns an admin row never sets (identity, owner, bookkeeping) — the server derives them. */
const NEVER_SET = new Set(['id', 'ipoId', 'createdAt', 'updatedAt', 'lastUpdated']);

/** Fill the derived row-key column the writers fill, so an admin row keys the same way (R-158). */
function withDerivedKey(list: AdminListName, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!NEVER_SET.has(k)) out[k] = v;
  if (list === 'promoters' || list === 'ipo_intermediaries') out.normalizedName = rowKeyForName(String(out.name ?? '')) ?? '';
  if (list === 'peer_companies') out.normalizedName = rowKeyForName(String(out.companyName ?? '')) ?? '';
  if (list === 'ipo_risk_factors') out.headingHash = headingHashForRiskFactor(String(out.heading ?? '')) ?? '';
  return out;
}

class Refusal extends Error {
  constructor(readonly result: AdminListChangeResult) {
    super('refused');
  }
}

/** Pure: the list after the op, or a refusal reason. Rows are matched by the list's row key. */
export function applyListOp(list: AdminListName, current: readonly Row[], op: AdminListOp): { rows: Row[] } | { invalid: string } {
  const spec = ADMIN_LIST_SPECS[list];
  const keyOf = (r: Row) => spec.key(r);
  if (op.kind === 'add') {
    const row = list === 'lead_managers' || list === 'anchor_investors' ? { ...op.row } : withDerivedKey(list, op.row);
    if (spec.label(row).trim() === '' || spec.label(row).trim() === 'FY ') return { invalid: `${list}: a new row needs its name` };
    if (current.some((r) => keyOf(r) === keyOf(row))) return { invalid: `${list}: "${spec.label(row)}" is already in the list` };
    return { rows: [...current, row] };
  }
  if (op.kind === 'edit') {
    const i = current.findIndex((r) => keyOf(r) === op.rowKey);
    if (i < 0) return { invalid: `${list}: no row with key "${op.rowKey}"` };
    const merged = list === 'lead_managers' || list === 'anchor_investors' ? { ...current[i], ...op.row } : withDerivedKey(list, { ...current[i], ...op.row });
    if (current.some((r, j) => j !== i && keyOf(r) === keyOf(merged))) return { invalid: `${list}: "${spec.label(merged)}" is already in the list` };
    const rows = [...current];
    rows[i] = merged;
    return { rows };
  }
  if (op.reason.trim().length < MIN_REASON) return { invalid: `${list}: removing rows needs a short reason (spec §9.2 item 28(b))` };
  const drop = new Set(op.rowKeys);
  const missing = op.rowKeys.filter((k) => !current.some((r) => keyOf(r) === k));
  if (missing.length > 0) return { invalid: `${list}: no row with key ${missing.map((m) => `"${m}"`).join(', ')}` };
  return { rows: current.filter((r) => !drop.has(keyOf(r))) };
}

async function readList(tx: Db, ipoId: string, list: AdminListName): Promise<Row[]> {
  if (list === 'lead_managers') {
    const [r] = await tx.select({ lm: ipos.leadManagers }).from(ipos).where(eq(ipos.id, ipoId));
    return (Array.isArray(r?.lm) ? r.lm : []).map((name) => ({ name }));
  }
  if (list === 'anchor_investors') {
    const [r] = await tx.select({ l: anchorInvestors.investorList }).from(anchorInvestors).where(eq(anchorInvestors.ipoId, ipoId)).limit(1);
    return ((r?.l ?? []) as unknown as Row[]).map((x) => ({ ...x }));
  }
  const t = ROW_TABLES[list]!;
  return (await tx.select().from(t).where(eq(t.ipoId as never, ipoId))) as Row[];
}

async function writeList(tx: Db, ipoId: string, list: AdminListName, before: readonly Row[], after: readonly Row[], now: Date): Promise<void> {
  if (list === 'lead_managers') {
    await tx.update(ipos).set({ leadManagers: after.map((r) => String(r.name)), updatedAt: now }).where(eq(ipos.id, ipoId));
    return;
  }
  if (list === 'anchor_investors') {
    const updated = await tx
      .update(anchorInvestors)
      .set({ investorList: after as never, anchorInvestorsCount: after.length, updatedAt: now })
      .where(eq(anchorInvestors.ipoId, ipoId))
      .returning({ id: anchorInvestors.id });
    if (updated.length === 0) throw new Refusal({ kind: 'INVALID', reason: 'anchor_investors: this IPO has no anchor allocation row yet; its totals and bid date come from the exchange' });
    return;
  }
  // Child table: delete the rows no longer in the list, update the kept ones, insert the new ones.
  const t = ROW_TABLES[list]! as PgTable & { ipoId: unknown; id: unknown };
  const afterIds = new Set(after.map((r) => r.id).filter((id): id is string => typeof id === 'string'));
  const gone = before.map((r) => r.id as string).filter((id) => !afterIds.has(id));
  if (gone.length > 0) await tx.delete(t).where(and(eq(t.ipoId as never, ipoId), inArray(t.id as never, gone)));
  for (const r of after) {
    const values: Row = {};
    for (const [k, v] of Object.entries(r)) if (!NEVER_SET.has(k)) values[k] = v;
    if (typeof r.id === 'string') {
      await tx.update(t).set({ ...values, updatedAt: now } as never).where(eq(t.id as never, r.id));
    } else {
      await tx.insert(t).values({ ...values, ipoId } as never);
    }
  }
}

export async function writeAdminListChange(db: Db, input: AdminListChangeInput): Promise<AdminListChangeResult> {
  const { ipoId, list, op, actor } = input;
  if (!(list in ADMIN_LIST_SPECS)) return { kind: 'INVALID', reason: `unknown list "${list}"` };
  if (!actor?.adminId || !actor?.name) return { kind: 'INVALID', reason: 'an admin list write needs the admin (OD-104)' };
  const spec = ADMIN_LIST_SPECS[list];
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const { exists } = await lockAndReadListOwnership(tx as never, ipoId, list);
      if (!exists) throw new Refusal({ kind: 'NOT_FOUND', reason: `IPO ${ipoId} does not exist` });
      const [{ slug }] = await tx.select({ slug: ipos.slug }).from(ipos).where(eq(ipos.id, ipoId));
      const before = await readList(tx, ipoId, list);
      const next = applyListOp(list, before, op);
      if ('invalid' in next) throw new Refusal({ kind: 'INVALID', reason: next.invalid });
      const now = new Date();
      await writeList(tx, ipoId, list, before, next.rows, now);

      const labels = (rows: readonly Row[]) => rows.map((r) => spec.label(r));
      const editNote =
        op.kind === 'remove'
          ? `List rows removed: ${op.reason.trim()}`
          : op.kind === 'add'
            ? `List row added: ${spec.label(next.rows[next.rows.length - 1])}`
            : `List row edited: ${op.rowKey}`;
      await tx
        .insert(fieldProtectionMetadata)
        .values({
          ipoId,
          tableName: spec.holdTable,
          fieldName: spec.holdField,
          isProtected: true,
          autoProtected: true,
          manuallyEditedAt: now,
          manuallyEditedBy: actor.name,
          editNote,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [fieldProtectionMetadata.tableName, fieldProtectionMetadata.fieldName, fieldProtectionMetadata.ipoId],
          set: { isProtected: true, autoProtected: true, manuallyEditedAt: now, manuallyEditedBy: actor.name, editNote, updatedAt: now },
        });

      if (list === 'lead_managers') {
        const lineage = { method: 'ADMIN_LIST', entryPoint: input.entryPoint, by: actor.name, adminId: actor.adminId };
        const previousValue = JSON.stringify(before.map((r) => String(r.name)));
        await tx
          .insert(fieldSources)
          .values({ ipoId, tableName: 'ipos', rowKey: '', fieldName: 'leadManagers', source: 'ADMIN', dataLineage: lineage, previousValue, updatedBy: actor.name, updatedAt: now } as never)
          .onConflictDoUpdate({
            target: [fieldSources.ipoId, fieldSources.tableName, fieldSources.rowKey, fieldSources.fieldName],
            set: { source: 'ADMIN', dataLineage: lineage, previousValue, updatedBy: actor.name, updatedAt: now } as never,
          });
      }

      await tx.insert(auditLogs).values({
        timestamp: now,
        adminUser: actor.name,
        actionType: ADMIN_LIST_AUDIT_ACTION,
        ipoId,
        tableName: spec.holdTable,
        fieldName: spec.holdField,
        oldValue: JSON.stringify(labels(before)),
        newValue: JSON.stringify(labels(next.rows)),
        details: {
          list,
          op: op.kind,
          rowKeys: op.kind === 'remove' ? op.rowKeys : op.kind === 'edit' ? [op.rowKey] : [spec.key(next.rows[next.rows.length - 1])],
          reason: op.kind === 'remove' ? op.reason.trim() : null,
          entryPoint: input.entryPoint,
          adminId: actor.adminId,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: true,
        createdAt: now,
      });
      return { kind: 'OK' as const, ipoId, slug, list, before: labels(before), after: labels(next.rows) };
    });
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    throw error;
  }
}

/** Read one list for the editor (labels + row keys), outside any write. */
export async function readAdminList(db: Db, ipoId: string, list: AdminListName): Promise<{ owned: boolean; rows: Array<{ key: string; label: string; row: Row }> }> {
  const spec = ADMIN_LIST_SPECS[list];
  const rows = await readList(db, ipoId, list);
  const prot = await db
    .select({ p: fieldProtectionMetadata.isProtected })
    .from(fieldProtectionMetadata)
    .where(and(eq(fieldProtectionMetadata.ipoId, ipoId), eq(fieldProtectionMetadata.tableName, spec.holdTable), eq(fieldProtectionMetadata.fieldName, spec.holdField)));
  return { owned: prot.some((p) => p.p === true), rows: rows.map((row) => ({ key: spec.key(row), label: spec.label(row), row })) };
}

