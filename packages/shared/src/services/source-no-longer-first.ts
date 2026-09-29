/**
 * OD-142 (§2.8, §9.2 item 18): after a plan rebuild changes a still-applicable field's rank-1
 * source, the stored value is KEPT on the page (its provenance untouched) and listed in the admin
 * queue as "source no longer first" until the new rank-1 source answers; that answer then replaces
 * it by the normal walk.
 *
 * The queue item reuses the OD-63 queue's own row shape (a `data_conflicts` row, like OD-107 list
 * suggestions and item 9 newer-document suggestions): `resolution_reason = SOURCE_NO_LONGER_FIRST`
 * on an UNRESOLVED row marks it admin-list-only (never a dispute, never an alert), `source1/value1`
 * are the kept value and the source it came from, `source2` the new rank-1 source (value2 NULL: it
 * has not answered yet), `evidence` names the old and new rank-1 codes.
 *
 * One OPEN item per (IPO, table, row, field): every insert first resolves any open one for the same
 * field (superseded), and runs inside the admin transaction that holds the `ipos` row lock, so two
 * rebuilds cannot interleave. Repeated walks never insert (only a rebuild does). The item clears:
 *   - when the new rank-1 source answers (the walk records SUPPLIED from that source):
 *     `ipo-field-plan-repository.ts` recordOutcome -> RANK1_ANSWERED;
 *   - when a later rebuild drops the field (not applicable any more) or moves rank 1 again: SUPERSEDED;
 *   - when an admin saves a value on that field (it is the admin's now, §2.7): ADMIN_SAVED.
 */
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema';
import { SOURCE_NO_LONGER_FIRST } from '../utils/conflict-reasons';

type Db = NodePgDatabase<typeof schema>;

export { SOURCE_NO_LONGER_FIRST };
export const SOURCE_NO_LONGER_FIRST_LABEL = 'source no longer first';

/** How a queue item left the queue (stored in admin_note; resolution_reason keeps the marker). */
export type SourceNoLongerFirstClear = 'RANK1_ANSWERED' | 'SUPERSEDED' | 'ADMIN_SAVED';

/** A plan code as the `scraper_source` enum spells it (the manifest's DOC is stored as DRHP). */
export function planSourceToScraperSource(code: string | null): string | null {
  if (code === null) return null;
  return code === 'DOC' ? 'DRHP' : code;
}

const SCRAPER_SOURCES = new Set(['ADMIN', 'DRHP', 'NSE', 'BSE', 'API_FALLBACK', 'MONEYCONTROL', 'CHITTORGARH', 'INVESTORGAIN_GMP', 'REG']);

/** `ipo_field_plan` field names are SQL snake_case; `data_conflicts` and `field_sources` are camelCase. */
export function columnToCamel(field: string): string {
  return field.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export interface RankOneChange {
  tableName: string;
  /** SQL column name, as `ipo_field_plan.field_name` stores it. */
  fieldName: string;
  rowKey: string;
  oldRank1: string | null;
  newRank1: string;
}

export interface QueueResult {
  queued: number;
  /** Not queued: the field holds no value (it is simply missing), or an admin holds it (§2.7). */
  skippedEmpty: number;
  skippedHeld: number;
  /** Not queued: the kept value's own source IS the new rank 1. */
  skippedFromNewRank1: number;
}

function rowsOf(r: unknown): Array<Record<string, unknown>> {
  return ((r as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
}

/** Resolve the open items for these (table, rowKey, camelField) keys of one IPO. */
async function clearOpen(
  db: Db,
  ipoId: string,
  keys: Array<{ tableName: string; rowKey: string; fieldName: string }>,
  how: SourceNoLongerFirstClear,
  extra?: { onlyWhenNewRank1Is?: string }
): Promise<number> {
  if (keys.length === 0) return 0;
  const values = sql.join(
    keys.map((k) => sql`(${k.tableName}::text, ${k.rowKey}::text, ${columnToCamel(k.fieldName)}::text)`),
    sql`, `
  );
  const res = await db.execute(sql`
    UPDATE data_conflicts c
       SET resolved_at = now(), resolved_by = 'SYSTEM', admin_note = ${`OD-142 ${how}`}
      FROM (VALUES ${values}) AS k(table_name, row_key, field_name)
     WHERE c.ipo_id = ${ipoId}::uuid
       AND c.resolved_at IS NULL
       AND c.resolution_reason = ${SOURCE_NO_LONGER_FIRST}
       AND c.table_name = k.table_name AND c.row_key = k.row_key AND c.field_name = k.field_name
       AND (${extra?.onlyWhenNewRank1Is ?? null}::text IS NULL OR c.evidence->>'newRank1' = ${extra?.onlyWhenNewRank1Is ?? null}::text)
    RETURNING c.id`);
  return rowsOf(res).length;
}

/**
 * The fields a rebuild DROPPED (the corrected type no longer plans them) lose any open item: a
 * not-applicable field is not a queue item (item 18).
 */
export async function clearSourceNoLongerFirstForDropped(
  tx: Db,
  ipoId: string,
  dropped: Array<{ tableName: string; rowKey: string; fieldName: string }>
): Promise<number> {
  return clearOpen(tx, ipoId, dropped, 'SUPERSEDED');
}

/**
 * Inside the admin transaction (the `ipos` row is locked): queue one item per changed field that
 * still holds a value and is not admin-held, superseding any open item for the same field.
 */
export async function queueSourceNoLongerFirstInTx(tx: Db, ipoId: string, changes: RankOneChange[]): Promise<QueueResult> {
  const result: QueueResult = { queued: 0, skippedEmpty: 0, skippedHeld: 0, skippedFromNewRank1: 0 };
  if (changes.length === 0) return result;
  await clearOpen(tx, ipoId, changes, 'SUPERSEDED');

  // Which (table, column) pairs really exist: the plan's keys come from the manifest, and a
  // manifest column the database does not have is never interpolated into SQL.
  const tables = [...new Set(changes.map((c) => c.tableName))];
  const colRes = await tx.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN (${sql.join(tables.map((t) => sql`${t}`), sql`, `)})`);
  const existing = new Set(rowsOf(colRes).map((r) => `${r.table_name}.${r.column_name}`));

  for (const ch of changes) {
    const camel = columnToCamel(ch.fieldName);
    // §2.7: an admin value outranks every source, so a rank-1 change says nothing about it.
    const heldRes = await tx.execute(sql`
      SELECT 1 FROM field_sources
       WHERE ipo_id = ${ipoId}::uuid AND table_name = ${ch.tableName} AND row_key = ${ch.rowKey}
         AND field_name = ${camel} AND source = 'ADMIN'
      UNION ALL
      SELECT 1 FROM field_protection_metadata
       WHERE ipo_id = ${ipoId}::uuid AND field_name = ${camel} AND is_protected = true AND manually_edited_at IS NOT NULL
         AND table_name = ${ch.rowKey === '' ? ch.tableName : `${ch.tableName}:${ch.rowKey}`}
      LIMIT 1`);
    if (rowsOf(heldRes).length > 0) {
      result.skippedHeld++;
      continue;
    }
    if (!existing.has(`${ch.tableName}.${ch.fieldName}`)) {
      result.skippedEmpty++;
      continue;
    }
    const valRes = await tx.execute(sql`
      SELECT ${sql.identifier(ch.fieldName)}::text AS v FROM ${sql.identifier(ch.tableName)}
       WHERE ${sql.identifier(ch.tableName === 'ipos' ? 'id' : 'ipo_id')} = ${ipoId}::uuid
         AND ${sql.identifier(ch.fieldName)} IS NOT NULL LIMIT 1`);
    const stored = rowsOf(valRes)[0]?.v;
    if (stored === undefined || stored === null) {
      // Nothing is kept, so nothing is "no longer first": the re-planted PENDING row is the
      // ordinary missing-value path.
      result.skippedEmpty++;
      continue;
    }
    // The value's provenance is read, never re-attributed: source1 is where the kept value came from.
    const fsRes = await tx.execute(sql`
      SELECT source::text AS source FROM field_sources
       WHERE ipo_id = ${ipoId}::uuid AND table_name = ${ch.tableName} AND row_key = ${ch.rowKey} AND field_name = ${camel}
       LIMIT 1`);
    const provenance = (rowsOf(fsRes)[0]?.source as string | undefined) ?? null;
    const oldAsSource = planSourceToScraperSource(ch.oldRank1);
    if (provenance !== null && provenance === planSourceToScraperSource(ch.newRank1)) {
      // The kept value already came from the new rank-1 source (e.g. a correction undone): it is
      // first, not "no longer first".
      result.skippedFromNewRank1++;
      continue;
    }
    const source1 = provenance ?? (oldAsSource && SCRAPER_SOURCES.has(oldAsSource) ? oldAsSource : null);
    const source2 = planSourceToScraperSource(ch.newRank1);
    if (source1 === null || source2 === null || !SCRAPER_SOURCES.has(source2)) {
      // Unreachable with today's manifest (DOC, NSE, BSE, CHITTORGARH, REG); refuse loudly rather
      // than store a row the enum cannot hold.
      throw new Error(
        `queueSourceNoLongerFirstInTx: cannot label ${ch.tableName}.${ch.fieldName} (kept from ${String(provenance ?? ch.oldRank1)}, new rank 1 ${ch.newRank1})`
      );
    }
    await tx.execute(sql`
      INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2,
                                  resolution_reason, severity, evidence)
      VALUES (${ipoId}::uuid, ${ch.tableName}, ${ch.rowKey}, ${camel}, ${source1}::scraper_source, ${String(stored)},
              ${source2}::scraper_source, NULL, ${SOURCE_NO_LONGER_FIRST}, 'INFO',
              ${JSON.stringify({ origin: SOURCE_NO_LONGER_FIRST, oldRank1: ch.oldRank1, newRank1: ch.newRank1, keptFrom: provenance })}::jsonb)`);
    result.queued++;
  }
  return result;
}

/**
 * The new rank-1 source answered for this field (the walk recorded SUPPLIED from it): its open
 * item leaves the queue. Only an answer from the item's OWN new rank 1 clears it.
 */
export async function clearSourceNoLongerFirstOnRankOneAnswer(
  db: Db,
  args: { ipoId: string; tableName: string; rowKey: string; fieldName: string; answeredBy: string }
): Promise<number> {
  return clearOpen(db, args.ipoId, [args], 'RANK1_ANSWERED', { onlyWhenNewRank1Is: args.answeredBy });
}

/** An admin saved a value on this field: it is the admin's now (§2.7), so its open item leaves the queue. */
export async function clearSourceNoLongerFirstOnAdminSave(
  tx: Db,
  args: { ipoId: string; tableName: string; rowKey: string; fieldName: string }
): Promise<number> {
  return clearOpen(tx, args.ipoId, [args], 'ADMIN_SAVED');
}
