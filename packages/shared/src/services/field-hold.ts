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

export interface FieldHold {
  scraperLocked: boolean;
  protectedFields: ReadonlySet<string>;
}

/** Keys a hold never removes: row identity and bookkeeping timestamps (admin cannot edit them either). */
export const NEVER_HELD_KEYS: ReadonlySet<string> = new Set(['id', 'ipoId', 'createdAt', 'updatedAt', 'lastUpdated']);

export const NO_HOLD: FieldHold = { scraperLocked: false, protectedFields: new Set() };

export interface HoldExecutor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/**
 * Pure: split a patch into what may be written and what an admin holds. `honourScraperLock` drops
 * every key when the IPO carries `scraper_locked` (the `ipos` table's own semantics, round 1).
 */
export function dropHeldFields<T extends Record<string, unknown>>(
  patch: T,
  hold: FieldHold,
  opts: { honourScraperLock?: boolean } = {}
): { patch: Partial<T>; dropped: string[] } {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const held = !NEVER_HELD_KEYS.has(k) && ((opts.honourScraperLock === true && hold.scraperLocked) || hold.protectedFields.has(k));
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
  const locked = await tx.execute(sql`SELECT id, scraper_locked FROM ipos WHERE id IN (${idList}) ORDER BY id FOR NO KEY UPDATE`);
  const fields = new Map<string, Set<string>>();
  for (const r of locked.rows as Array<{ id: string; scraper_locked: boolean | null }>) {
    fields.set(r.id, new Set());
    holds.set(r.id, { scraperLocked: r.scraper_locked === true, protectedFields: fields.get(r.id)! });
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
  const { patch: kept, dropped } = dropHeldFields(patch, hold ?? NO_HOLD, opts);
  return { patch: kept, dropped, hold };
}

/** True when the filtered patch has nothing left to write besides bookkeeping keys. */
export function onlyBookkeeping(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).every((k) => NEVER_HELD_KEYS.has(k));
}
