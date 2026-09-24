/**
 * Item 6 — a better document reopens the plan rows chosen from a worse one
 * (spec docs/design/data-sourcing-pull-model.md §2.5, §2.5.1 trigger 3,
 * §2.5.5 rules 1 and 3, OD-65, OD-90; F-164).
 *
 * The rule itself is the pure comparator `findPlanRowSupersessor`
 * (document-state-machine.ts). This module is the one place that reads its
 * inputs from the database, so the extraction write path, the repair tool
 * (`scraper/scripts/repair-superseded-plan-rows.ts`) and their tests all
 * evaluate the same rows the same way.
 */
import { sql } from 'drizzle-orm';
import {
  decidePlanRowSupersession,
  findPlanRowSupersessor,
  isFixedPriceIssue,
  type PlanDocumentRef,
} from './document-state-machine.js';
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { IpoFieldPlanRepository } from '@ipodhan/shared/repositories';
import { logger } from '../utils/logger.js';
import { familyForField } from '../../config/plan-supersession-rule.mjs';
import { loadFieldManifest } from '../config/field-manifest-loader.js';

export interface ExecuteLike {
  execute: (query: any) => Promise<any>;
}

export interface SuppliedPlanRow {
  planRowId: string;
  ipoId: string;
  ipoSlug: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  chosen: PlanDocumentRef;
  fixedPrice: boolean;
}

/** `${tableName}|${rowKey}|${camelFieldName}` — the receipt key. */
export function receiptKey(tableName: string, rowKey: string, fieldName: string): string {
  return `${tableName}|${rowKey ?? ''}|${columnToCamelCase(fieldName)}`;
}

export interface SupersessionInputs {
  rows: SuppliedPlanRow[];
  candidatesByIpo: Map<string, PlanDocumentRef[]>;
  /** document id -> (receipt key -> normalised value). Empty for documents extracted before OD-91. */
  receipts: Map<string, Map<string, string | null>>;
}

export interface SupersessionVerdict {
  row: SuppliedPlanRow;
  supersededBy: PlanDocumentRef;
  reason: string;
}

export interface SupersessionEvaluation {
  reopen: SupersessionVerdict[];
  /** Rows kept because a same-type candidate had no filing_date (logged with ids). */
  unordered: Array<{ row: SuppliedPlanRow; documentIds: string[] }>;
  examined: number;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}

function dateText(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * SUPPLIED plan rows with a chosen document, and every COMPLETED active
 * document of the same IPOs. `ipoId` scopes both to one IPO (the write path);
 * omitted, the whole table (the repair tool / audit).
 */
export async function loadSupersessionInputs(
  exec: ExecuteLike,
  ipoId?: string,
  opts: { planRowId?: string } = {}
): Promise<SupersessionInputs> {
  const ipoFilter = ipoId ? sql`AND p.ipo_id = ${ipoId}::uuid` : sql``;
  // #968 fix round 1: one named row whatever its state (an override-reopened row is PENDING).
  const rowFilter = opts.planRowId ? sql`p.id = ${opts.planRowId}::uuid` : sql`p.state = 'SUPPLIED'`;
  const planRes = await exec.execute(sql`
    SELECT p.id, p.ipo_id, i.slug, p.table_name, p.row_key, p.field_name,
           d.id AS doc_id, d.type::text AS doc_type, d.filing_date::text AS filing_date, d.sha256,
           det.issue_type::text AS issue_type, i.price_range_min, i.price_range_max
      FROM ipo_field_plan p
      JOIN documents d ON d.id = p.chosen_document_id
      JOIN ipos i ON i.id = p.ipo_id
      LEFT JOIN ipo_details det ON det.ipo_id = p.ipo_id
     WHERE ${rowFilter} ${ipoFilter}
     ORDER BY i.slug, p.table_name, p.field_name, p.row_key
  `);
  const rows: SuppliedPlanRow[] = rowsOf(planRes).map((r) => ({
    planRowId: String(r.id),
    ipoId: String(r.ipo_id),
    ipoSlug: (r.slug as string) ?? null,
    tableName: String(r.table_name),
    rowKey: String(r.row_key ?? ''),
    fieldName: String(r.field_name),
    chosen: {
      id: String(r.doc_id),
      docType: String(r.doc_type),
      filingDate: dateText(r.filing_date),
      sha256: (r.sha256 as string) ?? null,
    },
    fixedPrice: isFixedPriceIssue(
      (r.issue_type as string) ?? null,
      r.price_range_min == null ? null : Number(r.price_range_min),
      r.price_range_max == null ? null : Number(r.price_range_max)
    ),
  }));

  const docFilter = ipoId ? sql`AND d.ipo_id = ${ipoId}::uuid` : sql``;
  const docRes = await exec.execute(sql`
    SELECT d.id, d.ipo_id, d.type::text AS doc_type, d.filing_date::text AS filing_date, d.sha256
      FROM documents d
     WHERE d.extraction_status = 'COMPLETED' AND d.is_active IS NOT FALSE ${docFilter}
     ORDER BY d.ipo_id, d.uploaded_at, d.id
  `);
  const candidatesByIpo = new Map<string, PlanDocumentRef[]>();
  for (const r of rowsOf(docRes)) {
    const list = candidatesByIpo.get(String(r.ipo_id)) ?? [];
    list.push({
      id: String(r.id),
      docType: String(r.doc_type),
      filingDate: dateText(r.filing_date),
      sha256: (r.sha256 as string) ?? null,
    });
    candidatesByIpo.set(String(r.ipo_id), list);
  }
  const receipts = new Map<string, Map<string, string | null>>();
  // Probe first: this module runs against databases that may predate 0060.
  const probe = rowsOf(await exec.execute(sql`SELECT to_regclass('public.document_field_receipts')::text AS t`));
  if (probe[0]?.t) {
    const recRes = await exec.execute(sql`
      SELECT r.document_id, r.table_name, r.row_key, r.field_name, r.value
        FROM document_field_receipts r
        JOIN documents d ON d.id = r.document_id
       WHERE d.extraction_status = 'COMPLETED' ${docFilter}
    `);
    for (const r of rowsOf(recRes)) {
      const m = receipts.get(String(r.document_id)) ?? new Map<string, string | null>();
      m.set(receiptKey(String(r.table_name), String(r.row_key ?? ''), String(r.field_name)), (r.value as string) ?? null);
      receipts.set(String(r.document_id), m);
    }
  }
  return { rows, candidatesByIpo, receipts };
}

/** The manifest's documentType for a plan row's field, or undefined. */
export function manifestDocumentTypeOf(tableName: string, fieldName: string): string | undefined {
  return loadFieldManifest().fields[`${tableName}.${fieldName}`]?.documentType;
}

/**
 * The field's document family: the manifest documentType's family, or — for a
 * field with no documentType — the chosen document's own type only (a
 * same-type later filing still supersedes; no other type is assumed to carry
 * the field).
 */
export function familyFor(row: SuppliedPlanRow, docTypeOf = manifestDocumentTypeOf): readonly string[] {
  return familyForField(docTypeOf(row.tableName, row.fieldName), row.chosen.docType);
}

/**
 * OD-91: a document is a candidate for a field only when its OWN receipt has
 * that field. A document with no receipt (extracted before OD-91) is never a
 * supersessor, so rows chosen before receipts existed do not churn.
 */
export function evaluateSupersession(
  inputs: SupersessionInputs,
  docTypeOf = manifestDocumentTypeOf
): SupersessionEvaluation {
  const reopen: SupersessionVerdict[] = [];
  const unordered: SupersessionEvaluation['unordered'] = [];
  for (const row of inputs.rows) {
    const key = receiptKey(row.tableName, row.rowKey, row.fieldName);
    const candidates = (inputs.candidatesByIpo.get(row.ipoId) ?? []).filter((d) => inputs.receipts.get(d.id)?.has(key));
    const result = findPlanRowSupersessor(row.chosen, candidates, {
      family: familyFor(row, docTypeOf),
      fixedPrice: row.fixedPrice,
    });
    if (result.supersededBy) reopen.push({ row, supersededBy: result.supersededBy, reason: result.reason });
    else if (result.unordered.length > 0) unordered.push({ row, documentIds: result.unordered.map((d) => d.id) });
  }
  return { reopen, unordered, examined: inputs.rows.length };
}

/**
 * The write-path half (spec §2.5; OD-91): called inside the transaction that
 * marks `document` COMPLETED, after its receipt is written. Reopens only the
 * SUPPLIED rows of the same IPO whose chosen document THIS document outranks
 * (decidePlanRowSupersession) AND whose field is in this document's receipt.
 */
export async function reopenPlanRowsForCompletedDocument(
  tx: ExecuteLike,
  document: PlanDocumentRef & { ipoId: string },
  receipt: ReadonlyArray<{ tableName: string; rowKey: string; fieldName: string }>,
  docTypeOf = manifestDocumentTypeOf
): Promise<{ reopenedIds: string[]; unordered: string[] }> {
  if (receipt.length === 0) return { reopenedIds: [], unordered: [] };
  const keys = new Set(receipt.map((r) => receiptKey(r.tableName, r.rowKey, r.fieldName)));
  const { rows } = await loadSupersessionInputs(tx, document.ipoId);
  const toReopen: Array<{ planRowId: string; expectedChosenDocumentId: string; supersededBy: string; cause: string }> = [];
  const identities: string[] = [];
  const unordered: string[] = [];
  for (const row of rows) {
    if (!keys.has(receiptKey(row.tableName, row.rowKey, row.fieldName))) continue;
    const d = decidePlanRowSupersession(row.chosen, document, { family: familyFor(row, docTypeOf), fixedPrice: row.fixedPrice });
    if (d.supersede) {
      toReopen.push({
        planRowId: row.planRowId,
        expectedChosenDocumentId: row.chosen.id,
        supersededBy: document.id,
        cause: `superseded by ${document.docType} ${document.id}: ${d.reason}`,
      });
      identities.push(`${row.tableName}.${row.fieldName}${row.rowKey ? `[${row.rowKey}]` : ''} (${row.chosen.docType} ${row.chosen.id})`);
    } else if ('unordered' in d && d.unordered) {
      unordered.push(`${row.tableName}.${row.fieldName} (chosen ${row.chosen.id})`);
    }
  }
  if (toReopen.length === 0 && unordered.length === 0) return { reopenedIds: [], unordered };
  const repo = new IpoFieldPlanRepository(tx as never, null as never);
  const { reopenedIds } = await repo.reopenSuperseded(toReopen);
  logger.info(
    {
      ipoId: document.ipoId,
      documentId: document.id,
      docType: document.docType,
      reopened: reopenedIds.length,
      planned: toReopen.length,
      fields: identities,
      unordered,
    },
    `[plan-supersession] ${document.docType} ${document.id} reopened ${reopenedIds.length} plan row(s) (§2.5, OD-91)` +
      (unordered.length > 0 ? `; ${unordered.length} same-type row(s) kept unordered (missing filing_date)` : '')
  );
  return { reopenedIds, unordered };
}

/**
 * #968 fix round 1, finding 3 (OD-91 + OD-95): supersession fires once, at a
 * document's COMPLETED write, and only on SUPPLIED rows -- so a better document
 * that completes while a row is override-reopened (PENDING) skips it. Before
 * the walk restores such a row, it asks this: the SAME rule (the shared
 * plan-supersession-rule module via `evaluateSupersession`) run for that one
 * row against every COMPLETED document of the IPO whose receipt has the field.
 * Documents completed before the reopen already had their chance while the
 * row was SUPPLIED, so this finds exactly the ones that landed during it (and
 * none of the pre-OD-91 documents, which have no receipt). Returns the
 * supersessor, or null to restore.
 */
export async function findSupersessorForReopenedRow(
  exec: ExecuteLike,
  ipoId: string,
  planRowId: string,
  docTypeOf = manifestDocumentTypeOf
): Promise<{ supersededBy: string; cause: string } | null> {
  const inputs = await loadSupersessionInputs(exec, ipoId, { planRowId });
  const verdict = evaluateSupersession(inputs, docTypeOf).reopen[0];
  if (!verdict) return null;
  return {
    supersededBy: verdict.supersededBy.id,
    cause: `superseded by ${verdict.supersededBy.docType} ${verdict.supersededBy.id} while override-reopened: ${verdict.reason} (OD-91, OD-95)`,
  };
}
