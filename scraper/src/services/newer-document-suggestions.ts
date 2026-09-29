/**
 * §9.2 item 9 (follows from OD-102, OD-107, OD-63, OD-66): "When a document read after an admin
 * save supplies a different value for an admin-held field, the admin value stays; the document's
 * value is stored as a witness and listed in the admin queue (§9.4) as a suggestion with the
 * document and page. Nothing is overwritten."
 *
 * This is the walk's `onHeldFieldAnswers` seam for item 9 (the walk calls it after every read of a
 * held field). It INSERTS suggestion rows and nothing else: the field is written only when an admin
 * accepts one (`acceptCorrigendumSuggestion`, the OD-90 path, through `writeAdminFieldValue`).
 *
 * Which documents: every COMPLETED document of this IPO whose own receipt
 * (`document_field_receipts`, what THAT document printed for the field) holds a value, first seen
 * (`documents.created_at`) AFTER the admin's save. A document first seen before the save is never
 * suggested: the admin decided after it existed. A value equal to the admin value (same
 * normalisation as the receipts, `normalizeReceiptValue`) is agreement, not a suggestion.
 *
 * The admin's save time is the ADMIN field_sources row's `updated_at` (the walk's witness refresh
 * never moves it); a hold with no ADMIN row falls back to the protection row's edit time.
 *
 * Item 25: one row per (document, table, row key, field), ever (`newerDocumentSuggestionKey`, the
 * unique `suggestion_key`, ON CONFLICT DO NOTHING). A dismissed one never returns for that
 * document; a different newer document is judged on its own receipt (OD-66).
 *
 * Page: F-205 — `document_field_receipts` has no page column, so the suggestion names the document
 * and records `page: null` with the reason. Independent of ENABLE_VERDICT_WRITER: with the flag off
 * the witness is not stored, but the suggestion (which carries the value and the document itself)
 * still is.
 */
import { sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { readAdminFieldVersion, protectionTableName } from '@ipodhan/shared/services/admin-field-write';
import { NEWER_DOCUMENT_ORIGIN, newerDocumentSuggestionKey } from '@ipodhan/shared/services/corrigendum-suggestions';
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { normalizeReceiptValue } from '../../config/plan-supersession-rule.mjs';

type Db = {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
  insert: (...args: any[]) => any;
};

export interface NewerDocumentSuggestionResult {
  /** Newer documents whose receipt printed a value for the field. */
  newerDocuments: number;
  /** Of those, how many printed the admin value (no suggestion). */
  equal: number;
  inserted: number;
  /** Already suggested (open, accepted or dismissed) for that document. */
  duplicates: number;
  ids: string[];
}

function rowsOf(r: unknown): Array<Record<string, unknown>> {
  const rows = (r as { rows?: unknown[] })?.rows ?? (Array.isArray(r) ? r : []);
  return rows as Array<Record<string, unknown>>;
}

export async function recordNewerDocumentSuggestions(
  db: Db,
  args: { ipoId: string; tableName: string; rowKey: string; fieldName: string }
): Promise<NewerDocumentSuggestionResult> {
  const field = columnToCamelCase(args.fieldName);
  const rowKey = args.rowKey ?? '';
  const result: NewerDocumentSuggestionResult = { newerDocuments: 0, equal: 0, inserted: 0, duplicates: 0, ids: [] };

  const docs = rowsOf(
    await db.execute(sql`
      WITH save AS (
        SELECT coalesce(
          (SELECT fs.updated_at FROM field_sources fs
            WHERE fs.ipo_id = ${args.ipoId}::uuid AND fs.table_name = ${args.tableName}
              AND fs.row_key = ${rowKey} AND fs.field_name = ${field} AND fs.source = 'ADMIN'),
          (SELECT max(coalesce(p.manually_edited_at, p.updated_at)) FROM field_protection_metadata p
            WHERE p.ipo_id = ${args.ipoId}::uuid AND p.table_name = ${protectionTableName(args.tableName, rowKey)}
              AND p.field_name = ${field} AND p.is_protected)
        ) AS at
      )
      SELECT d.id::text AS document_id, d.type::text AS document_type, d.title AS document_title,
             d.created_at::text AS first_seen_at, save.at::text AS saved_at, r.value
        FROM document_field_receipts r
        JOIN documents d ON d.id = r.document_id
        CROSS JOIN save
       WHERE d.ipo_id = ${args.ipoId}::uuid
         AND d.extraction_status = 'COMPLETED'
         AND r.table_name = ${args.tableName} AND r.row_key = ${rowKey} AND r.field_name = ${field}
         AND r.value IS NOT NULL
         AND save.at IS NOT NULL
         AND d.created_at > save.at
       ORDER BY d.created_at, d.id`)
  );
  result.newerDocuments = docs.length;
  if (docs.length === 0) return result;

  const current = await readAdminFieldVersion(db as never, args.ipoId, args.tableName, field, rowKey ? { rowKey } : undefined);
  const adminValue = normalizeReceiptValue(current?.currentValue ?? null);

  for (const d of docs) {
    const documentValue = String(d.value);
    if (documentValue === adminValue) {
      result.equal++;
      continue;
    }
    const documentId = String(d.document_id);
    const rows = await db
      .insert(schema.dataConflicts)
      .values({
        ipoId: args.ipoId,
        tableName: args.tableName,
        rowKey,
        fieldName: field,
        source1: 'ADMIN',
        value1: adminValue,
        // The document label every filing writes under (filing-persister SOURCE ENUM NOTE).
        source2: 'DRHP',
        value2: documentValue,
        severity: 'WARNING',
        resolutionReason: null,
        documentId,
        suggestionKey: newerDocumentSuggestionKey(documentId, args.tableName, rowKey, field),
        evidence: {
          origin: NEWER_DOCUMENT_ORIGIN,
          documentType: d.document_type,
          documentTitle: d.document_title,
          documentFirstSeenAt: d.first_seen_at,
          adminSavedAt: d.saved_at,
          page: null,
          pageUnknownReason: 'F-205: document_field_receipts has no page column',
        },
      })
      .onConflictDoNothing({ target: schema.dataConflicts.suggestionKey })
      .returning({ id: schema.dataConflicts.id });
    if (rows.length > 0) {
      result.inserted++;
      result.ids.push(rows[0].id);
    } else {
      result.duplicates++;
    }
  }
  return result;
}

