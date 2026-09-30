/**
 * Spec §9.2 item 19 (§2.7): every scraper write re-checks the admin hold INSIDE its own transaction,
 * so an admin save that lands in the middle of a cycle is never overwritten by that cycle.
 *
 * The serialization point is the `ipos` row lock: `writeAdminFieldValue` locks the IPO's `ipos` row
 * FOR NO KEY UPDATE before it writes a value (to `ipos` or any child table) and its
 * `field_protection_metadata` row. A writer that takes the same lock first, then reads protection,
 * either (a) runs before the admin transaction starts — the admin then waits for it and writes
 * after — or (b) waits for the admin commit, and its protection read (a new READ COMMITTED
 * snapshot per statement) sees the new hold and drops the field. There is no third order.
 *
 * One lock statement and one protection read per write, however many rows: ids are batched.
 */
import { sql, type SQL } from 'drizzle-orm';
import { IpoHiddenError, scraperWriteBlockSqlColumns, scraperWriteBlockedRaw } from './scraper-write-block';

export interface FieldHold {
  /** `scraperWriteBlocked` (scraper-write-block.ts): locked OR hidden. */
  writeBlocked: boolean;
  /** An admin hid the row (§9.2 item 23): every table's write is dropped, whatever `honourScraperLock` says. */
  hidden: boolean;
  protectedFields: ReadonlySet<string>;
}

/** Keys a hold never removes: row identity and bookkeeping timestamps (admin cannot edit them either). */
export const NEVER_HELD_KEYS: ReadonlySet<string> = new Set(['id', 'ipoId', 'createdAt', 'updatedAt', 'lastUpdated']);

export const NO_HOLD: FieldHold = { writeBlocked: false, hidden: false, protectedFields: new Set() };

/**
 * `field_protection_metadata` has no row_key column (its unique key is table, field, ipo), so a
 * row's hold is recorded under `<table>:<rowKey>` — the convention the old update-field-record
 * route used (with the record id). No migration. Every writer and reader of a hold (the admin write
 * path, the row-aware writers, the field-plan walk) uses this one function; a singleton table's
 * hold stays under the bare table name.
 */
export function protectionTableName(tableName: string, rowKey: string): string {
  return rowKey === '' ? tableName : `${tableName}:${rowKey}`;
}

export interface HoldExecutor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/**
 * Pure: split a patch into what may be written and what an admin holds. `honourScraperLock` drops
 * every key when the IPO is write-blocked (the `ipos` table's own semantics, round 1). A HIDDEN row
 * drops every key on every table (§9.2 item 23, OD-150): the scraper writes nothing to it.
 */
export function dropHeldFields<T extends Record<string, unknown>>(
  patch: T,
  hold: FieldHold,
  opts: { honourScraperLock?: boolean } = {}
): { patch: Partial<T>; dropped: string[] } {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const held =
      !NEVER_HELD_KEYS.has(k) &&
      (hold.hidden || (opts.honourScraperLock === true && hold.writeBlocked) || hold.protectedFields.has(k));
    if (held) dropped.push(k);
    else kept[k] = v;
  }
  return { patch: kept as Partial<T>, dropped };
}

/**
 * Inside the caller's transaction: lock every named `ipos` row FOR NO KEY UPDATE (sorted, so two
 * writers never deadlock on each other), then read the protection rows for `tableName` in ONE
 * query. Returns a hold per IPO that exists; a missing IPO has no entry.
 */
export async function lockAndReadFieldHolds(
  tx: HoldExecutor,
  ipoIds: readonly string[],
  tableName: string
): Promise<Map<string, FieldHold>> {
  const ids = [...new Set(ipoIds)].sort();
  const holds = new Map<string, FieldHold>();
  if (ids.length === 0) return holds;
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const locked = await tx.execute(
    sql`SELECT id, ${scraperWriteBlockSqlColumns()} FROM ipos WHERE id IN (${idList}) ORDER BY id FOR NO KEY UPDATE`
  );
  const fields = new Map<string, Set<string>>();
  for (const r of locked.rows as Array<{ id: string } & Parameters<typeof scraperWriteBlockedRaw>[0]>) {
    fields.set(r.id, new Set());
    const b = scraperWriteBlockedRaw(r);
    holds.set(r.id, { writeBlocked: b.blocked, hidden: b.hidden, protectedFields: fields.get(r.id)! });
  }
  if (holds.size === 0) return holds;
  const prot = await tx.execute(sql`
    SELECT ipo_id, field_name FROM field_protection_metadata
    WHERE ipo_id IN (${idList}) AND table_name = ${tableName} AND is_protected = true`);
  for (const r of prot.rows as Array<{ ipo_id: string; field_name: string }>) fields.get(r.ipo_id)?.add(r.field_name);
  return holds;
}

/** Single-row form: lock + read + filter. `hold` is null when the IPO row does not exist. */
export async function filterPatchUnderHold<T extends Record<string, unknown>>(
  tx: HoldExecutor,
  ipoId: string,
  tableName: string,
  patch: T,
  opts: { honourScraperLock?: boolean } = {}
): Promise<{ patch: Partial<T>; dropped: string[]; hold: FieldHold | null }> {
  const hold = (await lockAndReadFieldHolds(tx, [ipoId], tableName)).get(ipoId) ?? null;
  // §9.2 item 23 (OD-150): a hidden row takes no insert and no update, whatever the caller does
  // with the filtered patch (an upsert inserts `values` whole). Refused here, inside the lock.
  if (hold?.hidden) throw new IpoHiddenError(`${tableName} write refused: IPO ${ipoId} is hidden (§9.2 item 23)`, ipoId);
  const { patch: kept, dropped } = dropHeldFields(patch, hold ?? NO_HOLD, opts);
  return { patch: kept, dropped, hold };
}

/** True when the filtered patch has nothing left to write besides bookkeeping keys. */
export function onlyBookkeeping(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).every((k) => NEVER_HELD_KEYS.has(k));
}

/**
 * Row-keyed tables (several rows per IPO, e.g. peer_companies keyed by normalized_name): an admin
 * hold is stored under `<table>:<rowKey>` (`protectionTableName` in admin-field-write.ts). Inside
 * the caller's transaction: lock the IPO's `ipos` row (the admin's lock), then read every row hold
 * for the table in ONE query. Returns rowKey -> held field names; `exists` is false when the IPO
 * row does not exist.
 */
export async function lockAndReadRowHolds(
  tx: HoldExecutor,
  ipoId: string,
  tableName: string
): Promise<{ exists: boolean; writeBlocked: boolean; hidden: boolean; rows: Map<string, Set<string>> }> {
  const rows = new Map<string, Set<string>>();
  const locked = await tx.execute(
    sql`SELECT id, ${scraperWriteBlockSqlColumns()} FROM ipos WHERE id = ${ipoId}::uuid FOR NO KEY UPDATE`
  );
  const lockRow = locked.rows[0] as Parameters<typeof scraperWriteBlockedRaw>[0] | undefined;
  if (!lockRow) return { exists: false, writeBlocked: false, hidden: false, rows };
  const block = scraperWriteBlockedRaw(lockRow);
  if (block.hidden) throw new IpoHiddenError(`${tableName} write refused: IPO ${ipoId} is hidden (§9.2 item 23)`, ipoId);
  const prefix = `${tableName}:`;
  const prot = await tx.execute(sql`
    SELECT table_name, field_name FROM field_protection_metadata
    WHERE ipo_id = ${ipoId}::uuid AND starts_with(table_name, ${prefix}) AND is_protected = true`);
  for (const r of prot.rows as Array<{ table_name: string; field_name: string }>) {
    const key = r.table_name.slice(prefix.length);
    if (!rows.has(key)) rows.set(key, new Set());
    rows.get(key)!.add(r.field_name);
  }
  return { exists: true, writeBlocked: block.blocked, hidden: block.hidden, rows };
}

/**
 * Pure: the rows a delete-and-reinsert writer may write when some stored rows carry admin holds.
 * An incoming row keeps the STORED value of every held field; a stored row with any hold that the
 * incoming list omits is kept whole (held rows survive a replace). Rows without holds are untouched.
 */
export function applyRowHolds<T extends Record<string, unknown>>(
  incoming: readonly T[],
  stored: readonly T[],
  holds: ReadonlyMap<string, ReadonlySet<string>>,
  keyField: string
): { rows: T[]; keptFields: Array<{ rowKey: string; field: string }>; keptRows: string[] } {
  const storedByKey = new Map(stored.map((r) => [String(r[keyField]), r]));
  const keptFields: Array<{ rowKey: string; field: string }> = [];
  const seen = new Set<string>();
  const rows = incoming.map((row) => {
    const key = String(row[keyField]);
    seen.add(key);
    const held = holds.get(key);
    const prior = storedByKey.get(key);
    if (!held || !prior) return row;
    const out: Record<string, unknown> = { ...row };
    for (const f of held) {
      if (NEVER_HELD_KEYS.has(f) || f === keyField) continue;
      out[f] = prior[f];
      keptFields.push({ rowKey: key, field: f });
    }
    return out as T;
  });
  const keptRows: string[] = [];
  for (const [key, fields] of holds) {
    if (seen.has(key) || fields.size === 0) continue;
    const prior = storedByKey.get(key);
    if (!prior) continue;
    rows.push(prior);
    keptRows.push(key);
  }
  return { rows, keptFields, keptRows };
}

/**
 * A repair tool's write that an admin hold dropped (§9.2 item 19). Thrown inside the repair's own
 * transaction so the whole row rolls back — value, provenance and plan rows together — and the tool
 * counts the row as "held by admin, skipped", never as repaired (OD-131: the ADMIN row stays).
 */
export class HeldByAdminError extends Error {
  constructor(
    readonly ipoId: string,
    readonly dropped: readonly string[]
  ) {
    super(`held by admin, skipped: ${ipoId} (${dropped.join(', ')})`);
    this.name = 'HeldByAdminError';
  }
}

/** Throws `HeldByAdminError` when a repair helper reports any dropped field. */
export function assertNotHeld(result: { dropped: readonly string[] }, ipoId: string): void {
  if (result.dropped.length > 0) throw new HeldByAdminError(ipoId, result.dropped);
}
