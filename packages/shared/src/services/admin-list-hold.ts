/**
 * Spec §9.2 item 8 (OD-107), items 9, 19, 25, 28(b); F-174. The WHOLE-LIST admin hold.
 *
 * Once an admin changes a list-shaped field for an IPO, the whole list is admin-owned: no scraper or
 * document writer replaces, extends or deletes its rows. A writer that brings a different list
 * records it as a SUGGESTION (rows to add, rows to remove) for the admin queue instead.
 *
 * Representation — the smallest one every writer already reads: a `field_protection_metadata` row.
 *   - lead managers live in `ipos.lead_managers`, so their list hold IS the existing field hold
 *     (`ipos` / `leadManagers`), which `IPORepository.update` and `recordDiscoveredLeadManagers`
 *     already drop inside their own transaction (item 19, #1273).
 *   - a child list table's hold is the row (`<table>`, `*`): table name bare (no row key — the hold
 *     is on the list, not on a row), field `*` (every column of every row). Unique key
 *     (table_name, field_name, ipo_id) makes it one row per list per IPO. No migration.
 *
 * Serialisation is the same as item 19: the writer locks the IPO's `ipos` row FOR NO KEY UPDATE
 * (the lock `writeAdminListChange` takes first), then reads the hold. This module imports no schema,
 * so a writer in any package can use it without loading the drizzle table graph.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rowKeyForName } from '../utils/company-name-normalizer';
import { headingHashForRiskFactor } from '../utils/risk-factor-heading-key';
import type { HoldExecutor } from './field-hold';

/** The field name of a child-list hold: the whole list, every column. */
export const LIST_HOLD_FIELD = '*';

/** `data_conflicts.resolution_reason` of a list suggestion (admin-only, never a dispute). */
export const ADMIN_LIST_SUGGESTION_REASON = 'ADMIN_LIST_SUGGESTION';

/** The seven lists of OD-107, by the name the admin editor and the audit rows use. */
export const ADMIN_LISTS = [
  'lead_managers',
  'promoters',
  'peer_companies',
  'anchor_investors',
  'ipo_intermediaries',
  'financial_statements',
  'ipo_risk_factors',
] as const;
export type AdminListName = (typeof ADMIN_LISTS)[number];

type Row = Record<string, unknown>;

export interface AdminListSpec {
  /** `field_protection_metadata.table_name` / `data_conflicts.table_name` of the list's hold. */
  holdTable: string;
  /** `field_protection_metadata.field_name` of the list's hold. */
  holdField: string;
  /** Stable identity of one row across a re-read (the same key both sides of a diff use). */
  key(row: Row): string;
  /** What the admin reads for the row in a suggestion. */
  label(row: Row): string;
  /**
   * The row's values, when a different value under the SAME key is itself a change the admin must
   * see (financial statements: a year the admin already has, with other numbers). Lists without it
   * compare by key only (a renamed promoter is a remove plus an add).
   */
  values?(row: Row): string;
}

const s = (v: unknown) => (v == null ? '' : String(v));
const nameKey = (normalized: unknown, name: unknown) => (s(normalized) !== '' ? s(normalized) : rowKeyForName(s(name)) ?? s(name).trim().toLowerCase());

/** The value columns of a financial-statement year (schema `financial_statements`). */
export const FINANCIAL_VALUE_COLUMNS = ['revenue', 'totalIncome', 'ebitda', 'pat', 'netWorth', 'epsBasic', 'epsDiluted', 'opCashFlow', 'dscr', 'rentExpense'] as const;
/** numeric columns read back as '123.00'; a writer hands 123 — compare the number, not the text. */
const num = (v: unknown) => (v == null || v === '' ? '' : Number.isFinite(Number(v)) ? String(Number(v)) : String(v));

export const ADMIN_LIST_SPECS: Readonly<Record<AdminListName, AdminListSpec>> = {
  // ipos.lead_managers is a jsonb string array; a "row" is { name }.
  lead_managers: { holdTable: 'ipos', holdField: 'leadManagers', key: (r) => nameKey(null, r.name), label: (r) => s(r.name) },
  promoters: { holdTable: 'promoters', holdField: LIST_HOLD_FIELD, key: (r) => nameKey(r.normalizedName, r.name), label: (r) => s(r.name) },
  peer_companies: {
    holdTable: 'peer_companies',
    holdField: LIST_HOLD_FIELD,
    key: (r) => nameKey(r.normalizedName, r.companyName),
    label: (r) => s(r.companyName),
  },
  // anchor_investors is ONE row per IPO; the list is its investor_list jsonb; a "row" is one investor.
  // bid_date and the row's totals stay outside the hold (OD-117: bid_date follows OD-106).
  anchor_investors: { holdTable: 'anchor_investors', holdField: LIST_HOLD_FIELD, key: (r) => nameKey(null, r.name), label: (r) => s(r.name) },
  ipo_intermediaries: {
    holdTable: 'ipo_intermediaries',
    holdField: LIST_HOLD_FIELD,
    key: (r) => `${s(r.role)}|${nameKey(r.normalizedName, r.name)}`,
    label: (r) => `${s(r.name)} (${s(r.role)})`,
  },
  financial_statements: {
    holdTable: 'financial_statements',
    holdField: LIST_HOLD_FIELD,
    key: (r) => `${s(r.fiscalYear)}|${s(r.basis)}`,
    label: (r) => `FY${s(r.fiscalYear)} ${s(r.basis)}`,
    values: (r) => [s(r.unit), ...FINANCIAL_VALUE_COLUMNS.map((c) => num(r[c]))].join('|'),
  },
  ipo_risk_factors: {
    holdTable: 'ipo_risk_factors',
    holdField: LIST_HOLD_FIELD,
    key: (r) => (s(r.headingHash) !== '' ? s(r.headingHash) : headingHashForRiskFactor(s(r.heading)) ?? s(r.heading)),
    label: (r) => s(r.heading),
  },
};

/** The list whose hold is stored under this `field_protection_metadata.table_name`, if any. */
export function listRowKey(list: AdminListName, row: Row): string {
  return ADMIN_LIST_SPECS[list].key(row);
}

/**
 * Inside the writer's transaction: lock the IPO's `ipos` row (the admin's lock), then read whether
 * the list is admin-owned. `exists` is false when the IPO row is gone.
 */
export async function lockAndReadListOwnership(tx: HoldExecutor, ipoId: string, list: AdminListName): Promise<{ exists: boolean; owned: boolean }> {
  const spec = ADMIN_LIST_SPECS[list];
  const locked = await tx.execute(sql`SELECT id FROM ipos WHERE id = ${ipoId}::uuid FOR NO KEY UPDATE`);
  if (locked.rows.length === 0) return { exists: false, owned: false };
  const prot = await tx.execute(sql`
    SELECT 1 FROM field_protection_metadata
    WHERE ipo_id = ${ipoId}::uuid AND table_name = ${spec.holdTable} AND field_name = ${spec.holdField} AND is_protected = true
    LIMIT 1`);
  return { exists: true, owned: prot.rows.length > 0 };
}

/**
 * Inside an admin write's transaction: make the list admin-owned (OD-107). The ONE hold upsert every
 * admin list change uses — `writeAdminListChange`, and a field edit on a list row (a peer row).
 */
export async function upsertListHold(
  tx: HoldExecutor,
  args: { ipoId: string; list: AdminListName; by: string; editNote: string; at: Date }
): Promise<void> {
  const spec = ADMIN_LIST_SPECS[args.list];
  const at = args.at.toISOString();
  await tx.execute(sql`
    INSERT INTO field_protection_metadata (ipo_id, table_name, field_name, is_protected, auto_protected,
                                           manually_edited_at, manually_edited_by, edit_note, created_at, updated_at)
    VALUES (${args.ipoId}::uuid, ${spec.holdTable}, ${spec.holdField}, true, true, ${at}, ${args.by}, ${args.editNote}, ${at}, ${at})
    ON CONFLICT (table_name, field_name, ipo_id) DO UPDATE
      SET is_protected = true, auto_protected = true, manually_edited_at = EXCLUDED.manually_edited_at,
          manually_edited_by = EXCLUDED.manually_edited_by, edit_note = EXCLUDED.edit_note, updated_at = EXCLUDED.updated_at`);
}

/**
 * Pure: the rows a writer's list would add to, remove from, and (for a list with `values`) change in
 * the admin's list, by row key.
 */
export function diffList(
  list: AdminListName,
  stored: readonly Row[],
  incoming: readonly Row[]
): { add: string[]; remove: string[]; change: string[]; incomingKeys: string[] } {
  const spec = ADMIN_LIST_SPECS[list];
  const storedByKey = new Map(stored.map((r) => [spec.key(r), r]));
  const incomingByKey = new Map(incoming.map((r) => [spec.key(r), r]));
  const add = [...incomingByKey].filter(([k]) => !storedByKey.has(k)).map(([, r]) => spec.label(r));
  const remove = stored.filter((r) => !incomingByKey.has(spec.key(r))).map((r) => spec.label(r));
  const change = spec.values
    ? [...incomingByKey].filter(([k, r]) => storedByKey.has(k) && spec.values!(storedByKey.get(k)!) !== spec.values!(r)).map(([, r]) => spec.label(r))
    : [];
  const incomingKeys = [...incomingByKey]
    .map(([k, r]) => (spec.values ? `${k}=${spec.values(r)}` : k))
    .sort();
  return { add: add.sort(), remove: remove.sort(), change: change.sort(), incomingKeys };
}

const SOURCES = new Set(['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'INVESTORGAIN_GMP', 'API_FALLBACK']);

/**
 * Inside the writer's transaction, when the list is admin-owned: record the writer's different list
 * as ONE suggestion row in `data_conflicts` (value1 = the admin's list, value2 = the writer's), with
 * the rows to add, remove and change in `evidence`. Nothing is written to the list. The same writer list for
 * the same IPO is one row forever (`suggestion_key`), so a re-read never repeats a suggestion the
 * admin already saw or dismissed (item 25). A list equal to the admin's records nothing.
 */
export async function recordListSuggestion(
  tx: HoldExecutor,
  args: { ipoId: string; list: AdminListName; source: string; stored: readonly Row[]; incoming: readonly Row[]; documentId?: string | null }
): Promise<{ recorded: boolean; add: string[]; remove: string[]; change: string[] }> {
  const spec = ADMIN_LIST_SPECS[args.list];
  const { add, remove, change, incomingKeys } = diffList(args.list, args.stored, args.incoming);
  if (add.length === 0 && remove.length === 0 && change.length === 0) return { recorded: false, add, remove, change };
  const source = SOURCES.has(args.source.toUpperCase()) ? args.source.toUpperCase() : 'DRHP';
  const key = createHash('sha256').update(`list|${args.ipoId}|${args.list}|${incomingKeys.join('\u0001')}`).digest('hex');
  // #1294 item 2: the writer's rows are kept (only the columns a row's key, label and values read), so an
  // OPEN suggestion can be recomputed against the admin's list when the admin edits it.
  const evidence = { origin: ADMIN_LIST_SUGGESTION_REASON, list: args.list, writer: args.source, add, remove, change, incoming: args.incoming.map(projectListRow) };
  const labels = (rows: readonly Row[]) => JSON.stringify(rows.map((r) => spec.label(r)));
  const res = await tx.execute(sql`
    INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2,
                                resolution_reason, severity, document_id, evidence, suggestion_key)
    VALUES (${args.ipoId}::uuid, ${spec.holdTable}, '', ${spec.holdField}, 'ADMIN', ${labels(args.stored)},
            ${source}::scraper_source, ${labels(args.incoming)}, ${ADMIN_LIST_SUGGESTION_REASON}, 'WARNING',
            ${args.documentId ?? null}::uuid, ${JSON.stringify(evidence)}::jsonb, ${key})
    ON CONFLICT (suggestion_key) DO NOTHING
    RETURNING id`);
  return { recorded: res.rows.length > 0, add, remove, change };
}

/** The columns any list's key, label or values read (ADMIN_LIST_SPECS); nothing else is kept. */
const LIST_ROW_COLUMNS = ['name', 'normalizedName', 'companyName', 'role', 'fiscalYear', 'basis', 'unit', 'headingHash', 'heading', ...FINANCIAL_VALUE_COLUMNS] as const;

export function projectListRow(row: Row): Row {
  const out: Row = {};
  for (const c of LIST_ROW_COLUMNS) if (row[c] !== undefined) out[c] = row[c];
  return out;
}

/**
 * #1294 item 2, spec §9.2 items 8 and 25 (clarified 2026-10-01). Inside an admin list write's
 * transaction, AFTER the list is written: every OPEN list suggestion of this list is recomputed
 * against the admin's CURRENT list. Its rows to add / remove / change and its value1 (the admin's
 * list) are rewritten; when the document's list now equals the admin's, the suggestion closes
 * (resolved, `evidence.closedBecause` = ADMIN_LIST_NOW_EQUAL). The suggestion's key is NOT changed:
 * it stays the writer's list, so a dismissed suggestion for the same document list never returns
 * (item 25), and a decided row is never touched. A row recorded before the writer's rows were kept
 * (`evidence.incoming` absent) cannot be recomputed; it is left as it is and counted in `legacy`.
 */
export async function recomputeOpenListSuggestions(
  tx: HoldExecutor,
  args: { ipoId: string; list: AdminListName; adminRows: readonly Row[]; by: string }
): Promise<{ updated: string[]; closed: string[]; legacy: string[] }> {
  const spec = ADMIN_LIST_SPECS[args.list];
  const out = { updated: [] as string[], closed: [] as string[], legacy: [] as string[] };
  const open = await tx.execute(sql`
    SELECT id::text AS id, evidence FROM data_conflicts
     WHERE ipo_id = ${args.ipoId}::uuid AND resolved_at IS NULL
       AND resolution_reason = ${ADMIN_LIST_SUGGESTION_REASON}
       AND table_name = ${spec.holdTable} AND field_name = ${spec.holdField}
     ORDER BY id
     FOR UPDATE`);
  const adminLabels = JSON.stringify(args.adminRows.map((r) => spec.label(r)));
  for (const r of open.rows as Array<{ id: string; evidence: Record<string, unknown> | null }>) {
    const incoming = r.evidence?.incoming;
    if (!Array.isArray(incoming)) {
      out.legacy.push(r.id);
      continue;
    }
    const { add, remove, change } = diffList(args.list, args.adminRows, incoming as Row[]);
    const evidence = { ...(r.evidence ?? {}), add, remove, change };
    if (add.length === 0 && remove.length === 0 && change.length === 0) {
      await tx.execute(sql`
        UPDATE data_conflicts
           SET value1 = ${adminLabels}, evidence = ${JSON.stringify({ ...evidence, closedBecause: 'ADMIN_LIST_NOW_EQUAL' })}::jsonb,
               resolved_source = 'ADMIN', resolved_by = ${args.by}, resolved_at = now(),
               admin_note = 'closed: the admin list now equals this document list (#1294)'
         WHERE id = ${r.id}::uuid AND resolved_at IS NULL`);
      out.closed.push(r.id);
    } else {
      await tx.execute(sql`
        UPDATE data_conflicts SET value1 = ${adminLabels}, evidence = ${JSON.stringify(evidence)}::jsonb
         WHERE id = ${r.id}::uuid AND resolved_at IS NULL`);
      out.updated.push(r.id);
    }
  }
  return out;
}

/** The `ipos` column a duplicate merge may carry INTO a list (CARRY_IF_ABSENT_COLUMNS), by list. */
const LIST_CARRY_COLUMN: Partial<Record<AdminListName, string>> = { lead_managers: 'lead_managers' };

/**
 * #1294 item 4, spec §9.2 items 8 and 28(b) (clarified 2026-10-01): the OD-38 duplicate merge deletes
 * the dropped row's child lists (and its `ipos.lead_managers` with the row), and may carry lead managers
 * onto the survivor. Removing admin rows needs a reason and an audit row, so the merge never does it
 * silently: this returns the refusal (naming the IPO and the list) when the dropped row has ANY
 * admin-owned list, admin-empty included, or the survivor's admin-owned list would receive a carried
 * column. Null when the merge touches no admin-owned list. The admin moves or re-enters the list first.
 */
export async function adminListMergeRefusal(
  db: HoldExecutor,
  args: { keep: { id: string; slug: string }; drop: { id: string; slug: string }; carriedColumns: readonly string[] }
): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT ipo_id::text AS ipo_id, table_name, field_name FROM field_protection_metadata
     WHERE ipo_id IN (${args.keep.id}::uuid, ${args.drop.id}::uuid) AND is_protected = true`);
  const held = new Set((res.rows as Array<{ ipo_id: string; table_name: string; field_name: string }>).map((r) => `${r.ipo_id}|${r.table_name}|${r.field_name}`));
  const owned = (ipoId: string, list: AdminListName) => held.has(`${ipoId}|${ADMIN_LIST_SPECS[list].holdTable}|${ADMIN_LIST_SPECS[list].holdField}`);
  const problems: string[] = [];
  for (const list of ADMIN_LISTS) {
    if (owned(args.drop.id, list)) problems.push(`the dropped IPO ${args.drop.slug} has an admin-owned ${list} list, which the merge would delete`);
    const carry = LIST_CARRY_COLUMN[list];
    if (carry && args.carriedColumns.includes(carry) && owned(args.keep.id, list)) {
      problems.push(`the surviving IPO ${args.keep.slug} has an admin-owned ${list} list, which the merge would replace`);
    }
  }
  if (problems.length === 0) return null;
  return `${problems.join('; ')} (spec §9.2 items 8, 28(b): removing admin rows needs a reason and an audit row). Move or re-enter the list in the admin editor first.`;
}
