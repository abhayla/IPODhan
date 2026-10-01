/**
 * #1420: what a NEWER extractor version's answer does to a value an OLDER version stored from the
 * SAME document. Spec data-sourcing-pull-model.md §6 rule 4, "Answer states for a re-read of the
 * same document" (OD-153, OD-158, OD-160).
 *
 *   reader answer                                   stored value V                     asked next
 *   REFUSED (the reader's own refusal)              cleared, reason = the refusal      rank 2
 *   STATED_NOT_PRINTED (allow-listed reason)        cleared, "current reader: not printed"  rank 2
 *   VALUE (same or different)                       the ordinary write path decides    nothing
 *   VALUE the persister held back (OD-160)          KEPT, hold-back recorded as cause  nothing
 *   MISSED / LOW_CONFIDENCE_OCR                     kept                               nothing
 *   field absent, or no answer state (OD-160)       kept                               nothing
 *   any state this module does not know             kept (fail closed)                 nothing
 *   V admin-held, row hidden or scraper-locked      kept                               nothing
 *   V's lineage records no extractor version        never cleared                      nothing
 *
 * The two mistakes are not symmetric: clearing on a miss erases a good value, keeping on a refusal
 * leaves an old value one cycle longer. So every unknown is a keep.
 *
 * Derived values are not listed (OD-160, §2.6): ipos.issueSize (fresh + OFS x cap) and
 * financial_data.quickRatio (computed, never printed) are never cleared here.
 *
 * Everything for one document runs in ONE transaction: the `ipos` row is locked FOR NO KEY UPDATE
 * first (the lock `writeAdminFieldValue` takes before an admin save, field-hold.ts), the admin hold
 * is re-read under it, then the clear, its reason row and the plan reopen are written together.
 */
import { sql } from 'drizzle-orm';
import { lockAndReadFieldHolds, protectionTableName } from '@ipodhan/shared/services/field-hold';
import { clearIpoColumnsForRereadAnswer, REREAD_CLEARABLE_IPOS_COLUMNS } from './data-persister.js';
import logger from '../utils/logger.js';

export type RereadTable = 'ipos' | 'ipo_details' | 'financial_data';

export interface RereadClearableField {
  extractorField: string;
  tableName: RereadTable;
  /** camelCase, as field_sources.field_name and field_protection_metadata.field_name spell it. */
  column: string;
  /** The SQL column (snake_case), as ipo_field_plan.field_name spells it. */
  sqlColumn: string;
}

/**
 * Scalar columns the persister writes one-to-one from ONE extractor field. A column absent here is
 * never cleared (derived totals, child-row tables: see the PR body for what is not covered).
 */
export const REREAD_CLEARABLE_FIELDS: readonly RereadClearableField[] = [
  { extractorField: 'price_band_floor', tableName: 'ipos', column: 'priceRangeMin', sqlColumn: 'price_range_min' },
  { extractorField: 'price_band_cap', tableName: 'ipos', column: 'priceRangeMax', sqlColumn: 'price_range_max' },
  { extractorField: 'lot_size', tableName: 'ipos', column: 'lotSize', sqlColumn: 'lot_size' },
  { extractorField: 'face_value', tableName: 'ipos', column: 'faceValue', sqlColumn: 'face_value' },
  { extractorField: 'cin', tableName: 'ipos', column: 'cin', sqlColumn: 'cin' },
  { extractorField: 'refund_date', tableName: 'ipo_details', column: 'initiationOfRefundsDate', sqlColumn: 'initiation_of_refunds_date' },
  { extractorField: 'credit_date', tableName: 'ipo_details', column: 'creditOfSharesDate', sqlColumn: 'credit_of_shares_date' },
  { extractorField: 'upi_cutoff_time', tableName: 'ipo_details', column: 'upiCutoffTime', sqlColumn: 'upi_cutoff_time' },
  { extractorField: 'designated_stock_exchange', tableName: 'ipo_details', column: 'designatedExchange', sqlColumn: 'designated_exchange' },
  { extractorField: 'compliance_officer', tableName: 'ipo_details', column: 'complianceOfficer', sqlColumn: 'compliance_officer' },
  { extractorField: 'compliance_officer_phone', tableName: 'ipo_details', column: 'complianceOfficerPhone', sqlColumn: 'compliance_officer_phone' },
  { extractorField: 'compliance_officer_email', tableName: 'ipo_details', column: 'complianceOfficerEmail', sqlColumn: 'compliance_officer_email' },
  { extractorField: 'lot_multiple', tableName: 'ipo_details', column: 'lotMultiple', sqlColumn: 'lot_multiple' },
  { extractorField: 'fresh_issue_amount', tableName: 'ipo_details', column: 'freshIssue', sqlColumn: 'fresh_issue' },
  { extractorField: 'current_ratio', tableName: 'financial_data', column: 'currentRatio', sqlColumn: 'current_ratio' },
  { extractorField: 'inventory_turnover', tableName: 'financial_data', column: 'inventoryTurnover', sqlColumn: 'inventory_turnover' },
  { extractorField: 'pe_at_cap', tableName: 'financial_data', column: 'peRatio', sqlColumn: 'pe_ratio' },
  { extractorField: 'promoter_holding_pre_pct', tableName: 'financial_data', column: 'promoterHoldingPreIssue', sqlColumn: 'promoter_holding_pre_issue' },
  { extractorField: 'promoter_holding_post_pct_at_cap', tableName: 'financial_data', column: 'promoterHoldingPostIssue', sqlColumn: 'promoter_holding_post_issue' },
];

/** OD-158's reason text, verbatim. */
export const NOT_PRINTED_REASON = 'current reader: not printed';
/** field_extraction_failures.rule_id for each clearing answer. */
export const REREAD_RULE_ID = { REFUSED: 'FAILED_VALIDATION', STATED_NOT_PRINTED: 'NOT_PRINTED' } as const;

export interface RereadEnvelopeField {
  value?: unknown;
  state?: unknown;
  refused_value?: unknown;
  reason?: unknown;
  check?: { passed?: unknown; detail?: unknown } | null;
}

export type RereadDecision =
  | { action: 'CLEAR'; state: 'REFUSED' | 'STATED_NOT_PRINTED'; reason: string; refusedValue: unknown }
  | { action: 'KEEP'; why: 'VALUE' | 'MISSED' | 'LOW_CONFIDENCE_OCR' | 'ABSENT' | 'NO_STATE' | 'UNKNOWN_STATE' | 'PERSISTER_HOLD_BACK'; state: string | null };

/**
 * Pure: the table row for ONE field. `heldBack` = the persister withheld this cleanly read value
 * (OD-160: fresh + OFS reconciliation, CIN length); a hold-back is never a refusal.
 */
export function decideRereadAnswer(field: RereadEnvelopeField | undefined, heldBack = false): RereadDecision {
  if (!field) return { action: 'KEEP', why: 'ABSENT', state: null };
  const state = typeof field.state === 'string' ? field.state : null;
  if (state === null) return { action: 'KEEP', why: 'NO_STATE', state: null };
  if (heldBack) return { action: 'KEEP', why: 'PERSISTER_HOLD_BACK', state };
  switch (state) {
    case 'REFUSED': {
      const detail = typeof field.check?.detail === 'string' && field.check.detail !== '' ? field.check.detail : 'refused';
      return { action: 'CLEAR', state, reason: `current reader refused: ${detail}`, refusedValue: field.refused_value ?? null };
    }
    case 'STATED_NOT_PRINTED':
      return { action: 'CLEAR', state, reason: NOT_PRINTED_REASON, refusedValue: null };
    case 'VALUE':
      return { action: 'KEEP', why: 'VALUE', state };
    case 'MISSED':
      return { action: 'KEEP', why: 'MISSED', state };
    case 'LOW_CONFIDENCE_OCR':
      return { action: 'KEEP', why: 'LOW_CONFIDENCE_OCR', state };
    default:
      return { action: 'KEEP', why: 'UNKNOWN_STATE', state };
  }
}

interface Lineage {
  documentId?: unknown;
  sourceSha?: unknown;
  extractorVersion?: unknown;
}

/**
 * The stored value came from an OLDER read of THIS document. Fail closed: provenance not DRHP (every
 * filing type writes DRHP), a different document, a missing extractor version on either side, or the
 * same version all answer false.
 */
export function isOlderReadOfSameDocument(
  provenance: { source: string | null; dataLineage: unknown } | null,
  doc: { documentId: string | null; sourceSha: string | null; extractorVersion: string | null }
): boolean {
  if (!provenance || provenance.source !== 'DRHP') return false;
  const lineage = (provenance.dataLineage ?? {}) as Lineage;
  const sameDocument =
    (doc.documentId !== null && lineage.documentId === doc.documentId) ||
    (doc.sourceSha !== null && lineage.sourceSha === doc.sourceSha);
  if (!sameDocument) return false;
  const before = typeof lineage.extractorVersion === 'string' && lineage.extractorVersion !== '' ? lineage.extractorVersion : null;
  if (before === null || doc.extractorVersion === null) return false;
  return before !== doc.extractorVersion;
}

export interface RereadClearInput {
  ipoId: string;
  docType: string;
  documentId: string | null;
  sourceSha: string | null;
  extractorVersion: string | null;
  fields: Record<string, RereadEnvelopeField | undefined>;
  /** OD-160: extractor fields the persister withheld this run, with the hold-back cause. */
  heldBack?: ReadonlyMap<string, string>;
}

export interface RereadClearResult {
  cleared: Array<{ field: string; state: string; reason: string }>;
  /** Clear was due but an admin hold, a hidden row or the scraper lock kept the value. */
  held: string[];
  /** Clear was due but the stored value is not an older read of this document (or no version). */
  notOlderRead: string[];
  /** OD-160: the persister held back a cleanly read value; the stored value is kept. */
  keptHoldBack: Array<{ field: string; cause: string }>;
  reopenedPlanRowIds: string[];
}

export interface RereadExecutor {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
  transaction<T>(fn: (tx: RereadExecutor) => Promise<T>): Promise<T>;
}

function serialiseRefused(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 2000 ? s.slice(0, 2000) : s;
}

/**
 * Apply the table to every clearable field of one document read. One transaction for the document:
 * lock + hold re-check, clear, reason row, plan reopen. Returns what happened per field.
 */
export async function clearRereadAnswers(db: RereadExecutor, input: RereadClearInput): Promise<RereadClearResult> {
  const result: RereadClearResult = { cleared: [], held: [], notOlderRead: [], keptHoldBack: [], reopenedPlanRowIds: [] };
  const due: Array<{ f: RereadClearableField; d: Extract<RereadDecision, { action: 'CLEAR' }> }> = [];
  for (const f of REREAD_CLEARABLE_FIELDS) {
    const holdBackCause = input.heldBack?.get(f.extractorField);
    const d = decideRereadAnswer(input.fields[f.extractorField], holdBackCause !== undefined);
    if (d.action === 'KEEP') {
      if (d.why === 'PERSISTER_HOLD_BACK') result.keptHoldBack.push({ field: `${f.tableName}.${f.column}`, cause: holdBackCause! });
      continue;
    }
    due.push({ f, d });
  }
  if (due.length === 0) return result;

  await db.transaction(async (tx) => {
    for (const { f, d } of due) {
      const id = `${f.tableName}.${f.column}`;
      // Admin hold re-read under the ipos row lock (the admin save's lock), per field.
      const hold = (await lockAndReadFieldHolds(tx, [input.ipoId], protectionTableName(f.tableName, ''))).get(input.ipoId);
      if (!hold) return; // IPO row gone: nothing to clear.
      if (hold.hidden || hold.protectedFields.has(f.column) || (f.tableName === 'ipos' && hold.writeBlocked)) {
        result.held.push(id);
        continue;
      }
      const prov = await tx.execute(sql`
        SELECT source, data_lineage FROM field_sources
         WHERE ipo_id = ${input.ipoId}::uuid AND table_name = ${f.tableName} AND row_key = '' AND field_name = ${f.column}
         LIMIT 1`);
      const p = prov.rows[0] as { source: string | null; data_lineage: unknown } | undefined;
      if (!isOlderReadOfSameDocument(p ? { source: p.source, dataLineage: p.data_lineage } : null, input)) {
        result.notOlderRead.push(id);
        continue;
      }
      if (f.tableName === 'ipos') {
        const changed = await clearIpoColumnsForRereadAnswer(tx, input.ipoId, [f.column]);
        if (changed.length === 0) continue; // already empty
      } else {
        // sqlColumn comes only from REREAD_CLEARABLE_FIELDS above (a constant), never from input.
        // financial_data has no updated_at column; ipo_details does.
        const upd = await tx.execute(sql`
          UPDATE ${sql.identifier(f.tableName)} SET ${sql.identifier(f.sqlColumn)} = NULL${f.tableName === 'ipo_details' ? sql`, updated_at = now()` : sql``}
           WHERE ipo_id = ${input.ipoId}::uuid AND ${sql.identifier(f.sqlColumn)} IS NOT NULL
          RETURNING ipo_id`);
        if (upd.rows.length === 0) continue; // already empty
      }
      const cause =
        `#1420 ${d.state === 'REFUSED' ? 'OD-153' : 'OD-158'}: ${input.docType} re-read by ${input.extractorVersion} ` +
        `cleared the value an older read of the same document stored. ${d.reason}`;
      await tx.execute(sql`
        INSERT INTO field_extraction_failures
          (ipo_id, table_name, field_name, row_key, document_id, document_sha256, rule_id, rank_attempted, extracted_value, cause)
        VALUES (${input.ipoId}::uuid, ${f.tableName}, ${f.column}, '', ${input.documentId}::uuid, ${input.sourceSha},
                ${REREAD_RULE_ID[d.state]}, 'DRHP', ${serialiseRefused(d.refusedValue)}, ${cause})`);
      if (input.documentId !== null) {
        const reopened = await tx.execute(sql`
          UPDATE ipo_field_plan
             SET state = 'PENDING', superseded_by = ${input.documentId}::uuid, next_due_at = now(),
                 reason_code = NULL, cause = ${cause}, updated_at = now()
           WHERE ipo_id = ${input.ipoId}::uuid AND table_name = ${f.tableName} AND row_key = ''
             AND field_name = ${f.sqlColumn} AND state = 'SUPPLIED' AND chosen_document_id = ${input.documentId}::uuid
          RETURNING id`);
        for (const r of reopened.rows as Array<{ id: string }>) result.reopenedPlanRowIds.push(String(r.id));
      }
      result.cleared.push({ field: id, state: d.state, reason: d.reason });
    }
  });
  if (result.cleared.length > 0 || result.held.length > 0 || result.keptHoldBack.length > 0) {
    logger.info({ ipoId: input.ipoId, docType: input.docType, ...result }, '[reread-answer-clear] #1420 re-read answers applied');
  }
  return result;
}
