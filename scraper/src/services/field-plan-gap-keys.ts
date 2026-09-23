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
 * Kept free of DB imports so it is unit-testable; the live source that reads
 * the IPO's documents is `buildFieldPlanGapKeySource` in field-plan-walk-deps.ts.
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

export function buildFieldPlanIpoGapKeys(params: {
  manifestFields: Record<string, FingerprintableManifestEntry>;
  coverageFingerprint: string;
  extractorVersion: string;
  documents: readonly GapKeyDocument[];
}): FieldPlanIpoGapKeys {
  const byField: Record<string, FieldPlanFieldGapKeys> = {};
  for (const [fieldKey, entry] of Object.entries(params.manifestFields)) {
    const plain = `e${fieldManifestEntryFingerprint(entry).slice(0, 12)}|f${params.coverageFingerprint}|x${params.extractorVersion}`;
    byField[fieldKey] = { plain, withDocuments: `${plain}|${documentsPart(params.documents, entry?.documentType)}` };
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
  return gapCodes.includes('NO_DOCUMENT_PROVENANCE') ? k.withDocuments : k.plain;
}

/** The claim query's map: a stamped row whose key is NEITHER current variant is offered. */
export function fieldPlanClaimGapKeys(keys: FieldPlanIpoGapKeys): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [fieldKey, k] of Object.entries(keys.byField)) out[fieldKey] = [k.plain, k.withDocuments];
  return out;
}
