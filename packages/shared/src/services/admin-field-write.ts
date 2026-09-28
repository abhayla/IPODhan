/**
 * The ONE admin field write (spec §9.2 items 3, 11, 12, 19, 20; §2.7; OD-108, OD-121).
 *
 * Every admin entry point (the field editor, the conflicts queue, the OD-90 corrigendum accept, the
 * dynamic table editor) writes a field value through `writeAdminFieldValue`. In ONE transaction it:
 *   1. locks the `ipos` row (FOR NO KEY UPDATE) — the same lock the scraper's protected update takes
 *      (IPORepository.update with `honourProtection`), so an admin save and a scraper write on the
 *      same IPO serialise instead of interleaving (item 19);
 *   2. re-reads the field's version token and refuses with CONFLICT when it differs from the token
 *      the editor opened with (item 20);
 *   3. checks a typed value (column type, plus the caller's §1 check) and refuses with INVALID unless
 *      an override reason is given (item 12, OD-108);
 *   4. writes the value (ipos or a one-row-per-IPO child table — F-169);
 *   5. records field_sources provenance as source ADMIN with the admin's name (§2.7);
 *   6. upserts field_protection_metadata (F-170);
 *   7. writes the audit_logs row with the previous and new value (F-170).
 * Dropping the cache keys (F-171) and revalidating the page happen AFTER commit, in the web wrapper
 * (`web/lib/admin/admin-field-save.ts`), because a rolled-back write must not drop a valid entry.
 *
 * The version token is `<field_sources.updated_at as text>|<id of the latest audit row for the
 * field>`. The audit id changes on every admin save, so a change-and-change-back by another admin is
 * still detected; the provenance timestamp changes on every scraper write that records provenance.
 * Neither depends on the value, and no migration is needed.
 */
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import {
  anchorInvestors,
  auditLogs,
  fieldProtectionMetadata,
  fieldSources,
  financialData,
  ipoDetails,
  ipoFinancials,
  ipoScores,
  listingPerformance,
} from '../db/schema';
import { IPORepository } from '../repositories/ipo-repository';

type Db = NodePgDatabase<typeof schema>;

/** The table an admin value lands in, keyed by its SQL name. `ipos` itself is written through IPORepository. */
const CHILD_TABLES: Record<string, PgTable & { ipoId: unknown }> = {
  ipo_details: ipoDetails as never,
  financial_data: financialData as never,
  listing_performance: listingPerformance as never,
  ipo_financials: ipoFinancials as never,
  ipo_scores: ipoScores as never,
  anchor_investors: anchorInvestors as never,
};

export const ADMIN_WRITABLE_TABLES = ['ipos', ...Object.keys(CHILD_TABLES)] as const;

/** Bookkeeping columns no admin value may replace (keys, timestamps, the dedicated lock flag, the slug). */
const NON_EDITABLE_FIELDS = new Set([
  'id',
  'ipoId',
  'slug',
  'createdAt',
  'updatedAt',
  'scraperLocked',
  'lastManualEditAt',
]);

export const ADMIN_FIELD_AUDIT_ACTION = 'Field Updated';

export interface AdminActor {
  name: string;
  adminId: string | null;
}

export type AdminWriteMode =
  | { kind: 'pick'; sourceLabel: string; readDate: string | null }
  | { kind: 'typed'; sourceNote: string };

export interface AdminFieldWriteInput {
  ipoId: string;
  tableName: string;
  fieldName: string;
  /** The new value. Ignored when `empty` is set. */
  value?: unknown;
  /** OD-121: the admin deletes the value; the field stays empty and holds like any admin value. */
  empty?: { reason: string };
  mode: AdminWriteMode;
  /** OD-108: a typed value that fails the check may still be saved with a written reason. */
  overrideReason?: string;
  /** The token the editor opened with (`readAdminFieldVersion`). */
  expectedVersion: string;
  actor: AdminActor;
  /** Which entry point called (audit detail only). */
  entryPoint: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The field's §1 check for a typed value. Returns null when the value passes, else the reason. */
export type TypedValueCheck = (args: {
  tableName: string;
  fieldName: string;
  value: unknown;
}) => string | null;

export type AdminFieldWriteResult =
  | {
      kind: 'OK';
      ipoId: string;
      slug: string;
      tableName: string;
      fieldName: string;
      oldValue: unknown;
      newValue: unknown;
      version: string;
    }
  | { kind: 'INVALID'; reason: string }
  | { kind: 'NOT_FOUND'; reason: string }
  | { kind: 'CONFLICT'; currentValue: unknown; setBy: string | null; setAt: string | null; currentVersion: string };

export interface AdminFieldVersion {
  version: string;
  currentValue: unknown;
  setBy: string | null;
  setAt: string | null;
}

class Refusal extends Error {
  constructor(public readonly result: AdminFieldWriteResult) {
    super(result.kind);
  }
}

function columnsOf(tableName: string): Record<string, { columnType: string; name: string }> | null {
  if (tableName === 'ipos') return getTableColumns(schema.ipos) as never;
  const t = CHILD_TABLES[tableName];
  return t ? (getTableColumns(t) as never) : null;
}

/**
 * Coerce a typed value to what the column's drizzle mapper takes, or return a refusal reason.
 * `timestamp()` columns take a Date object (ist-timezone.md); date/numeric columns take strings.
 */
export function coerceForColumn(columnType: string, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (value === null) return { ok: true, value: null };
  switch (columnType) {
    case 'PgInteger':
    case 'PgSmallInt':
    case 'PgBigInt53': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, reason: `expected a whole number, got ${JSON.stringify(value)}` };
    }
    case 'PgNumeric':
    case 'PgDoublePrecision':
    case 'PgReal': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      if (!Number.isFinite(n)) return { ok: false, reason: `expected a number, got ${JSON.stringify(value)}` };
      return { ok: true, value: columnType === 'PgNumeric' ? String(n) : n };
    }
    case 'PgBoolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, reason: `expected true or false, got ${JSON.stringify(value)}` };
    case 'PgTimestamp': {
      const d = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : new Date(NaN);
      return Number.isNaN(d.getTime()) ? { ok: false, reason: `expected a date-time, got ${JSON.stringify(value)}` } : { ok: true, value: d };
    }
    case 'PgDateString':
    case 'PgDate': {
      const s = typeof value === 'string' ? value : value instanceof Date ? value.toISOString().slice(0, 10) : '';
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())
        ? { ok: true, value: s }
        : { ok: false, reason: `expected a date YYYY-MM-DD, got ${JSON.stringify(value)}` };
    }
    default:
      return { ok: true, value };
  }
}

function stringify(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

async function readVersion(tx: Db, ipoId: string, tableName: string, fieldName: string): Promise<{ version: string; setBy: string | null; setAt: string | null }> {
  const prov = await tx
    .select({
      updatedAt: sql<string>`${fieldSources.updatedAt}::text`,
      updatedBy: fieldSources.updatedBy,
      source: fieldSources.source,
    })
    .from(fieldSources)
    .where(
      and(
        eq(fieldSources.ipoId, ipoId),
        eq(fieldSources.tableName, tableName),
        eq(fieldSources.rowKey, ''),
        eq(fieldSources.fieldName, fieldName)
      )
    )
    .limit(1);
  const audit = await tx
    .select({ id: auditLogs.id, adminUser: auditLogs.adminUser, at: sql<string>`${auditLogs.timestamp}::text` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.ipoId, ipoId),
        eq(auditLogs.tableName, tableName),
        eq(auditLogs.fieldName, fieldName),
        eq(auditLogs.success, true)
      )
    )
    .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
    .limit(1);
  const p = prov[0];
  const a = audit[0];
  return {
    version: `${p?.updatedAt ?? '-'}|${a?.id ?? '-'}`,
    setBy: p ? (p.source === 'ADMIN' ? p.updatedBy ?? a?.adminUser ?? 'admin' : p.source) : a?.adminUser ?? null,
    setAt: p?.updatedAt ?? a?.at ?? null,
  };
}

async function readCurrentValue(tx: Db, ipoId: string, tableName: string, fieldName: string): Promise<unknown> {
  if (tableName === 'ipos') {
    const cols = getTableColumns(schema.ipos) as unknown as Record<string, never>;
    const rows = (await tx.select({ v: cols[fieldName] }).from(schema.ipos).where(eq(schema.ipos.id, ipoId)).limit(1)) as Array<{ v: unknown }>;
    return rows[0]?.v ?? null;
  }
  const t = CHILD_TABLES[tableName];
  const cols = getTableColumns(t) as unknown as Record<string, never>;
  const rows = (await tx.select({ v: cols[fieldName] }).from(t as never).where(eq(cols.ipoId, ipoId)).limit(1)) as Array<{ v: unknown }>;
  return rows[0]?.v ?? null;
}

/** What the editor opens with: the field's current value and its version token. */
export async function readAdminFieldVersion(db: Db, ipoId: string, tableName: string, fieldName: string): Promise<AdminFieldVersion | null> {
  const cols = columnsOf(tableName);
  if (!cols || !cols[fieldName]) return null;
  const v = await readVersion(db, ipoId, tableName, fieldName);
  return { ...v, currentValue: await readCurrentValue(db, ipoId, tableName, fieldName) };
}

/** Postgres data exceptions (class 22) and integrity violations (class 23) are a bad value, not a server fault (#1159). */
function badValueReason(error: unknown): string | null {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  const code = typeof e?.code === 'string' ? e.code : typeof e?.cause?.code === 'string' ? e.cause.code : null;
  if (code && (code.startsWith('22') || code.startsWith('23'))) {
    const msg = typeof e?.cause?.message === 'string' ? e.cause.message : typeof e?.message === 'string' ? e.message : code;
    return `the database refused the value (${code}): ${msg}`;
  }
  return null;
}

export async function writeAdminFieldValue(
  db: Db,
  input: AdminFieldWriteInput,
  checkTypedValue?: TypedValueCheck
): Promise<AdminFieldWriteResult> {
  const { ipoId, tableName, fieldName, actor, mode } = input;

  const cols = columnsOf(tableName);
  if (!cols) return { kind: 'INVALID', reason: `table ${tableName} is not admin-writable (allowed: ${ADMIN_WRITABLE_TABLES.join(', ')})` };
  const column = cols[fieldName];
  if (!column) return { kind: 'INVALID', reason: `${tableName} has no field ${fieldName}` };
  if (NON_EDITABLE_FIELDS.has(fieldName)) return { kind: 'INVALID', reason: `${tableName}.${fieldName} is not editable` };
  if (!actor?.name?.trim()) return { kind: 'INVALID', reason: 'the admin name is required' };
  if (typeof input.expectedVersion !== 'string' || input.expectedVersion === '') {
    return { kind: 'INVALID', reason: 'expectedVersion is required: read it with GET /api/admin/update-field before saving' };
  }
  if (mode.kind === 'typed' && !mode.sourceNote?.trim() && !input.empty) {
    return { kind: 'INVALID', reason: 'a typed value needs a short source note (document and page, or a URL) — OD-108' };
  }
  if (mode.kind === 'pick' && !mode.sourceLabel?.trim()) {
    return { kind: 'INVALID', reason: 'a picked value needs the source label it was picked from' };
  }
  if (input.empty && !input.empty.reason?.trim()) {
    return { kind: 'INVALID', reason: 'deleting a value needs a reason — OD-121' };
  }

  let newValue: unknown = null;
  let checkFailure: string | null = null;
  if (!input.empty) {
    const coerced = coerceForColumn(column.columnType, input.value ?? null);
    if (coerced.ok === false) return { kind: 'INVALID', reason: `${tableName}.${fieldName}: ${coerced.reason}` };
    newValue = coerced.value;
    if (mode.kind === 'typed' && checkTypedValue) {
      checkFailure = checkTypedValue({ tableName, fieldName, value: newValue });
      if (checkFailure && !input.overrideReason?.trim()) {
        return { kind: 'INVALID', reason: `${tableName}.${fieldName} fails its check: ${checkFailure}. Save again with a written reason to keep it.` };
      }
    }
  }

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const locked = await tx.execute(sql`SELECT slug FROM ipos WHERE id = ${ipoId}::uuid FOR NO KEY UPDATE`);
      const slug = (locked.rows[0] as { slug?: string } | undefined)?.slug;
      if (!slug) throw new Refusal({ kind: 'NOT_FOUND', reason: `IPO ${ipoId} not found` });

      const current = await readVersion(tx, ipoId, tableName, fieldName);
      const oldValue = await readCurrentValue(tx, ipoId, tableName, fieldName);
      if (current.version !== input.expectedVersion) {
        throw new Refusal({ kind: 'CONFLICT', currentValue: oldValue, setBy: current.setBy, setAt: current.setAt, currentVersion: current.version });
      }

      const now = new Date();
      if (tableName === 'ipos') {
        await IPORepository.applyAdminCorrigendumValue(tx, ipoId, fieldName, newValue);
      } else {
        const t = CHILD_TABLES[tableName];
        const tcols = getTableColumns(t) as unknown as Record<string, never>;
        const setPatch: Record<string, unknown> = { [fieldName]: newValue };
        if ('updatedAt' in tcols) setPatch.updatedAt = now;
        const updated = await tx.update(t).set(setPatch as never).where(eq(tcols.ipoId, ipoId)).returning();
        if (updated.length === 0) {
          // No child row yet: create it. `data_source` is NOT NULL on the child tables that carry it.
          const values: Record<string, unknown> = { ipoId, [fieldName]: newValue };
          if ('dataSource' in tcols && fieldName !== 'dataSource') values.dataSource = 'MANUAL';
          await tx.insert(t).values(values as never);
        }
      }

      const lineage = {
        method: 'ADMIN_FIELD_WRITE',
        entryPoint: input.entryPoint,
        mode: mode.kind,
        ...(mode.kind === 'pick' ? { sourceLabel: mode.sourceLabel, readDate: mode.readDate } : { sourceNote: mode.sourceNote }),
        ...(input.empty ? { adminEmpty: true, emptyReason: input.empty.reason } : {}),
        by: actor.name,
        adminId: actor.adminId,
      };
      const prevSourceRow = await tx
        .select({ source: fieldSources.source })
        .from(fieldSources)
        .where(and(eq(fieldSources.ipoId, ipoId), eq(fieldSources.tableName, tableName), eq(fieldSources.rowKey, ''), eq(fieldSources.fieldName, fieldName)))
        .limit(1);
      const previousSource = prevSourceRow[0]?.source ?? null;
      await tx
        .insert(fieldSources)
        .values({
          ipoId,
          tableName,
          rowKey: '',
          fieldName,
          source: 'ADMIN',
          confidence: 100,
          previousValue: stringify(oldValue),
          previousSource,
          dataLineage: lineage,
          updatedBy: actor.name,
          updatedAt: now,
          createdAt: now,
        } as never)
        .onConflictDoUpdate({
          target: [fieldSources.ipoId, fieldSources.tableName, fieldSources.rowKey, fieldSources.fieldName],
          set: {
            source: 'ADMIN',
            confidence: 100,
            previousValue: stringify(oldValue),
            previousSource,
            dataLineage: sql`COALESCE(${fieldSources.dataLineage}, '{}'::jsonb) || ${JSON.stringify(lineage)}::jsonb`,
            updatedBy: actor.name,
            updatedAt: now,
          } as never,
        });

      const editNote = input.empty
        ? `Deleted: ${input.empty.reason}`
        : mode.kind === 'typed'
          ? `Typed: ${mode.sourceNote}`
          : `Picked from ${mode.sourceLabel}${mode.readDate ? `, read ${mode.readDate}` : ''}`;
      await tx
        .insert(fieldProtectionMetadata)
        .values({
          ipoId,
          tableName,
          fieldName,
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

      await tx.insert(auditLogs).values({
        timestamp: now,
        adminUser: actor.name,
        actionType: ADMIN_FIELD_AUDIT_ACTION,
        ipoId,
        tableName,
        fieldName,
        oldValue: stringify(oldValue),
        newValue: stringify(newValue),
        details: {
          ...lineage,
          overrideReason: input.overrideReason ?? null,
          checkFailure,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: true,
        createdAt: now,
      });

      const after = await readVersion(tx, ipoId, tableName, fieldName);
      return { kind: 'OK' as const, ipoId, slug, tableName, fieldName, oldValue, newValue, version: after.version };
    });
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    const reason = badValueReason(error);
    if (reason) return { kind: 'INVALID', reason: `${tableName}.${fieldName}: ${reason}` };
    throw error;
  }
}
