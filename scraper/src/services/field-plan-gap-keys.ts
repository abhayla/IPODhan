/**
 * #884: the key a field-plan GAP row is recorded under, and re-offered only
 * when it changes (spec data-sourcing-pull-model.md §2.3 — `manifest_version`
 * exists "so the plan is reconciled when the manifest changes"; OD-62 a
 * COVERAGE_GAP "resolves with a manifest fix, not by waiting"; OD-78 same
 * cause, same outcome, no retry).
 *
 * Review round 2 made it per ROW rather than one string per cycle:
 *  - NEW-1: the manifest part is the field's OWN entry content fingerprint
 *    (ranks, capable flags, documentType — `fieldManifestEntryFingerprint`),
 *    not the schema `version`, which content edits do not bump. An edit to
 *    another field no longer reopens this one.
 *  - NEW-2: a NO_DOCUMENT_PROVENANCE gap also depends on WHICH documents the
 *    IPO has COMPLETED in the field's document family: a DRHP-era gap must
 *    reopen when the RHP completes, with no extractor version change. That
 *    row is stamped with the `withDocuments` variant; every other gap with
 *    `plain`, so a new document does not reopen a mapping gap it cannot fix.
 *
 * Round 3 (independent-review finding, this PR): a CONFIG gap (no attempt
 * charged) is parked under a key that ignored TWO other things that decide
 * where/how a field is asked — the field's OWN provenance row
 * (`field_sources` — a fresh SUPPLIED/NOT_PRINTED answer changes what the
 * walk would find next time) and any ACTIVE admin override for that
 * (table, field[, ipo]) (`field_source_overrides` — an override changes the
 * ranks the walk asks, in every capable/incapable respect a gap can be about,
 * not only NO_DOCUMENT_PROVENANCE). Both are now folded into `plain` itself
 * (so every gap code reopens on either changing), not just `withDocuments`.
 * `provenancePart`/`overridePart` are short hashes of "none" or the relevant
 * identity; a field with neither yields the identical string this file
 * produced before round 3 (no drift for fields nobody has touched).
 * Kept free of DB imports so it is unit-testable; the live source that reads
 * the IPO's documents/provenance/overrides is `buildFieldPlanGapKeySource` in
 * field-plan-walk-deps.ts.
 */
import { createHash } from 'node:crypto';
import {
  fieldManifestEntryFingerprint,
  type FingerprintableManifestEntry,
} from '@ipodhan/shared/utils/field-manifest-fingerprint';
import type { FieldPlanGapCode } from '@ipodhan/shared/utils/field-plan-config-gap';
import { docTypeFamily } from './field-plan-walk-doc-fetcher.js';

export interface FieldPlanFieldGapKeys {
  /** Entry content + fetcher coverage + extractor version. */
  plain: string;
  /** `plain` + the COMPLETED documents of the field's document family. */
  withDocuments: string;
  /**
   * OD-99: `plain` + the consolidated writer's capability for the field's
   * table. A WRITER_CANNOT_ACCEPT row is stamped with this one, so a writer
   * change (flag, keyable table set, writer version) reopens it, and nothing
   * else about the writer reopens any other gap.
   */
  withWriter: string;
  /**
   * #1379 (spec §5.3 rules 4-5, OD-21, OD-56, OD-62): `withDocuments` + the IPO's stage + the
   * validation rules' fingerprint. A row whose every rank answer was REFUSED at the write (or refused
   * with no other rank able to supply) is parked under this key: FAILED_VALIDATION means the
   * extractor needs fixing, so nothing is re-asked until one of the events that can change the answer
   * happens -- a stage change (OD-56), a new COMPLETED document in the field's family (OD-66, §5.3
   * rule 5), an extractor version change (rule 5), a corrected rule (rules are configuration, §5.3),
   * or the manifest entry / provenance / override parts `plain` already carries.
   */
  withValidation: string;
}

/** Keyed `table.field`, the manifest's own key shape. */
export interface FieldPlanIpoGapKeys {
  byField: Record<string, FieldPlanFieldGapKeys>;
}

/** Built once per cycle; resolved once per IPO walk. */
export interface FieldPlanGapKeySource {
  forIpo(ipoId: string): Promise<FieldPlanIpoGapKeys>;
}

export interface GapKeyDocument {
  id: string;
  type: string;
  extractionStatus: string | null;
  isActive: boolean | null;
}

/** The field's own provenance row (`field_sources`), as far as the key needs to know. */
export interface GapKeyProvenance {
  source: string;
  /** `data_lineage.document_id`, when the provenance row carries one. */
  documentId?: string | null;
}

/** One active admin override (`field_source_overrides`) for this field. */
export interface GapKeyOverride {
  id: string;
}

const short = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

function documentsPart(documents: readonly GapKeyDocument[], documentType: string | undefined): string {
  if (!documentType) return 'd0';
  const family = docTypeFamily(documentType);
  const completed = documents
    .filter((d) => family.includes(d.type) && d.extractionStatus === 'COMPLETED' && d.isActive !== false)
    .map((d) => `${d.type}:${d.id}`)
    .sort();
  return completed.length === 0 ? 'd0' : `d${short(completed.join(','))}`;
}

/** `none`, or a short hash of the provenance row's source + lineage document id. */
function provenancePart(provenance: GapKeyProvenance | null | undefined): string {
  if (!provenance) return 'p:none';
  return `p${short(`${provenance.source}:${provenance.documentId ?? ''}`)}`;
}

/** `none`, or the active override's own id (a new/changed/expired override is a new id). */
function overridePart(override: GapKeyOverride | null | undefined): string {
  return override ? `o${short(override.id)}` : 'o:none';
}

/** The date columns the merged-record date rules judge (validators.ts IPO_DATE_KEYS), as manifest field keys. */
const DATE_RULE_FIELD_KEYS: ReadonlySet<string> = new Set([
  'ipos.open_date',
  'ipos.close_date',
  'ipos.allotment_date',
  'ipos.listing_date',
]);
export const DATE_RULE_INPUT_KEYS = ['openDate', 'closeDate', 'allotmentDate', 'listingDate'] as const;

function storedDatesPart(inputs: Readonly<Record<string, string | null | undefined>> | null | undefined): string {
  if (!inputs) return 't:unknown';
  return `t${short(DATE_RULE_INPUT_KEYS.map((k) => `${k}=${inputs[k] ?? ''}`).join(','))}`;
}

export function buildFieldPlanIpoGapKeys(params: {
  manifestFields: Record<string, FingerprintableManifestEntry>;
  coverageFingerprint: string;
  extractorVersion: string;
  documents: readonly GapKeyDocument[];
  /** Per-field provenance row, keyed `table.field` — same key shape as `manifestFields`. */
  provenanceByField?: Readonly<Record<string, GapKeyProvenance | null | undefined>>;
  /** Per-field active override, keyed `table.field`. */
  overrideByField?: Readonly<Record<string, GapKeyOverride | null | undefined>>;
  /** OD-99: the writer's capability for a table (`fieldPlanWriterCapability`). Omitted: `w:unknown`. */
  writerCapability?: (tableName: string) => string;
  /** #1379: the IPO's stage (`ipos.status`). Omitted: `s:unknown` (still a stable key). */
  stage?: string | null;
  /** #1379: a fingerprint of the loaded validation rules. Omitted: `v:unknown`. */
  validationRulesFingerprint?: string | null;
  /**
   * #1379 round 2: the STORED dates the cross-field date rules read (`incomingDatesRefusedOnMergedRecord`:
   * openDate, closeDate, allotmentDate, listingDate). Part of the validation key of the four date fields
   * only, so an admin correcting open_date unparks a date-refused listing_date (§5.3 rule 4: the refusal
   * was judged against those inputs). Omitted: `t:unknown`.
   */
  storedDateInputs?: Readonly<Record<string, string | null | undefined>> | null;
}): FieldPlanIpoGapKeys {
  const byField: Record<string, FieldPlanFieldGapKeys> = {};
  for (const [fieldKey, entry] of Object.entries(params.manifestFields)) {
    const provenance = provenancePart(params.provenanceByField?.[fieldKey]);
    const override = overridePart(params.overrideByField?.[fieldKey]);
    const plain = `e${fieldManifestEntryFingerprint(entry).slice(0, 12)}|f${params.coverageFingerprint}|x${params.extractorVersion}|${provenance}|${override}`;
    const tableName = fieldKey.slice(0, fieldKey.indexOf('.'));
    const writer = params.writerCapability ? `w${short(params.writerCapability(tableName))}` : 'w:unknown';
    const withDocuments = `${plain}|${documentsPart(params.documents, entry?.documentType)}`;
    const stagePart = params.stage ? `s${short(params.stage)}` : 's:unknown';
    const rulesPart = params.validationRulesFingerprint ? `v${short(params.validationRulesFingerprint)}` : 'v:unknown';
    const datesPart = DATE_RULE_FIELD_KEYS.has(fieldKey) ? `|${storedDatesPart(params.storedDateInputs)}` : '';
    byField[fieldKey] = {
      plain,
      withDocuments,
      withWriter: `${plain}|${writer}`,
      withValidation: `${withDocuments}|${stagePart}|${rulesPart}${datesPart}`,
    };
  }
  return { byField };
}

/** The key one gap row is stamped with, or null (field not in the manifest: charged, never unkeyed). */
export function fieldPlanGapKeyFor(
  keys: FieldPlanIpoGapKeys,
  tableName: string,
  fieldName: string,
  gapCodes: readonly FieldPlanGapCode[]
): string | null {
  const k = keys.byField[`${tableName}.${fieldName}`];
  if (!k) return null;
  if (gapCodes.includes('WRITER_CANNOT_ACCEPT')) return k.withWriter;
  return gapCodes.includes('NO_DOCUMENT_PROVENANCE') ? k.withDocuments : k.plain;
}

/** #1379: the key a FAILED_VALIDATION row is parked under, or null (field not in the manifest: charged, never unkeyed). */
export function fieldPlanValidationKeyFor(keys: FieldPlanIpoGapKeys, tableName: string, fieldName: string): string | null {
  return keys.byField[`${tableName}.${fieldName}`]?.withValidation ?? null;
}

/** The claim query's map: a stamped row whose key is NONE of the current variants is offered. */
export function fieldPlanClaimGapKeys(keys: FieldPlanIpoGapKeys): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [fieldKey, k] of Object.entries(keys.byField)) {
    out[fieldKey] = [k.plain, k.withDocuments, k.withWriter, k.withValidation];
  }
  return out;
}
