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
}

const s = (v: unknown) => (v == null ? '' : String(v));
const nameKey = (normalized: unknown, name: unknown) => (s(normalized) !== '' ? s(normalized) : rowKeyForName(s(name)) ?? s(name).trim().toLowerCase());

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

/** Pure: the rows a writer's list would add to, and remove from, the admin's list (by row key). */
export function diffList(list: AdminListName, stored: readonly Row[], incoming: readonly Row[]): { add: string[]; remove: string[]; incomingKeys: string[] } {
  const spec = ADMIN_LIST_SPECS[list];
  const storedKeys = new Set(stored.map((r) => spec.key(r)));
  const incomingByKey = new Map(incoming.map((r) => [spec.key(r), r]));
  const add = [...incomingByKey].filter(([k]) => !storedKeys.has(k)).map(([, r]) => spec.label(r));
  const remove = stored.filter((r) => !incomingByKey.has(spec.key(r))).map((r) => spec.label(r));
  return { add: add.sort(), remove: remove.sort(), incomingKeys: [...incomingByKey.keys()].sort() };
}

const SOURCES = new Set(['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'INVESTORGAIN_GMP', 'API_FALLBACK']);

/**
 * Inside the writer's transaction, when the list is admin-owned: record the writer's different list
 * as ONE suggestion row in `data_conflicts` (value1 = the admin's list, value2 = the writer's), with
 * the rows to add and remove in `evidence`. Nothing is written to the list. The same writer list for
 * the same IPO is one row forever (`suggestion_key`), so a re-read never repeats a suggestion the
 * admin already saw or dismissed (item 25). A list equal to the admin's records nothing.
 */
export async function recordListSuggestion(
  tx: HoldExecutor,
  args: { ipoId: string; list: AdminListName; source: string; stored: readonly Row[]; incoming: readonly Row[]; documentId?: string | null }
): Promise<{ recorded: boolean; add: string[]; remove: string[] }> {
  const spec = ADMIN_LIST_SPECS[args.list];
  const { add, remove, incomingKeys } = diffList(args.list, args.stored, args.incoming);
  if (add.length === 0 && remove.length === 0) return { recorded: false, add, remove };
  const source = SOURCES.has(args.source.toUpperCase()) ? args.source.toUpperCase() : 'DRHP';
  const key = createHash('sha256').update(`list|${args.ipoId}|${args.list}|${incomingKeys.join('\u0001')}`).digest('hex');
  const evidence = { origin: ADMIN_LIST_SUGGESTION_REASON, list: args.list, writer: args.source, add, remove };
  const labels = (rows: readonly Row[]) => JSON.stringify(rows.map((r) => spec.label(r)));
  const res = await tx.execute(sql`
    INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2,
                                resolution_reason, severity, document_id, evidence, suggestion_key)
    VALUES (${args.ipoId}::uuid, ${spec.holdTable}, '', ${spec.holdField}, 'ADMIN', ${labels(args.stored)},
            ${source}::scraper_source, ${labels(args.incoming)}, ${ADMIN_LIST_SUGGESTION_REASON}, 'WARNING',
            ${args.documentId ?? null}::uuid, ${JSON.stringify(evidence)}::jsonb, ${key})
    ON CONFLICT (suggestion_key) DO NOTHING
    RETURNING id`);
  return { recorded: res.rows.length > 0, add, remove };
}
