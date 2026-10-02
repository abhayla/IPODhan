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
 *   ANY field of the document ambiguous-OCR marked  every clear of that read kept      nothing
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
 * is re-read under it, then the clear, its reason row, the retired provenance record and the plan
 * reopen are written together.
 */
import { sql } from 'drizzle-orm';
import { lockAndReadFieldHolds, protectionTableName } from '@ipodhan/shared/services/field-hold';
import { clearIpoColumnsForRereadAnswer } from './data-persister.js';
import { FILING_CLEARABLE_COLUMNS, type ClearableTable, type FilingClearableColumn } from './filing-clearable-columns.js';
import { isStatedAbsenceReason } from '../config/stated-absence-reasons.js';
import logger from '../utils/logger.js';

export type RereadTable = ClearableTable;
export type RereadClearableField = FilingClearableColumn;

/**
 * #1420 round 3 (B8): every column the filing persister writes one-to-one from ONE extractor field,
 * taken from the persister's own map (filing-clearable-columns.ts) - never a second, hand-kept list.
 * Derived and multi-field columns are in NOT_ONE_TO_ONE_COLUMNS there and are never cleared here.
 */
export const REREAD_CLEARABLE_FIELDS: readonly RereadClearableField[] = FILING_CLEARABLE_COLUMNS;

/** OD-158's reason text, verbatim. */
export const NOT_PRINTED_REASON = 'current reader: not printed';
/** field_extraction_failures.rule_id for each clearing answer. */
export const REREAD_RULE_ID = { REFUSED: 'FAILED_VALIDATION', STATED_NOT_PRINTED: 'NOT_PRINTED' } as const;

export interface RereadEnvelopeField {
  value?: unknown;
  state?: unknown;
  refused_value?: unknown;
  reason?: unknown;
  check?: { name?: unknown; passed?: unknown; detail?: unknown } | null;
}

export type RereadDecision =
  | { action: 'CLEAR'; state: 'REFUSED' | 'STATED_NOT_PRINTED'; reason: string; refusedValue: unknown; extractorReason: string | null }
  | { action: 'KEEP'; why: 'VALUE' | 'MISSED' | 'LOW_CONFIDENCE_OCR' | 'ABSENT' | 'NO_STATE' | 'UNKNOWN_STATE' | 'PERSISTER_HOLD_BACK'; state: string | null };

/**
 * Pure: the table row for ONE field. `heldBack` = the persister withheld this cleanly read value
 * (OD-160: fresh + OFS reconciliation, CIN length); a hold-back is never a refusal.
 */
export function decideRereadAnswer(field: RereadEnvelopeField | undefined, heldBack = false): RereadDecision {
  if (!field) return { action: 'KEEP', why: 'ABSENT', state: null };
  const state = typeof field.state === 'string' ? field.state : null;
  if (state === null) return { action: 'KEEP', why: 'NO_STATE', state: null };
  // #1420 round 3: an answer read off a page under the OCR confidence floor is never acted on,
  // whatever state it carries (the extractor sets LOW_CONFIDENCE_OCR; this is the second layer).
  if (field.check?.name === 'ocr_confidence_floor') return { action: 'KEEP', why: 'LOW_CONFIDENCE_OCR', state };
  if (heldBack) return { action: 'KEEP', why: 'PERSISTER_HOLD_BACK', state };
  switch (state) {
    case 'REFUSED': {
      const detail = typeof field.check?.detail === 'string' && field.check.detail !== '' ? field.check.detail : 'refused';
      return { action: 'CLEAR', state, reason: `current reader refused: ${detail}`, refusedValue: field.refused_value ?? null, extractorReason: null };
    }
    case 'STATED_NOT_PRINTED': {
      // Second layer over answer_states.py: only a reason on the shared stated-absence list is an
      // absence (the extractor's emit.null puts it in check.detail). Anything else fails closed.
      const extractorReason = field.check?.detail;
      if (!isStatedAbsenceReason(extractorReason)) return { action: 'KEEP', why: 'UNKNOWN_STATE', state };
      return { action: 'CLEAR', state, reason: NOT_PRINTED_REASON, refusedValue: null, extractorReason: extractorReason as string };
    }
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
 * filing type writes DRHP), a different document, a missing or unordered extractor version on either
 * side, the same version, or a stored version NEWER than this reader all answer false.
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
  const before = typeof lineage.extractorVersion === 'string' ? lineage.extractorVersion : null;
  return compareExtractorVersions(before, doc.extractorVersion) === -1;
}

/**
 * The extractor's version is `extract_filing.py@YYYY-MM-DD` with an optional single lower-case letter
 * for a same-day bump (`@2026-09-26b`), and it orders by that suffix (filing-auto-persist.ts
 * versionAtLeast). Returns -1 / 0 / 1, or null when either side is not in that exact form: an
 * order that cannot be read is never "older" (fail closed - nothing is cleared).
 */
const EXTRACTOR_VERSION_SHAPE = /^extract_filing\.py@(\d{4}-\d{2}-\d{2})([a-z]?)$/;
export function compareExtractorVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const ma = typeof a === 'string' ? EXTRACTOR_VERSION_SHAPE.exec(a) : null;
  const mb = typeof b === 'string' ? EXTRACTOR_VERSION_SHAPE.exec(b) : null;
  if (!ma || !mb) return null;
  const ka = `${ma[1]}${ma[2]}`;
  const kb = `${mb[1]}${mb[2]}`;
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}

/**
 * PR #1472 round 3 (B8, structure over detector): the markers the OCR guard (ocr_pages.py
 * guard_ambiguous_thousands / demote_dependents_of_ambiguous) leaves on an envelope field whose
 * printed number could be read two ways ("1.785" = Rs 1.785 or Rs 1,785), and on a field it demoted
 * because its check read that number.
 */
export const AMBIGUOUS_OCR_REASONS = ['ocr_ambiguous_thousands_separator', 'depends_on_ambiguous_ocr'] as const;
/** The reason logged and returned for every clear this rule turned into a keep. */
export const DOCUMENT_HAS_AMBIGUOUS_OCR = 'document_has_ambiguous_ocr';
const AMBIGUOUS_OCR_KEYS = new Set(['ambiguous_token', 'depends_on_ambiguous_ocr']);

function carriesAmbiguousOcrMarker(node: unknown, seen: Set<object>): boolean {
  if (typeof node === 'string') return AMBIGUOUS_OCR_REASONS.some((r) => node.includes(r));
  if (node === null || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((v) => carriesAmbiguousOcrMarker(v, seen));
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (AMBIGUOUS_OCR_KEYS.has(k) && v !== null && v !== undefined && v !== false && v !== '') return true;
    if (carriesAmbiguousOcrMarker(v, seen)) return true;
  }
  return false;
}

/**
 * Every envelope field (any field, clearable or not, at any depth of its record) that carries an
 * ambiguous-OCR marker: the reason text anywhere in it, or the guard's own `ambiguous_token` /
 * `depends_on_ambiguous_ocr` key. Sorted, for a stable log line.
 */
export function findAmbiguousOcrFields(fields: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  for (const [name, field] of Object.entries(fields ?? {})) {
    if (carriesAmbiguousOcrMarker(field, new Set())) out.push(name);
  }
  return out.sort();
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
  /**
   * PR #1472 round 3: clears that were due but were KEPT because this document's envelope carries an
   * ambiguous OCR value (`reason` = document_has_ambiguous_ocr, `ambiguousFields` = the marked fields).
   */
  keptAmbiguousOcr: Array<{ field: string; reason: typeof DOCUMENT_HAS_AMBIGUOUS_OCR; ambiguousFields: string[] }>;
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
  const result: RereadClearResult = { cleared: [], held: [], notOlderRead: [], keptHoldBack: [], keptAmbiguousOcr: [], reopenedPlanRowIds: [] };
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

  // PR #1472 round 3 (B8): the ONE choke point every re-read clear passes through. A document whose
  // envelope holds an ambiguous OCR number ("1.785": Rs 1.785 or Rs 1,785) cannot be trusted to refuse
  // or state-absent anything: any cross-field check may have compared against that unknown number,
  // and the check that did is not knowable from here (a hand-kept list of check inputs missed two in
  // two rounds). So nothing from this document clears a stored value: every due clear is a keep
  // (OD-153/OD-158/OD-160 a miss keeps; OD-97 an OCR value never wins over a text one; fail closed).
  const ambiguousFields = findAmbiguousOcrFields(input.fields as Record<string, unknown>);
  if (ambiguousFields.length > 0) {
    for (const { f } of due) {
      result.keptAmbiguousOcr.push({ field: `${f.tableName}.${f.column}`, reason: DOCUMENT_HAS_AMBIGUOUS_OCR, ambiguousFields });
    }
    logger.info(
      { ipoId: input.ipoId, docType: input.docType, documentId: input.documentId, reason: DOCUMENT_HAS_AMBIGUOUS_OCR, ambiguousFields, keptFields: result.keptAmbiguousOcr.map((k) => k.field) },
      '[reread-answer-clear] #1420 re-read clears kept: the document has an ambiguous OCR value'
    );
    return result;
  }

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
      // The NOT_PRINTED reason row is written in the persister's own shape `<docType> <extractor field>:
      // <reason>` with the extractor's stated-absence reason after the first ': ', which is what the
      // nightly check p_plan_not_printed_over_failed_read (leg 2) reads. The #1420 context lives in the
      // retired provenance record and the reopened plan row, which carry the long `cause`.
      const failureCause = d.state === 'STATED_NOT_PRINTED' ? `${input.docType} ${f.extractorField}: ${d.extractorReason}` : cause;
      await tx.execute(sql`
        INSERT INTO field_extraction_failures
          (ipo_id, table_name, field_name, row_key, document_id, document_sha256, rule_id, rank_attempted, extracted_value, cause)
        VALUES (${input.ipoId}::uuid, ${f.tableName}, ${f.column}, '', ${input.documentId}::uuid, ${input.sourceSha},
                ${REREAD_RULE_ID[d.state]}, 'DRHP', ${serialiseRefused(d.refusedValue)}, ${failureCause})`);
      // #1420 round 3 (OD-62): the empty column's provenance no longer names the older read as having
      // supplied a value; its record is retired (kept in field_sources_retired with the reason, the
      // pattern OD-156 uses), and the reason itself is the field_extraction_failures row above.
      await tx.execute(sql`
        WITH gone AS (
          DELETE FROM field_sources
           WHERE ipo_id = ${input.ipoId}::uuid AND table_name = ${f.tableName} AND row_key = '' AND field_name = ${f.column}
          RETURNING *)
        INSERT INTO field_sources_retired (ipo_id, table_name, row_key, field_name, source, record, retired_reason)
        SELECT g.ipo_id, g.table_name, g.row_key, g.field_name, g.source, to_jsonb(g), ${cause} FROM gone g`);
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
