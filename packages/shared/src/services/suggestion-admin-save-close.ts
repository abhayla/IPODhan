/**
 * #1300, spec §9.2 items 9 and 25 (clarified 2026-10-01): an OPEN document suggestion (item 9's
 * newer-document row, or an OD-90 corrigendum row) closes by itself ONLY when the admin saves the
 * field to the value the suggestion proposes: the admin has accepted it by hand in the editor.
 * A save of any other value leaves it open (the document still disagrees with the admin). A decided
 * row (accepted, dismissed, or closed here) is never reopened (item 25).
 *
 * Runs inside `writeAdminFieldValue`'s transaction, so the close commits with the save. An accept
 * from the queue claims its own row before it writes, so this only closes the OTHER open rows on the
 * same field that propose the same value (another document printing it).
 *
 * The origins are spelled out here instead of imported: corrigendum-suggestions imports
 * admin-field-write, which imports this file. `suggestion-admin-save-close.test.ts` pins them equal.
 */
import { and, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { dataConflicts } from '../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** `data_conflicts.resolution_reason` of a suggestion the admin accepted by saving its value in the editor. */
export const ACCEPTED_BY_ADMIN_EDIT = 'ACCEPTED_BY_ADMIN_EDIT';

/** The `evidence.origin` values of a field suggestion (NEWER_DOCUMENT_ORIGIN, CORRIGENDUM_ORIGIN). */
export const FIELD_SUGGESTION_ORIGINS = ['NEWER_DOCUMENT', 'CORRIGENDUM'] as const;

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/**
 * The text a suggestion stores its proposed value as (scraper `normalizeReceiptValue`, OD-91 / OD-73):
 * numbers by value ("10.00" = 10), dates by calendar day, objects as key-sorted JSON. The scraper
 * test `suggestion-value-normalizer-parity.test.ts` holds the two equal on a shared table of values.
 */
export function normalizeSuggestionValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return JSON.stringify(sortKeysDeep(v));
  const s = String(v).trim();
  if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
  if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z?)?$/.test(s)) return s.slice(0, 10);
  return s;
}

/** Close every OPEN field suggestion on this field whose proposed value equals the saved value. */
export async function closeSuggestionsAcceptedByAdminSave(
  tx: Db,
  args: { ipoId: string; tableName: string; rowKey: string; fieldName: string; savedValue: unknown; adminName: string }
): Promise<string[]> {
  const saved = normalizeSuggestionValue(args.savedValue);
  if (saved === null) return [];
  const closed = await tx
    .update(dataConflicts)
    .set({
      resolvedSource: 'ADMIN',
      resolutionReason: ACCEPTED_BY_ADMIN_EDIT,
      resolvedBy: args.adminName,
      resolvedAt: sql`now()`,
      adminNote: 'closed: the admin saved this value in the field editor (#1300)',
    })
    .where(
      and(
        eq(dataConflicts.ipoId, args.ipoId),
        isNull(dataConflicts.resolvedAt),
        isNotNull(dataConflicts.suggestionKey),
        eq(dataConflicts.tableName, args.tableName),
        eq(dataConflicts.rowKey, args.rowKey),
        eq(dataConflicts.fieldName, args.fieldName),
        inArray(sql`${dataConflicts.evidence}->>'origin'`, [...FIELD_SUGGESTION_ORIGINS]),
        eq(dataConflicts.value2, saved)
      )
    )
    .returning({ id: dataConflicts.id });
  return closed.map((r) => r.id);
}
