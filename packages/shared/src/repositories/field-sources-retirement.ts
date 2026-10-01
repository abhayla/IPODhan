/**
 * OD-157 (#1166 item 3): the source records of a child row that a replacing source set deleted.
 *
 * They are KEPT, never deleted with the row, but they leave `field_sources`: each record moves to
 * `field_sources_retired` with the time and the reason (which set replaced the row). Every reader of
 * `field_sources` (admin provenance view, nightly audits, the walk) therefore skips a deleted row's
 * provenance by construction - no reader has to remember a filter.
 *
 * Call it inside the SAME transaction as the delete, so a rolled-back replace never retires the
 * records of a row that still exists.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';

export interface RetireChildRowSourcesInput {
  ipoId: string;
  /** The child table, e.g. 'peer_companies'. */
  tableName: string;
  /** Row keys of the deleted rows (the table's natural key, as filed in field_sources.row_key). */
  rowKeys: readonly string[];
  /** Which set replaced the row, e.g. "OD-156: dropped by the RHP peer list (document <id>)". */
  reason: string;
}

/** One retired record's address: what a caller needs to drop its provenance cache keys after commit. */
export interface RetiredSourceRef {
  tableName: string;
  rowKey: string;
  fieldName: string;
}

/** Returns the retired records' addresses (empty when nothing was retired). */
export async function retireChildRowSources(
  tx: NodePgDatabase<typeof schema>,
  input: RetireChildRowSourcesInput
): Promise<RetiredSourceRef[]> {
  // '' is the singleton sentinel (one row per IPO): never a deleted child row's key.
  const keys = [...new Set(input.rowKeys)].filter((k) => k !== '');
  if (keys.length === 0) return [];
  const records = await tx
    .select()
    .from(schema.fieldSources)
    .where(
      and(
        eq(schema.fieldSources.ipoId, input.ipoId),
        eq(schema.fieldSources.tableName, input.tableName),
        ne(schema.fieldSources.rowKey, ''),
        inArray(schema.fieldSources.rowKey, keys)
      )
    );
  if (records.length === 0) return [];
  await tx.insert(schema.fieldSourcesRetired).values(
    records.map((r) => ({
      ipoId: r.ipoId,
      tableName: r.tableName,
      rowKey: r.rowKey,
      fieldName: r.fieldName,
      source: r.source,
      record: r as unknown as Record<string, unknown>,
      retiredAt: sql`now()`,
      retiredReason: input.reason,
    }))
  );
  await tx.delete(schema.fieldSources).where(
    inArray(
      schema.fieldSources.id,
      records.map((r) => r.id)
    )
  );
  return records.map((r) => ({ tableName: r.tableName, rowKey: r.rowKey, fieldName: r.fieldName }));
}
