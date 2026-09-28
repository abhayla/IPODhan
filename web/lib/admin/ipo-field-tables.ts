/**
 * Which dynamic-editor tables hold an IPO's field values (spec §9.2 items 3, 11; F-170).
 * The dynamic editor may not write those directly: a one-row-per-IPO table (`ipos` and the child
 * tables `ADMIN_WRITABLE_TABLES` lists) saves through the ONE admin write; any other table with an
 * `ipo_id` column (lists such as peers, anchors, documents) is refused and names the editor.
 */
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { ADMIN_WRITABLE_TABLES } from '@ipodhan/shared/services/admin-field-write';

export function sqlTableName(table: PgTable): string {
  return getTableName(table);
}

/** `ipos` or a one-row-per-IPO child table: saved field by field through the admin write. */
export function isAdminWritableTable(table: PgTable): boolean {
  return (ADMIN_WRITABLE_TABLES as readonly string[]).includes(getTableName(table));
}

/** Any table that holds IPO data (`ipos` itself or anything keyed by `ipoId`). */
export function holdsIpoFieldValues(table: PgTable): boolean {
  return getTableName(table) === 'ipos' || 'ipoId' in getTableColumns(table);
}

export const IPO_FIELD_TABLE_REFUSAL =
  'this table holds IPO field values; they are saved one field at a time through the admin field editor (spec §9.2 items 3, 11), never by a direct row write';

/** Keys a dynamic-editor save may carry that are not columns. */
export const SAVE_META_KEYS = ['versions', 'sourceNote', 'overrideReason'] as const;
