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
import { isHiddenIpo, IPO_HIDDEN_ADMIN_REASON } from './scraper-write-block';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import { readDatabaseNow } from '../db/database-clock';
import {
  auditLogs,
  documents,
  fieldProtectionMetadata,
  fieldSources,
  financialData,
  ipoDetails,
  ipoFinancials,
  ipoScores,
  listingPerformance,
  peerCompanies,
} from '../db/schema';
import { IPORepository } from '../repositories/ipo-repository';
import { validateIPOData } from '../utils/ipo-field-checks';
import { rowKeyForName } from '../utils/company-name-normalizer';
import { protectionTableName } from './field-hold';
import { isIdentifierAliasField, keepReplacedIdentifier, type IdentifierMove } from './admin-identifier-alias';
import { upsertListHold } from './admin-list-hold';
import { clearSourceNoLongerFirstOnAdminSave } from './source-no-longer-first';
import { closeSuggestionsAcceptedByAdminSave } from './suggestion-admin-save-close';
import { recomputeListSuggestionsAfterRowEdit } from './admin-list-write';
import { isPlanInvalidatingField, normalizeListingExchanges, rebuildIpoPlanInTx, type PlanManifest, type PlanRebuildSummary } from './plan-invalidating-rebuild';
import {
  EXCHANGE_OVERRIDE_SOURCES,
  baselineEvidenceFromWitnesses,
  baselineForAdminSave,
  isExchangeOverrideField,
  normalizeExchangeValue,
  resolveExchangeBaseline,
  type BaselineEvidence,
  type ExchangeBaselineOrigin,
  type ExchangeOverrideSource,
} from './exchange-override-rule';

type Db = NodePgDatabase<typeof schema>;

/**
 * The ONE-ROW-PER-IPO child tables an admin value lands in, keyed by SQL name. `ipos` itself is
 * written through IPORepository. anchor_investors is NOT here: it is a LIST (§9.2 item 8, OD-107,
 * Phase B), and a one-row write would edit whichever anchor row came first.
 */
const CHILD_TABLES: Record<string, PgTable & { ipoId: unknown }> = {
  ipo_details: ipoDetails as never,
  financial_data: financialData as never,
  listing_performance: listingPerformance as never,
  ipo_financials: ipoFinancials as never,
  ipo_scores: ipoScores as never,
};

export const ADMIN_WRITABLE_TABLES = ['ipos', ...Object.keys(CHILD_TABLES)] as const;

/**
 * Tables with several rows per IPO whose single fields an admin may edit, row by row. Each row is
 * addressed by its natural row key — the SAME key `field_sources.row_key` records for it — so a
 * provenance row, a hold and an audit row all name the same row even after the scraper re-inserts
 * it under a new id (peer_companies' writer deletes and re-inserts the list).
 *   peer_companies: row key = normalized_name; editing company_name re-derives it (R-158).
 *   documents:      row key = the document id (a document row is never re-inserted).
 */
interface RowTableSpec {
  table: PgTable & { ipoId: unknown };
  keyField: string;
  derived?: { sourceField: string; derivedField: string; derive: (value: unknown) => string | null };
}
const ROW_TABLES: Record<string, RowTableSpec> = {
  peer_companies: {
    table: peerCompanies as never,
    keyField: 'normalizedName',
    derived: {
      sourceField: 'companyName',
      derivedField: 'normalizedName',
      derive: (v) => rowKeyForName(typeof v === 'string' ? v : String(v ?? '')),
    },
  },
  documents: { table: documents as never, keyField: 'id' },
};

export const ADMIN_ROW_TABLES = Object.keys(ROW_TABLES) as readonly string[];

/** The column a row table's row key is derived into (R-158), or null when the key is not derived. */
export function rowTableDerivedKey(tableName: string): { sourceField: string; derivedField: string } | null {
  const d = ROW_TABLES[tableName]?.derived;
  return d ? { sourceField: d.sourceField, derivedField: d.derivedField } : null;
}

// `protectionTableName` lives in field-hold.ts (no schema import), so a reader of holds -- the
// field-plan walk's protection gate -- can use the one definition without loading this module.
export { protectionTableName };

/** Bookkeeping columns no admin value may replace (keys, timestamps, the dedicated lock flag, the slug). */
/**
 * #1159 item 2: admin-editable columns whose value set is closed and enforced by a DB CHECK. A value
 * outside the set is refused as INVALID (400) before the transaction, never left to the CHECK (a 500).
 * Keyed `<table>.<field>`; each set is the schema's own declaration, never a copy.
 */
const CLOSED_VALUE_SETS: Readonly<Record<string, readonly string[]>> = {
  'documents.extractionStatus': schema.DOCUMENT_EXTRACTION_STATUSES,
};

const NON_EDITABLE_FIELDS = new Set([
  'id',
  'ipoId',
  'slug',
  'createdAt',
  'updatedAt',
  'scraperLocked',
  'lastManualEditAt',
]);

/**
 * Release 1 (OD-135 scope): `ipos` fields whose edit needs a Phase B mechanism are refused, not
 * written half-way. Identifier edits (cin, isin, symbol) left this list with item 26: they are
 * written and keep the old value as an alias binding still matches (§9.2 item 26,
 * `keepReplacedIdentifier`). The type/segment/venue fields left this list with item 18: their save
 * rebuilds the plan's source ranks in the same transaction (`plan-invalidating-rebuild.ts`, §2.8;
 * without that rebuild, an edit would leave stale ranks). No field currently awaits Phase B.
 */
export const IPO_FIELDS_AWAITING_PHASE_B: Readonly<Record<string, string>> = {};

/**
 * The lineage keys an admin write owned before `adminKeys` was recorded on each write. An ADMIN row
 * written earlier has no `adminKeys`; these are stripped from it on the next admin save instead.
 */
const LEGACY_ADMIN_LINEAGE_KEYS = [
  'method', 'entryPoint', 'mode', 'heldShownValue', 'sourceLabel', 'readDate', 'sourceNote',
  'adminEmpty', 'emptyReason', 'recordId', 'by', 'adminId',
];

export const ADMIN_FIELD_AUDIT_ACTION = 'Field Updated';

/**
 * §9.2 item 8 (OD-107): lead managers are a LIST; rows are added, edited and removed through the one
 * list write (`writeAdminListChange`), never saved as one field value.
 */
export const LIST_FIELD_REFUSAL =
  'ipos.leadManagers is a list: add, edit or remove its rows in the list editor (spec §9.2 item 8, OD-107), not as one field value';

/** §9.2 item 20: a save without the token the editor opened with is refused, never filled in server-side. */
export const STALE_EDITOR_REASON = 'stale editor, reload: the save carries no version token (expectedVersion); reopen the field and save again';

export interface AdminActor {
  name: string;
  /** OD-104/OD-113: the admin's account id. Required — a write nobody can be traced to is refused. */
  adminId: string;
}

export type AdminWriteMode =
  /**
   * §9.2 items 2, 3; §9.3; OD-109: the admin picks ONE source's stored answer. The client names only
   * the source; the value and its read date are loaded INSIDE the transaction from that source's
   * stored answer (field_sources.witnesses, OD-103; else ipo_field_plan.answers for a field with no
   * stored value, OD-137; else the stored value when that source supplied it). `input.value` is
   * ignored, so a forged value can never be stored as "From <source>". No stored answer -> INVALID.
   */
  | { kind: 'pick'; sourceLabel: string }
  /**
   * A pick whose value a SERVER caller has already read from its own stored row (the OD-90
   * corrigendum suggestion's document value, a data_conflicts row's value). Never built from a
   * request body.
   */
  | { kind: 'storedPick'; sourceLabel: string; readDate: string | null; value: unknown }
  | { kind: 'typed'; sourceNote: string }
  /**
   * OD-121, §9.2 item 11: "protect this field" with no value. It is an admin PICK of the value the
   * editor showed, from the source that supplied it, read inside the transaction; the version token
   * proves it is still the value the admin saw. A field showing nothing cannot be held this way.
   */
  | { kind: 'holdShown' };

export interface AdminFieldWriteInput {
  ipoId: string;
  tableName: string;
  /**
   * The row of a several-rows-per-IPO table (`ADMIN_ROW_TABLES`): its natural row key (as
   * field_sources/data_conflicts record it) or its record id. Refused on a one-row table.
   */
  row?: { rowKey?: string; recordId?: string };
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
  /** Extra provenance for the lineage and audit detail (e.g. the corrigendum's documentId, conflictId). */
  detail?: Record<string, unknown>;
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
      /** '' for a one-row table; the row's (possibly re-derived) natural key for a row table. */
      rowKey: string;
      oldValue: unknown;
      newValue: unknown;
      version: string;
      /** §2.8 / §9.2 item 18: set when the save rebuilt the IPO's plan (offering type, segment, venue). */
      planRebuild?: PlanRebuildSummary;
    }
  | { kind: 'INVALID'; reason: string }
  | { kind: 'NOT_FOUND'; reason: string }
  /** OD-150: the IPO is hidden; a hidden row is view-only until unhidden. */
  | { kind: 'HIDDEN'; reason: string }
  | { kind: 'CONFLICT'; currentValue: unknown; setBy: string | null; setAt: string | null; currentVersion: string };

export interface AdminFieldVersion {
  version: string;
  currentValue: unknown;
  setBy: string | null;
  setAt: string | null;
}

/** The mode as recorded: every pick carries the label and read date it was resolved with. */
type ResolvedMode = { kind: 'pick'; sourceLabel: string; readDate: string | null } | { kind: 'typed'; sourceNote: string };

class Refusal extends Error {
  constructor(public readonly result: AdminFieldWriteResult) {
    super(result.kind);
  }
}

function tableOf(tableName: string): PgTable | null {
  if (tableName === 'ipos') return schema.ipos;
  return CHILD_TABLES[tableName] ?? ROW_TABLES[tableName]?.table ?? null;
}

function columnsOf(tableName: string): Record<string, { columnType: string; name: string }> | null {
  const t = tableOf(tableName);
  return t ? (getTableColumns(t) as never) : null;
}

/** The row an admin value addresses: '' for a one-row table, the natural key for a row table. */
interface RowTarget {
  rowKey: string;
  recordId: string | null;
}

/** Resolve a row table's row (by row key or record id) within the IPO, or null when it is not there. */
async function resolveRow(tx: Db, ipoId: string, tableName: string, row: AdminFieldWriteInput['row']): Promise<RowTarget | null> {
  const spec = ROW_TABLES[tableName];
  if (!spec) return { rowKey: '', recordId: null };
  const cols = getTableColumns(spec.table) as unknown as Record<string, never>;
  const where = row?.rowKey
    ? and(eq(cols.ipoId, ipoId), eq(cols[spec.keyField], row.rowKey))
    : and(eq(cols.ipoId, ipoId), eq(cols.id, row?.recordId ?? ''));
  const found = (await tx.select({ id: cols.id, key: cols[spec.keyField] }).from(spec.table as never).where(where).limit(1)) as Array<{
    id: string;
    key: string;
  }>;
  return found[0] ? { rowKey: String(found[0].key), recordId: String(found[0].id) } : null;
}

function rowWhere(tableName: string, ipoId: string, target: RowTarget) {
  const t = tableOf(tableName)!;
  const cols = getTableColumns(t) as unknown as Record<string, never>;
  if (tableName === 'ipos') return eq(cols.id, ipoId);
  const spec = ROW_TABLES[tableName];
  return spec ? and(eq(cols.ipoId, ipoId), eq(cols.id, target.recordId ?? '')) : eq(cols.ipoId, ipoId);
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

/**
 * m4: the target row's own updated_at, for a child/row table that has one, so a scraper rewrite of
 * the row that records no field_sources provenance still changes the token. `ipos` is excluded: its
 * updated_at moves on every scraper cycle for every field, which would make every save a CONFLICT.
 */
async function readRowStamp(tx: Db, ipoId: string, tableName: string, target: RowTarget | null): Promise<string> {
  if (tableName === 'ipos' || !target) return '-';
  const t = tableOf(tableName);
  if (!t) return '-';
  const cols = getTableColumns(t) as unknown as Record<string, never>;
  if (!('updatedAt' in cols)) return '-';
  const rows = (await tx
    .select({ at: sql<string>`${cols.updatedAt}::text` })
    .from(t as never)
    .where(rowWhere(tableName, ipoId, target))
    .limit(1)) as Array<{ at: string | null }>;
  return rows[0]?.at ?? '-';
}

async function readVersion(
  tx: Db,
  ipoId: string,
  tableName: string,
  fieldName: string,
  rowKey = '',
  target: RowTarget | null = null
): Promise<{ version: string; setBy: string | null; setAt: string | null; source: string | null }> {
  const rowStamp = await readRowStamp(tx, ipoId, tableName, target);
  const prov = await tx
    .select({
      updatedAt: sql<string>`${fieldSources.updatedAt}::text`,
      updatedBy: fieldSources.updatedBy,
      source: fieldSources.source,
      // A walk refreshes a held field's witnesses without moving updated_at, so the token carries a
      // short digest of them: a pick made from witnesses the admin never saw is refused as stale.
      witnessDigest: sql<string>`left(md5(coalesce(${fieldSources.witnesses}::text, '')), 12)`,
    })
    .from(fieldSources)
    .where(
      and(
        eq(fieldSources.ipoId, ipoId),
        eq(fieldSources.tableName, tableName),
        eq(fieldSources.rowKey, rowKey),
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
        eq(auditLogs.success, true),
        // audit_logs has no row_key column; a row table's audit rows carry it in details.
        rowKey === '' ? undefined : sql`${auditLogs.details}->>'rowKey' = ${rowKey}`
      )
    )
    .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
    .limit(1);
  const p = prov[0];
  const a = audit[0];
  return {
    version: `${p?.updatedAt ?? '-'}|${a?.id ?? '-'}|${rowStamp}|${p?.witnessDigest ?? '-'}`,
    setBy: p ? (p.source === 'ADMIN' ? p.updatedBy ?? a?.adminUser ?? 'admin' : p.source) : a?.adminUser ?? null,
    setAt: p?.updatedAt ?? a?.at ?? null,
    source: p?.source ?? null,
  };
}

async function readCurrentValue(tx: Db, ipoId: string, tableName: string, fieldName: string, target: RowTarget): Promise<unknown> {
  const t = tableOf(tableName)!;
  const cols = getTableColumns(t) as unknown as Record<string, never>;
  const rows = (await tx.select({ v: cols[fieldName] }).from(t as never).where(rowWhere(tableName, ipoId, target)).limit(1)) as Array<{ v: unknown }>;
  return rows[0]?.v ?? null;
}

/**
 * What the editor opens with: the field's current value and its version token. A row table needs
 * `row` (row key or record id); null when the table, field or row does not exist.
 */
export async function readAdminFieldVersion(
  db: Db,
  ipoId: string,
  tableName: string,
  fieldName: string,
  row?: AdminFieldWriteInput['row']
): Promise<(AdminFieldVersion & { rowKey: string }) | null> {
  const cols = columnsOf(tableName);
  if (!cols || !cols[fieldName]) return null;
  const target = await resolveRow(db, ipoId, tableName, row);
  if (!target) return null;
  const { source: _source, ...v } = await readVersion(db, ipoId, tableName, fieldName, target.rowKey, target);
  return { ...v, rowKey: target.rowKey, currentValue: await readCurrentValue(db, ipoId, tableName, fieldName, target) };
}

interface StoredAnswer {
  source?: unknown;
  value?: unknown;
  at?: unknown;
  outcome?: unknown;
}

const sameSource = (a: unknown, b: string) => typeof a === 'string' && a.trim().toUpperCase() === b.trim().toUpperCase();

/** A witness with no outcome predates OD-103 and was always SUPPLIED (witness-verdict.ts isSuppliedWitness). */
function suppliedAnswerOf(list: unknown, label: string): { value: unknown; readDate: string | null } | null {
  if (!Array.isArray(list)) return null;
  for (const w of list as StoredAnswer[]) {
    if (!w || !sameSource(w.source, label)) continue;
    if (w.outcome !== undefined && w.outcome !== 'SUPPLIED') continue;
    if (w.value === null || w.value === undefined) continue;
    return { value: w.value, readDate: typeof w.at === 'string' ? w.at : null };
  }
  return null;
}

/**
 * §9.3 / OD-103 / OD-137: the named source's stored answer for this field, read inside the write's
 * transaction. Order: the field_sources witnesses; then the stored value itself when that source
 * supplied it (a row written before witnesses existed); then the plan row's answers (a field whose
 * last pass stored no value). Null when the source has no stored answer.
 */
export async function loadStoredSourceAnswer(
  tx: Db,
  args: { ipoId: string; tableName: string; rowKey: string; fieldName: string; sqlFieldName: string; sourceLabel: string; currentValue: unknown }
): Promise<{ value: unknown; readDate: string | null } | null> {
  const [fs] = await tx
    .select({ source: fieldSources.source, witnesses: fieldSources.witnesses, at: sql<string>`${fieldSources.updatedAt}::text` })
    .from(fieldSources)
    .where(
      and(
        eq(fieldSources.ipoId, args.ipoId),
        eq(fieldSources.tableName, args.tableName),
        eq(fieldSources.rowKey, args.rowKey),
        eq(fieldSources.fieldName, args.fieldName)
      )
    )
    .limit(1);
  const fromWitness = suppliedAnswerOf(fs?.witnesses, args.sourceLabel);
  if (fromWitness) return fromWitness;
  if (fs && fs.source !== 'ADMIN' && sameSource(fs.source, args.sourceLabel) && args.currentValue !== null && args.currentValue !== undefined) {
    return { value: args.currentValue, readDate: fs.at ?? null };
  }
  const [plan] = await tx
    .select({ answers: schema.ipoFieldPlan.answers })
    .from(schema.ipoFieldPlan)
    .where(
      and(
        eq(schema.ipoFieldPlan.ipoId, args.ipoId),
        eq(schema.ipoFieldPlan.tableName, args.tableName),
        eq(schema.ipoFieldPlan.rowKey, args.rowKey),
        eq(schema.ipoFieldPlan.fieldName, args.sqlFieldName)
      )
    )
    .limit(1);
  return suppliedAnswerOf(plan?.answers, args.sourceLabel);
}

/**
 * OD-106: what the stored answers say about one exchange for this field, as baseline EVIDENCE
 * (`baselineEvidenceFromWitnesses`): the field_sources witnesses, then the stored value when that
 * exchange wrote it, then a stored explicit "not printed", then the plan row's answers. Unlike
 * `loadStoredSourceAnswer` it keeps a stored NOT_PRINTED as "stated nothing"; NOT_AVAILABLE_YET and
 * no stored answer are unknown (OD-145).
 */
/** A naive `timestamp::text` read on a UTC session (ist-timezone.md) as an ISO instant. */
function utcTextToIso(text: string | null | undefined): string | null {
  if (!text) return null;
  const d = new Date(`${text.trim().replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function loadStoredExchangeEvidence(
  tx: Db,
  args: { ipoId: string; tableName: string; rowKey: string; fieldName: string; sqlFieldName: string; source: ExchangeOverrideSource; currentValue: unknown }
): Promise<BaselineEvidence> {
  const [fs] = await tx
    .select({ source: fieldSources.source, witnesses: fieldSources.witnesses, at: sql<string>`${fieldSources.updatedAt}::text` })
    .from(fieldSources)
    .where(and(eq(fieldSources.ipoId, args.ipoId), eq(fieldSources.tableName, args.tableName), eq(fieldSources.rowKey, args.rowKey), eq(fieldSources.fieldName, args.fieldName)))
    .limit(1);
  const fromWitness = baselineEvidenceFromWitnesses(fs?.witnesses, args.source);
  if (fromWitness.known && fromWitness.value !== null) return fromWitness;
  // A value this exchange wrote is stronger evidence than a stored "stated nothing" (round-4 review:
  // a stored nothing used to win over the exchange's own current value).
  if (fs && fs.source !== 'ADMIN' && sameSource(fs.source, args.source)) {
    const value = normalizeExchangeValue(args.currentValue);
    if (value !== null) return { known: true, value, at: utcTextToIso(fs.at) };
  }
  if (fromWitness.known) return fromWitness;
  const [plan] = await tx
    .select({ answers: schema.ipoFieldPlan.answers })
    .from(schema.ipoFieldPlan)
    .where(
      and(
        eq(schema.ipoFieldPlan.ipoId, args.ipoId),
        eq(schema.ipoFieldPlan.tableName, args.tableName),
        eq(schema.ipoFieldPlan.rowKey, args.rowKey),
        eq(schema.ipoFieldPlan.fieldName, args.sqlFieldName)
      )
    )
    .limit(1);
  return baselineEvidenceFromWitnesses(plan?.answers, args.source);
}

const NUMERIC_CHECK_FIELDS = new Set(['lotSize', 'priceRangeMin', 'priceRangeMax']);

/**
 * §1 check for a typed `ipos` value (spec §9.2 item 12, OD-108): the SAME `validateIPOData` the
 * scraper runs on every write, over the stored row with the typed value in place. Only errors on
 * the edited field refuse the save; the rest of the row is not the admin's edit.
 */
export function ipoFieldCheckFailure(row: Record<string, unknown>, fieldName: string, value: unknown): string | null {
  const merged: Record<string, unknown> = { ...row, [fieldName]: value };
  for (const f of NUMERIC_CHECK_FIELDS) {
    const v = merged[f];
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) merged[f] = Number(v);
  }
  const result = validateIPOData(merged as never, 'ADMIN');
  const own = result.errors.filter((e) => e.field === fieldName);
  return own.length ? own.map((e) => e.message).join('; ') : null;
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

export interface AdminFieldWriteOptions {
  /**
   * The field manifest (`scraper/config/field-manifest.json`) the plan is rebuilt from when the save
   * is to a plan-invalidating field (§2.8). Such a save without it is refused, never written with
   * stale ranks.
   */
  planManifest?: PlanManifest;
}

export async function writeAdminFieldValue(
  db: Db,
  input: AdminFieldWriteInput,
  checkTypedValue?: TypedValueCheck,
  options: AdminFieldWriteOptions = {}
): Promise<AdminFieldWriteResult> {
  const { ipoId, tableName, fieldName, actor, mode } = input;
  const rebuildsPlan = isPlanInvalidatingField(tableName, fieldName);

  const cols = columnsOf(tableName);
  if (!cols) {
    return { kind: 'INVALID', reason: `table ${tableName} is not admin-writable (allowed: ${[...ADMIN_WRITABLE_TABLES, ...ADMIN_ROW_TABLES].join(', ')})` };
  }
  const column = cols[fieldName];
  if (!column) return { kind: 'INVALID', reason: `${tableName} has no field ${fieldName}` };
  const rowSpec = ROW_TABLES[tableName];
  if (NON_EDITABLE_FIELDS.has(fieldName) || (rowSpec && rowSpec.derived?.derivedField === fieldName)) {
    return { kind: 'INVALID', reason: `${tableName}.${fieldName} is not editable` };
  }
  if (tableName === 'ipos' && fieldName === 'leadManagers') {
    return { kind: 'INVALID', reason: LIST_FIELD_REFUSAL };
  }
  if (tableName === 'ipos' && Object.prototype.hasOwnProperty.call(IPO_FIELDS_AWAITING_PHASE_B, fieldName)) {
    return { kind: 'INVALID', reason: `ipos.${fieldName} is not editable yet: ${IPO_FIELDS_AWAITING_PHASE_B[fieldName]}` };
  }
  if (rebuildsPlan && !options.planManifest) {
    return { kind: 'INVALID', reason: `ipos.${fieldName} rebuilds the IPO's source plan (spec §2.8); the save was called without the field manifest` };
  }
  if (rowSpec && !input.row?.rowKey && !input.row?.recordId) {
    return { kind: 'INVALID', reason: `${tableName} has several rows per IPO; name the row (rowKey or recordId)` };
  }
  if (!rowSpec && (input.row?.rowKey || input.row?.recordId)) {
    return { kind: 'INVALID', reason: `${tableName} has one row per IPO; a row reference is not accepted` };
  }
  if (!actor?.name?.trim()) return { kind: 'INVALID', reason: 'the admin name is required' };
  if (typeof actor.adminId !== 'string' || actor.adminId.trim() === '') {
    return { kind: 'INVALID', reason: 'the admin id is required: every admin write is attributed to an account (OD-104, OD-113)' };
  }
  if (typeof input.expectedVersion !== 'string' || input.expectedVersion === '') {
    return { kind: 'INVALID', reason: STALE_EDITOR_REASON };
  }
  if (mode.kind === 'typed' && !mode.sourceNote?.trim() && !input.empty) {
    return { kind: 'INVALID', reason: 'a typed value needs a short source note (document and page, or a URL) — OD-108' };
  }
  if ((mode.kind === 'pick' || mode.kind === 'storedPick') && !mode.sourceLabel?.trim()) {
    return { kind: 'INVALID', reason: 'a picked value needs the source label it was picked from' };
  }
  if (mode.kind === 'holdShown' && input.empty) {
    return { kind: 'INVALID', reason: 'a hold of the shown value cannot also delete it' };
  }
  if (mode.kind === 'pick' && input.empty) {
    return { kind: 'INVALID', reason: 'a delete (empty value with a reason) cannot also be a pick from a source — OD-121' };
  }
  if (input.empty && !input.empty.reason?.trim()) {
    return { kind: 'INVALID', reason: 'deleting a value needs a reason — OD-121' };
  }

  let newValue: unknown = null;
  let checkFailure: string | null = null;
  let derivedPatch: Record<string, string> = {};
  // A 'pick' value is loaded inside the transaction (M1); 'holdShown' holds the stored value.
  if (!input.empty && mode.kind !== 'holdShown' && mode.kind !== 'pick') {
    const coerced = coerceForColumn(column.columnType, mode.kind === 'storedPick' ? mode.value ?? null : input.value ?? null);
    if (coerced.ok === false) return { kind: 'INVALID', reason: `${tableName}.${fieldName}: ${coerced.reason}` };
    newValue = coerced.value;
    const closedSet = CLOSED_VALUE_SETS[`${tableName}.${fieldName}`];
    if (closedSet && (typeof newValue !== 'string' || !closedSet.includes(newValue))) {
      return { kind: 'INVALID', reason: `${tableName}.${fieldName} must be one of ${closedSet.join(', ')}` };
    }
    if (tableName === 'ipos' && fieldName === 'listingExchanges') {
      const venues = normalizeListingExchanges(newValue);
      if (venues.ok === false) return { kind: 'INVALID', reason: `ipos.listingExchanges: ${venues.reason}` };
      newValue = venues.value;
    }
    if (mode.kind === 'typed' && checkTypedValue) {
      checkFailure = checkTypedValue({ tableName, fieldName, value: newValue });
      if (checkFailure && !input.overrideReason?.trim()) {
        return { kind: 'INVALID', reason: `${tableName}.${fieldName} fails its check: ${checkFailure}. Save again with a written reason to keep it.` };
      }
    }
  }
  const deriveKey = (): AdminFieldWriteResult | null => {
    if (!(rowSpec?.derived && rowSpec.derived.sourceField === fieldName && mode.kind !== 'holdShown')) return null;
    // R-158: the row key is derived from this field; a value with no identity is refused.
    const derived = input.empty ? null : rowSpec.derived.derive(newValue);
    if (derived === null) {
      return { kind: 'INVALID', reason: `${tableName}.${fieldName} needs a value with an identity (not empty or whitespace); it keys the row` };
    }
    derivedPatch = { [rowSpec.derived.derivedField]: derived };
    return null;
  };
  if (mode.kind !== 'pick') {
    const refusal = deriveKey();
    if (refusal) return refusal;
  }

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const locked = await tx.execute(sql`SELECT slug, hidden_at FROM ipos WHERE id = ${ipoId}::uuid FOR NO KEY UPDATE`);
      const lockedRow = locked.rows[0] as { slug?: string; hidden_at?: Date | string | null } | undefined;
      const slug = lockedRow?.slug;
      if (!slug) throw new Refusal({ kind: 'NOT_FOUND', reason: `IPO ${ipoId} not found` });
      // OD-150: read under the same row lock the hide takes, so a hide and an edit never interleave.
      if (isHiddenIpo({ hiddenAt: lockedRow?.hidden_at ?? null })) throw new Refusal({ kind: 'HIDDEN', reason: IPO_HIDDEN_ADMIN_REASON });

      const target = await resolveRow(tx, ipoId, tableName, input.row);
      if (!target) throw new Refusal({ kind: 'NOT_FOUND', reason: `${tableName} has no such row for IPO ${ipoId}` });

      const current = await readVersion(tx, ipoId, tableName, fieldName, target.rowKey, target);
      const oldValue = await readCurrentValue(tx, ipoId, tableName, fieldName, target);
      if (current.version !== input.expectedVersion) {
        throw new Refusal({ kind: 'CONFLICT', currentValue: oldValue, setBy: current.setBy, setAt: current.setAt, currentVersion: current.version });
      }

      let effectiveMode: ResolvedMode;
      if (mode.kind === 'pick' && !input.empty) {
        // M1 / OD-109: the value is the source's STORED answer, never the client's.
        const answer = await loadStoredSourceAnswer(tx, {
          ipoId,
          tableName,
          rowKey: target.rowKey,
          fieldName,
          sqlFieldName: column.name,
          sourceLabel: mode.sourceLabel,
          currentValue: oldValue,
        });
        if (!answer) {
          throw new Refusal({
            kind: 'INVALID',
            reason: `${mode.sourceLabel} has no stored answer for ${tableName}.${fieldName}; pick a source that answered, or type the value with a source note`,
          });
        }
        const coerced = coerceForColumn(column.columnType, answer.value);
        if (coerced.ok === false) throw new Refusal({ kind: 'INVALID', reason: `${tableName}.${fieldName}: ${mode.sourceLabel}'s stored answer ${coerced.reason}` });
        newValue = coerced.value;
        if (tableName === 'ipos' && fieldName === 'listingExchanges') {
          const venues = normalizeListingExchanges(newValue);
          if (venues.ok === false) throw new Refusal({ kind: 'INVALID', reason: `ipos.listingExchanges: ${mode.sourceLabel}'s stored answer: ${venues.reason}` });
          newValue = venues.value;
        }
        const refusal = deriveKey();
        if (refusal) throw new Refusal(refusal);
        effectiveMode = { kind: 'pick', sourceLabel: mode.sourceLabel, readDate: answer.readDate };
      } else if (mode.kind === 'pick') {
        // An admin-empty is a delete with a reason (OD-121), never a source's pick; recording it
        // as "picked from <label>" would put a client-chosen source on the record.
        throw new Refusal({
          kind: 'INVALID',
          reason: `${tableName}.${fieldName}: a delete (empty value with a reason) cannot also be a pick from ${mode.sourceLabel}`,
        });
      } else if (mode.kind === 'storedPick') {
        effectiveMode = { kind: 'pick', sourceLabel: mode.sourceLabel, readDate: mode.readDate };
      } else if (mode.kind === 'holdShown') {
        if (oldValue === null || oldValue === undefined) {
          throw new Refusal({
            kind: 'INVALID',
            reason: `${tableName}.${fieldName} shows no value to hold; save a value (or delete it with a reason) in the field editor — OD-121`,
          });
        }
        newValue = oldValue;
        effectiveMode = { kind: 'pick', sourceLabel: current.source ?? 'STORED (source not recorded)', readDate: current.setAt };
      } else {
        effectiveMode = mode;
      }

      if (tableName === 'ipos' && effectiveMode.kind === 'typed' && !input.empty && !checkFailure) {
        const [row] = (await tx.select().from(schema.ipos).where(eq(schema.ipos.id, ipoId)).limit(1)) as Array<Record<string, unknown>>;
        checkFailure = ipoFieldCheckFailure(row ?? {}, fieldName, newValue);
        if (checkFailure && !input.overrideReason?.trim()) {
          throw new Refusal({
            kind: 'INVALID',
            reason: `${tableName}.${fieldName} fails its check: ${checkFailure}. Save again with a written reason to keep it.`,
          });
        }
      }

      const now = await readDatabaseNow(tx);
      let rowKey = target.rowKey;
      let identifierAlias: { aliasId: string | null; supersededKeyIds: string[]; activeKeyId: string | null; moved: IdentifierMove[] } | null = null;
      let planRebuild: PlanRebuildSummary | undefined;
      if (tableName === 'ipos') {
        if (isIdentifierAliasField(fieldName)) {
          // §9.2 item 26: the old identifier stays matchable, in this same transaction.
          const kept = await keepReplacedIdentifier(tx, {
            ipoId, fieldName, oldValue, newValue: input.empty ? null : newValue, adminId: actor.adminId, adminName: actor.name,
          });
          if (kept.ok === false) throw new Refusal({ kind: 'INVALID', reason: kept.reason });
          identifierAlias = { aliasId: kept.aliasId, supersededKeyIds: kept.supersededKeyIds, activeKeyId: kept.activeKeyId, moved: kept.moved };
        }
        const [typeBefore] = rebuildsPlan
          ? await tx.select({ segment: schema.ipos.segment, listingExchanges: schema.ipos.listingExchanges, offeringType: schema.ipos.offeringType }).from(schema.ipos).where(eq(schema.ipos.id, ipoId)).limit(1)
          : [];
        await IPORepository.applyAdminCorrigendumValue(tx, ipoId, fieldName, newValue);
        if (rebuildsPlan) {
          // §2.8 / §9.2 item 18: the SAME row is corrected (OD-35's new-row rule is for a new offering),
          // and its plan is rebuilt before commit so no walk ever reads ranks for the old type.
          planRebuild = await rebuildIpoPlanInTx(tx, ipoId, options.planManifest!, typeBefore ?? { segment: null, listingExchanges: null, offeringType: null });
        }
      } else if (rowSpec) {
        const tcols = getTableColumns(rowSpec.table) as unknown as Record<string, never>;
        const newKey: string | undefined = rowSpec.derived ? derivedPatch[rowSpec.derived.derivedField] : undefined;
        if (newKey !== undefined && newKey !== rowKey) {
          const clash = await tx
            .select({ id: tcols.id })
            .from(rowSpec.table as never)
            .where(and(eq(tcols.ipoId, ipoId), eq(tcols[rowSpec.keyField], newKey)))
            .limit(1);
          if (clash.length > 0) throw new Refusal({ kind: 'INVALID', reason: `another ${tableName} row of this IPO already has the key ${newKey}` });
        }
        const setPatch: Record<string, unknown> = { [fieldName]: newValue, ...derivedPatch };
        if ('updatedAt' in tcols) setPatch.updatedAt = now;
        const updated = await tx.update(rowSpec.table).set(setPatch as never).where(rowWhere(tableName, ipoId, target)).returning();
        if (updated.length === 0) throw new Refusal({ kind: 'NOT_FOUND', reason: `${tableName} row ${target.recordId} is gone` });
        if (newKey !== undefined && newKey !== rowKey) {
          // The row's identity moved: its provenance and holds move with it, so no hold is orphaned.
          await tx
            .update(fieldSources)
            .set({ rowKey: newKey } as never)
            .where(and(eq(fieldSources.ipoId, ipoId), eq(fieldSources.tableName, tableName), eq(fieldSources.rowKey, rowKey)));
          await tx
            .update(fieldProtectionMetadata)
            .set({ tableName: protectionTableName(tableName, newKey) } as never)
            .where(and(eq(fieldProtectionMetadata.ipoId, ipoId), eq(fieldProtectionMetadata.tableName, protectionTableName(tableName, rowKey))));
          rowKey = newKey;
        }
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

      // OD-106/OD-117: on an E-1 field, record what each exchange said at this save, so a later
      // exchange answer counts as "newer" only when it differs from this (exchange-override-rule.ts).
      // Only stored EVIDENCE sets an entry (`baselineEvidenceFromWitnesses`); no stored answer leaves
      // it absent (unknown), never null ("stated nothing"). A re-save carries the prior hold's known
      // baseline forward (`baselineForAdminSave`).
      let exchangeBaseline: ReturnType<typeof baselineForAdminSave> | null = null;
      if (isExchangeOverrideField(tableName, fieldName)) {
        const evidence: Partial<Record<ExchangeOverrideSource, BaselineEvidence>> = {};
        for (const source of EXCHANGE_OVERRIDE_SOURCES) {
          evidence[source] = await loadStoredExchangeEvidence(tx, {
            ipoId,
            tableName,
            rowKey,
            fieldName,
            sqlFieldName: column.name,
            source,
            currentValue: oldValue,
          });
        }
        const [priorRow] = await tx
          .select({
            source: fieldSources.source,
            lineage: fieldSources.dataLineage,
            previousSource: fieldSources.previousSource,
            previousValue: fieldSources.previousValue,
            at: sql<string>`${fieldSources.updatedAt}::text`,
          })
          .from(fieldSources)
          .where(and(eq(fieldSources.ipoId, ipoId), eq(fieldSources.tableName, tableName), eq(fieldSources.rowKey, rowKey), eq(fieldSources.fieldName, fieldName)))
          .limit(1);
        const resolvedPrior = priorRow ? resolveExchangeBaseline(priorRow) : null;
        const priorLineage = (priorRow?.lineage ?? {}) as { exchangeBaselineOrigin?: Record<string, ExchangeBaselineOrigin>; exchangeBaselineAt?: string };
        const priorOrigin: Partial<Record<ExchangeOverrideSource, ExchangeBaselineOrigin>> = { ...(priorLineage.exchangeBaselineOrigin ?? {}) };
        for (const src of resolvedPrior?.rebuilt ?? []) priorOrigin[src] = 'PREVIOUS_VALUE';
        exchangeBaseline = baselineForAdminSave({
          prior: resolvedPrior
            ? { baseline: resolvedPrior.baseline, origin: priorOrigin, since: priorLineage.exchangeBaselineAt ?? utcTextToIso(priorRow?.at) }
            : null,
          evidence,
        });
      }

      const adminLineage: Record<string, unknown> = {
        method: 'ADMIN_FIELD_WRITE',
        entryPoint: input.entryPoint,
        mode: effectiveMode.kind,
        ...(mode.kind === 'holdShown' ? { heldShownValue: true } : {}),
        ...(effectiveMode.kind === 'pick'
          ? { sourceLabel: effectiveMode.sourceLabel, readDate: effectiveMode.readDate }
          : { sourceNote: effectiveMode.sourceNote }),
        ...(input.empty ? { adminEmpty: true, emptyReason: input.empty.reason } : {}),
        ...(rowSpec ? { rowKey, recordId: target.recordId } : {}),
        // Replaces any baseline an OD-106 held read stored (rebuilt / first-read) on an earlier save.
        ...(exchangeBaseline ? { exchangeAtSave: exchangeBaseline.baseline, exchangeBaselineOrigin: exchangeBaseline.origin } : {}),
        by: actor.name,
        adminId: actor.adminId,
        ...(input.detail ?? {}),
      };
      // `adminKeys` names what THIS admin write owns, so the next admin write can strip exactly those
      // keys (and nothing a source wrote, e.g. the `docType` filing-persister reads back, #1068).
      const lineage = { ...adminLineage, adminKeys: Object.keys(adminLineage) };
      const prevSourceRow = await tx
        .select({ source: fieldSources.source })
        .from(fieldSources)
        .where(and(eq(fieldSources.ipoId, ipoId), eq(fieldSources.tableName, tableName), eq(fieldSources.rowKey, rowKey), eq(fieldSources.fieldName, fieldName)))
        .limit(1);
      const previousSource = prevSourceRow[0]?.source ?? null;
      await tx
        .insert(fieldSources)
        .values({
          ipoId,
          tableName,
          rowKey,
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
            // Strip the keys the PREVIOUS admin write owned (its `adminKeys`), keep everything a
            // source wrote (#1068: filing-persister reads `docType` back), then add this write's keys.
            // So stale admin keys (adminEmpty/emptyReason after a later save, sourceNote after a pick)
            // never survive, and source provenance is never lost. History is on the audit row.
            dataLineage: sql`(COALESCE(${fieldSources.dataLineage}, '{}'::jsonb) - COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(${fieldSources.dataLineage} -> 'adminKeys', ${JSON.stringify(LEGACY_ADMIN_LINEAGE_KEYS)}::jsonb))), '{}'::text[])) || ${JSON.stringify(lineage)}::jsonb`,
            updatedBy: actor.name,
            updatedAt: now,
          } as never,
        });

      const editNote = input.empty
        ? `Deleted: ${input.empty.reason}`
        : effectiveMode.kind === 'typed'
          ? `Typed: ${effectiveMode.sourceNote}`
          : `Picked from ${effectiveMode.sourceLabel}${effectiveMode.readDate ? `, read ${effectiveMode.readDate}` : ''}`;
      const holdTable = protectionTableName(tableName, rowKey);
      await tx
        .insert(fieldProtectionMetadata)
        .values({
          ipoId,
          tableName: holdTable,
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

      // OD-142: the field is the admin's now (§2.7), so a "source no longer first" item on it is moot.
      await clearSourceNoLongerFirstOnAdminSave(tx as never, { ipoId, tableName, rowKey, fieldName });
      // #1300 (§9.2 items 9, 25): an open document suggestion proposing exactly this value is accepted
      // by this save; any other save leaves it open. An admin EMPTY value accepts nothing.
      if (!input.empty) {
        await closeSuggestionsAcceptedByAdminSave(tx as never, { ipoId, tableName, rowKey, fieldName, savedValue: newValue, adminName: actor.name });
      }

      // §9.2 item 8 (OD-107): a field edit on a peer row changes the peer LIST, so the whole list is
      // admin-owned from here on, exactly as after a list edit (the same hold row the list write sets).
      if (tableName === 'peer_companies') {
        await upsertListHold(tx as never, { ipoId, list: 'peer_companies', by: actor.name, editNote: `Row field edited: ${rowKey}.${fieldName}`, at: now });
        await recomputeListSuggestionsAfterRowEdit(tx, ipoId, 'peer_companies', actor.name);
      }

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
          // §9.2 item 26: what the edit kept, so an audit reader (and the merge tool) can find it
          ...(identifierAlias ? { identifierAlias } : {}),
          ...(planRebuild ? { planRebuild } : {}),
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: true,
        createdAt: now,
      });

      const after = await readVersion(tx, ipoId, tableName, fieldName, rowKey, { rowKey, recordId: target.recordId });
      return { kind: 'OK' as const, ipoId, slug, tableName, fieldName, rowKey, oldValue, newValue, version: after.version, ...(planRebuild ? { planRebuild } : {}) };
    });
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    const reason = badValueReason(error);
    if (reason) return { kind: 'INVALID', reason: `${tableName}.${fieldName}: ${reason}` };
    throw error;
  }
}
