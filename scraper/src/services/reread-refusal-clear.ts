/**
 * OD-153 (owner 2026-10-01, #1247 item 3; spec §5.3 rule 4 applied to the STORED value).
 *
 * When a newer extractor re-reads a document and REFUSES a value that an older read of the SAME
 * document stored, the stored value is cleared to empty with the refusal as its reason (OD-62: a
 * reason, never a bare null), and the field's plan row is reopened so the walk asks the next-ranked
 * source. Before this, the persister wrote non-null values only, so the old value survived the
 * refusal (German Green's financial_data.inventoryTurnover 23.14 from its DRHP via the pre-#771
 * ratio reader).
 *
 * What counts:
 *  - REFUSED means the current read returned the field with a FAILED check (`check.passed === false`).
 *    A field the reader did not return at all is a miss, not a refusal, and clears nothing.
 *  - SAME DOCUMENT means the stored value's provenance row (field_sources, source DRHP, which every
 *    filing type writes) names this document id or this sha256 in its lineage.
 *  - OLDER READER means the provenance's extractor version differs from this read's. Same version
 *    or both unknown: nothing is cleared (fail closed: the value is kept, never guessed away).
 *  - An admin-held field is never cleared (the protection gate and the repositories' own hold check).
 *
 * Coverage: the one-row-per-IPO scalar columns the persister writes one-to-one from one extractor
 * field, in `ipo_details` and `financial_data`. `ipos` columns are written through the consolidated
 * writer and are NOT cleared here (named in the PR; deferred, never silently skipped: the run result
 * lists them under `notCovered`).
 */

export interface RereadRefusalField {
  extractorField: string;
  tableName: 'ipo_details' | 'financial_data';
  /** camelCase column, as field_sources.field_name and the repositories spell it. */
  column: string;
}

export const REREAD_REFUSAL_FIELDS: readonly RereadRefusalField[] = [
  { extractorField: 'refund_date', tableName: 'ipo_details', column: 'initiationOfRefundsDate' },
  { extractorField: 'credit_date', tableName: 'ipo_details', column: 'creditOfSharesDate' },
  { extractorField: 'upi_cutoff_time', tableName: 'ipo_details', column: 'upiCutoffTime' },
  { extractorField: 'designated_stock_exchange', tableName: 'ipo_details', column: 'designatedExchange' },
  { extractorField: 'compliance_officer', tableName: 'ipo_details', column: 'complianceOfficer' },
  { extractorField: 'compliance_officer_phone', tableName: 'ipo_details', column: 'complianceOfficerPhone' },
  { extractorField: 'compliance_officer_email', tableName: 'ipo_details', column: 'complianceOfficerEmail' },
  { extractorField: 'business_description', tableName: 'ipo_details', column: 'companyDescription' },
  { extractorField: 'lot_multiple', tableName: 'ipo_details', column: 'lotMultiple' },
  { extractorField: 'current_ratio', tableName: 'financial_data', column: 'currentRatio' },
  { extractorField: 'quick_ratio', tableName: 'financial_data', column: 'quickRatio' },
  { extractorField: 'inventory_turnover', tableName: 'financial_data', column: 'inventoryTurnover' },
  { extractorField: 'pe_at_cap', tableName: 'financial_data', column: 'peRatio' },
  { extractorField: 'promoter_holding_pre_pct', tableName: 'financial_data', column: 'promoterHoldingPreIssue' },
  { extractorField: 'promoter_holding_post_pct_at_cap', tableName: 'financial_data', column: 'promoterHoldingPostIssue' },
];

/** The OD-62 code the cleared field carries: a value was read and refused. */
export const REREAD_REFUSAL_RULE_ID = 'FAILED_VALIDATION';

export interface RereadRefusalProvenance {
  source: string | null;
  dataLineage?: unknown;
}

export interface RereadRefusalClearDeps {
  findProvenance(ipoId: string, tableName: string, column: string): Promise<RereadRefusalProvenance | null>;
  readStored(ipoId: string, tableName: string, column: string): Promise<unknown>;
  /** True when an admin holds the field (the same gate every scraper write passes). */
  isHeld(ipoId: string, tableName: string, column: string): Promise<boolean>;
  /** Writes NULL through the table's own repository write (which re-checks the hold under lock). */
  clear(ipoId: string, tableName: string, column: string): Promise<void>;
  recordReason(input: {
    ipoId: string;
    tableName: string;
    fieldName: string;
    documentId: string | null;
    documentSha256: string | null;
    extractedValue: string | null;
    cause: string;
  }): Promise<void>;
  /** Reopens the SUPPLIED plan rows chosen from this document for these fields; returns their ids. */
  reopenPlanRows(
    ipoId: string,
    documentId: string,
    fields: ReadonlyArray<{ tableName: string; column: string }>,
    cause: string
  ): Promise<string[]>;
}

export interface RereadRefusalInput {
  ipoId: string;
  docType: string;
  documentId: string | null;
  sourceSha: string | null;
  extractorVersion: string | null;
  fields: Record<string, { value?: unknown; check?: { passed?: unknown; detail?: unknown } | null } | undefined>;
}

export interface RereadRefusalResult {
  cleared: string[];
  held: string[];
  /** Refused, but the stored value did not come from an older read of this document. */
  kept: string[];
  reopenedPlanRowIds: string[];
}

interface Lineage {
  documentId?: string | null;
  sourceSha?: string | null;
  extractorVersion?: string | null;
}

/** The stored value came from an OLDER read of THIS document (fail closed on anything unknown). */
export function isOlderReadOfSameDocument(
  provenance: RereadRefusalProvenance | null,
  input: Pick<RereadRefusalInput, 'documentId' | 'sourceSha' | 'extractorVersion'>
): boolean {
  if (!provenance || provenance.source !== 'DRHP') return false;
  const lineage = (provenance.dataLineage ?? {}) as Lineage;
  const sameDocument =
    (input.documentId !== null && lineage.documentId === input.documentId) ||
    (input.sourceSha !== null && lineage.sourceSha === input.sourceSha);
  if (!sameDocument) return false;
  const before = lineage.extractorVersion ?? null;
  if (input.extractorVersion === null) return false;
  return before !== input.extractorVersion;
}

export async function clearRefusedStoredValues(
  input: RereadRefusalInput,
  deps: RereadRefusalClearDeps
): Promise<RereadRefusalResult> {
  const result: RereadRefusalResult = { cleared: [], held: [], kept: [], reopenedPlanRowIds: [] };
  const clearedFields: Array<{ tableName: string; column: string }> = [];
  for (const f of REREAD_REFUSAL_FIELDS) {
    const extracted = input.fields[f.extractorField];
    if (!extracted || !extracted.check || extracted.check.passed !== false) continue;
    const id = `${f.tableName}.${f.column}`;
    const provenance = await deps.findProvenance(input.ipoId, f.tableName, f.column);
    if (!isOlderReadOfSameDocument(provenance, input)) {
      result.kept.push(id);
      continue;
    }
    const stored = await deps.readStored(input.ipoId, f.tableName, f.column);
    if (stored === null || stored === undefined) continue;
    if (await deps.isHeld(input.ipoId, f.tableName, f.column)) {
      result.held.push(id);
      continue;
    }
    const detail = typeof extracted.check.detail === 'string' ? extracted.check.detail : 'check failed';
    const before = ((provenance?.dataLineage ?? {}) as Lineage).extractorVersion ?? 'unknown';
    const cause =
      `OD-153: ${input.docType} re-read (extractor ${input.extractorVersion}) refused ${f.extractorField}; ` +
      `stored ${String(stored)} from extractor ${before} of the same document cleared: ${detail}`;
    await deps.clear(input.ipoId, f.tableName, f.column);
    await deps.recordReason({
      ipoId: input.ipoId,
      tableName: f.tableName,
      fieldName: f.column,
      documentId: input.documentId,
      documentSha256: input.sourceSha,
      extractedValue: extracted.value === null || extracted.value === undefined ? null : String(extracted.value),
      cause,
    });
    result.cleared.push(id);
    clearedFields.push({ tableName: f.tableName, column: f.column });
  }
  if (clearedFields.length > 0 && input.documentId !== null) {
    result.reopenedPlanRowIds = await deps.reopenPlanRows(
      input.ipoId,
      input.documentId,
      clearedFields,
      `OD-153: stored value refused by a re-read of this document and cleared; next-ranked source asked`
    );
  }
  return result;
}
