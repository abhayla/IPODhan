/**
 * #1419: the ROW half of a consolidated child-table write (spec OD-10, §2.10).
 *
 * `consolidatedUpsertChildRows` decides each value and writes its `field_sources` provenance. The
 * persisters that call it (filing, anchor) write the row themselves with their own repositories; the
 * field-plan walk had no such step, so provenance said a value existed while the row was empty or
 * stale. This module is the one row writer for every member of the consolidated child-table set,
 * selected by table name through an exhaustive spec map (a ninth table fails to compile here).
 *
 * Two calls, used in this order by the orchestrator:
 *   1. `probeChildRow`     BEFORE consolidation: does the row exist, could it be created from its key,
 *                          is every field a real column, is any field held. A row that cannot be written
 *                          is refused here, so no provenance is ever filed for it.
 *   2. `writeChildRowFields` AFTER consolidation: update the keyed row (or insert it when creatable),
 *                          re-reading admin holds under the `ipos` row lock in the same transaction.
 */
import { and, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
// Namespace import, read lazily in `specs()`: this module loads with every IPORepository, and a test
// that mocks the schema with only the tables it uses must not fail on a table it never writes.
import * as schema from '../db/schema';
import { filterPatchUnderHold, lockAndReadFieldHolds, dropHeldFields, protectionTableName } from '../services/field-hold';

export type ChildRowTable =
  | 'ipo_details'
  | 'financial_statements'
  | 'ipo_valuation'
  | 'ipo_risk_factors'
  | 'promoters'
  | 'anchor_investors'
  | 'ipo_intermediaries'
  | 'peer_companies';

type Db = NodePgDatabase<typeof schema>;

interface ChildRowSpec {
  table: PgTable;
  /** Row key -> the key columns it names (camelCase), or null when the key is malformed. `''` = singleton. */
  keyColumns(rowKey: string): Record<string, unknown> | null;
  /** NOT NULL columns with no default, besides `ipoId`: an insert needs every one of them. */
  requiredForInsert: readonly string[];
  /** Columns an insert takes from the writer itself rather than from the value set. */
  insertBase?(source: string): Record<string, unknown>;
}

const singleton = (rowKey: string) => (rowKey === '' ? {} : null);
const nonEmpty = (rowKey: string, column: string) => (rowKey === '' ? null : { [column]: rowKey });

/**
 * Keys match `child-row-keys.ts` and each table's unique constraint (schema.ts):
 * financial_statements `<fy>:<basis>`, ipo_valuation `<pricing_event>`, promoters / peer_companies
 * `<normalized_name>`, ipo_intermediaries `<role>:<normalized_name>`, ipo_risk_factors `<heading_hash>`.
 */
function buildSpecs(): Record<ChildRowTable, ChildRowSpec> {
  return {
  ipo_details: {
    table: schema.ipoDetails,
    keyColumns: singleton,
    requiredForInsert: ['dataSource'],
    insertBase: (source) => ({ dataSource: source }),
  },
  anchor_investors: {
    table: schema.anchorInvestors,
    keyColumns: singleton,
    requiredForInsert: [
      'bidDate',
      'totalSharesOffered',
      'totalAmountRaised',
      'anchorInvestorsCount',
      'lockIn50PercentDate',
      'lockInRemainingDate',
    ],
  },
  financial_statements: {
    table: schema.financialStatements,
    keyColumns: (rowKey) => {
      const m = /^(\d+):(.+)$/.exec(rowKey);
      return m ? { fiscalYear: Number(m[1]), basis: m[2] } : null;
    },
    requiredForInsert: ['fiscalYear', 'basis', 'unit'],
  },
  ipo_valuation: {
    table: schema.ipoValuation,
    keyColumns: (rowKey) => nonEmpty(rowKey, 'pricingEvent'),
    requiredForInsert: ['pricingEvent'],
  },
  promoters: {
    table: schema.promoters,
    keyColumns: (rowKey) => nonEmpty(rowKey, 'normalizedName'),
    requiredForInsert: ['name'],
  },
  peer_companies: {
    table: schema.peerCompanies,
    keyColumns: (rowKey) => nonEmpty(rowKey, 'normalizedName'),
    requiredForInsert: ['companyName', 'isListed'],
  },
  ipo_intermediaries: {
    table: schema.ipoIntermediaries,
    keyColumns: (rowKey) => {
      const i = rowKey.indexOf(':');
      if (i <= 0 || i === rowKey.length - 1) return null;
      return { role: rowKey.slice(0, i), normalizedName: rowKey.slice(i + 1) };
    },
    requiredForInsert: ['role', 'name', 'brlmName', 'asOfDate'],
  },
  ipo_risk_factors: {
    table: schema.ipoRiskFactors,
    keyColumns: (rowKey) => nonEmpty(rowKey, 'headingHash'),
    requiredForInsert: ['seq', 'heading', 'stepId'],
  },
  };
}

let SPECS: Record<ChildRowTable, ChildRowSpec> | null = null;
function specs(): Record<ChildRowTable, ChildRowSpec> {
  SPECS ??= buildSpecs();
  return SPECS;
}

/** The table names this writer serves (the Record type above makes the set exhaustive). */
export const CHILD_ROW_TABLES: readonly ChildRowTable[] = [
  'ipo_details',
  'financial_statements',
  'ipo_valuation',
  'ipo_risk_factors',
  'promoters',
  'anchor_investors',
  'ipo_intermediaries',
  'peer_companies',
];

export type ChildRowRefusal =
  | 'UNKNOWN_CHILD_TABLE'
  | 'MALFORMED_ROW_KEY'
  | 'UNKNOWN_CHILD_COLUMN'
  | 'CHILD_ROW_NOT_CREATABLE'
  | 'CHILD_FIELD_HELD'
  | 'NO_DECIDED_VALUE'
  | 'IPO_ROW_MISSING';

export type ChildRowProbe = { writable: true; exists: boolean } | { writable: false; reason: ChildRowRefusal; detail?: string };

export type ChildRowWrite =
  | { written: true; mode: 'UPDATE' | 'INSERT'; dropped: string[] }
  | { written: false; reason: ChildRowRefusal; dropped: string[] };

function specFor(tableName: string): ChildRowSpec | null {
  return (CHILD_ROW_TABLES as readonly string[]).includes(tableName) ? specs()[tableName as ChildRowTable] : null;
}

function whereKey(spec: ChildRowSpec, ipoId: string, key: Record<string, unknown>): SQL {
  const cols = getTableColumns(spec.table) as Record<string, any>;
  const parts = [eq(cols.ipoId, ipoId), ...Object.entries(key).map(([c, v]) => eq(cols[c], v))];
  return and(...parts) as SQL;
}

function canInsert(spec: ChildRowSpec, row: Record<string, unknown>): boolean {
  return spec.requiredForInsert.every((c) => row[c] !== undefined && row[c] !== null);
}

/** Read-only pre-check: refuse, before any provenance is written, a row this writer could not land. */
export async function probeChildRow(
  db: Db,
  tableName: string,
  ipoId: string,
  rowKey: string,
  fields: readonly string[],
  source: string
): Promise<ChildRowProbe> {
  const spec = specFor(tableName);
  if (!spec) return { writable: false, reason: 'UNKNOWN_CHILD_TABLE', detail: tableName };
  const key = spec.keyColumns(rowKey);
  if (!key) return { writable: false, reason: 'MALFORMED_ROW_KEY', detail: rowKey };
  const cols = getTableColumns(spec.table) as Record<string, unknown>;
  const unknown = fields.filter((f) => !(f in cols) || f === 'ipoId' || f === 'id');
  if (unknown.length > 0) return { writable: false, reason: 'UNKNOWN_CHILD_COLUMN', detail: unknown.join(',') };

  const holds = await lockAndReadFieldHolds(db as never, [ipoId], protectionTableName(tableName, rowKey));
  const hold = holds.get(ipoId);
  if (!hold) return { writable: false, reason: 'IPO_ROW_MISSING' };
  const probePatch = Object.fromEntries(fields.map((f) => [f, true]));
  const { dropped } = dropHeldFields(probePatch, hold, { honourScraperLock: true });
  if (dropped.length > 0) return { writable: false, reason: 'CHILD_FIELD_HELD', detail: dropped.join(',') };

  const existing = await db.select().from(spec.table as any).where(whereKey(spec, ipoId, key)).limit(1);
  if (existing.length > 0) return { writable: true, exists: true };
  const candidate = { ...(spec.insertBase?.(source) ?? {}), ...key, ...probePatch };
  if (!canInsert(spec, candidate)) return { writable: false, reason: 'CHILD_ROW_NOT_CREATABLE', detail: tableName };
  return { writable: true, exists: false };
}

/**
 * Land the consolidated values on the keyed row. Admin holds are re-read under the `ipos` row lock in
 * this transaction (§9.2 item 19); a held or hidden field is dropped, never written.
 */
export async function writeChildRowFields(
  db: Db,
  tableName: string,
  ipoId: string,
  rowKey: string,
  values: Record<string, unknown>,
  source: string
): Promise<ChildRowWrite> {
  const spec = specFor(tableName);
  if (!spec) return { written: false, reason: 'UNKNOWN_CHILD_TABLE', dropped: [] };
  const key = spec.keyColumns(rowKey);
  if (!key) return { written: false, reason: 'MALFORMED_ROW_KEY', dropped: [] };
  const cols = getTableColumns(spec.table) as Record<string, unknown>;
  if (Object.keys(values).some((f) => !(f in cols) || f === 'ipoId' || f === 'id')) {
    return { written: false, reason: 'UNKNOWN_CHILD_COLUMN', dropped: [] };
  }

  return db.transaction(async (tx) => {
    const { patch, dropped, hold } = await filterPatchUnderHold(
      tx as never,
      ipoId,
      protectionTableName(tableName, rowKey),
      values,
      { honourScraperLock: true }
    );
    if (!hold) return { written: false as const, reason: 'IPO_ROW_MISSING' as const, dropped };
    if (Object.keys(patch).length === 0) return { written: false as const, reason: 'CHILD_FIELD_HELD' as const, dropped };

    const updated = await tx
      .update(spec.table as any)
      .set({ ...patch, ...('updatedAt' in cols ? { updatedAt: sql`now()` } : {}) })
      .where(whereKey(spec, ipoId, key))
      .returning();
    if (updated.length > 0) return { written: true as const, mode: 'UPDATE' as const, dropped };

    const row = { ...(spec.insertBase?.(source) ?? {}), ...key, ...patch, ipoId };
    if (!canInsert(spec, row)) return { written: false as const, reason: 'CHILD_ROW_NOT_CREATABLE' as const, dropped };
    await tx.insert(spec.table as any).values(row as never);
    return { written: true as const, mode: 'INSERT' as const, dropped };
  });
}


