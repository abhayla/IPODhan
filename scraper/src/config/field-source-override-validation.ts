/**
 * Pure validation predicates for a `field_source_overrides` row (item 3 slice S4). Shared by the
 * CLI (`scraper/scripts/field-source-override.ts`, which refuses a `set` on any violation) and its
 * unit tests, so there is one place these rules live — never a second implementation in a test
 * fixture (defect-fix-contract.md).
 *
 * S-05 (E-1 timetable fields may not rank DOC/any document source) is already enforced
 * transitively by rule 1 (capability) on the real manifest — none of the 10 class-T fields list
 * ANY document source as capable (measured on field-manifest.json v2, all `class: 'T'` rows). This
 * module still checks it explicitly and independently, so a future manifest change that DID mark a
 * document source capable for a class-T field would not silently re-open S-05.
 */
import type { FieldManifest, FieldManifestEntry, SourceCode } from './field-manifest-schema.js';

/** Sources that print from a filed document (never allowed to rank a class-T / E-1 field). */
const DOCUMENT_SOURCES: ReadonlySet<SourceCode> = new Set([
  'DOC',
  'DRHP',
  'RHP',
  'PROSPECTUS',
  'CORRIGENDUM',
  'PRICE_BAND_AD',
]);

export const MIN_REASON_LENGTH = 20;

export interface OverrideCandidate {
  table: string;
  column: string;
  ranks: SourceCode[];
  reason: string;
}

export type ValidationFailure =
  | { code: 'unknown-field'; message: string }
  | { code: 'empty-ranks'; message: string }
  | { code: 'duplicate-rank'; message: string; source: SourceCode }
  | { code: 'incapable-source'; message: string; source: SourceCode; reason: string }
  | { code: 'unproven-capable'; message: string; source: SourceCode }
  | { code: 's05-document-on-timetable-field'; message: string; source: SourceCode }
  | { code: 'reason-too-short'; message: string };

/**
 * Every check in order; returns the FIRST failure (a `set` refuses on the first violation, per the
 * card: "refused and logged never partially applied" — R-055). Returns `null` when the candidate is
 * valid.
 */
export function validateOverrideCandidate(
  candidate: OverrideCandidate,
  manifest: FieldManifest
): ValidationFailure | null {
  const fieldKey = `${candidate.table}.${candidate.column}`;
  const entry = manifest.fields[fieldKey];

  if (!entry) {
    return { code: 'unknown-field', message: `unknown field "${fieldKey}" — no entry in the field manifest (version ${manifest.version}).` };
  }

  if (candidate.reason.trim().length < MIN_REASON_LENGTH) {
    return {
      code: 'reason-too-short',
      message: `reason must be at least ${MIN_REASON_LENGTH} characters (got ${candidate.reason.trim().length}).`,
    };
  }

  if (candidate.ranks.length === 0) {
    return { code: 'empty-ranks', message: 'at least one rank source is required.' };
  }

  const seen = new Set<SourceCode>();
  for (const source of candidate.ranks) {
    if (seen.has(source)) {
      return { code: 'duplicate-rank', message: `rank source "${source}" is listed more than once.`, source };
    }
    seen.add(source);
  }

  // S-05: an E-1 timetable field (manifest class T) may not rank a document source, checked
  // independently of rule 1 (see module doc comment).
  if (entry.class === 'T') {
    const docSource = candidate.ranks.find((s) => DOCUMENT_SOURCES.has(s));
    if (docSource) {
      return {
        code: 's05-document-on-timetable-field',
        message: `"${fieldKey}" is an E-1 timetable field (S-05) — it may not rank a document source ("${docSource}").`,
        source: docSource,
      };
    }
  }

  for (const source of candidate.ranks) {
    const capability = entry.capability?.[source];
    if (capability?.capable === false) {
      return {
        code: 'incapable-source',
        message: `"${source}" is not capable of sourcing "${fieldKey}": ${capability.reason}`,
        source,
        reason: capability.reason,
      };
    }
    if (!capability) {
      // Absent from the capability map = never proven capable by the manifest (fail-closed —
      // rule 1: "Every named source must be capable"; the manifest generator only lists sources
      // it has actually assessed).
      return {
        code: 'unproven-capable',
        message: `"${source}" has no capability entry for "${fieldKey}" — the manifest has never assessed it as capable.`,
        source,
      };
    }
  }

  return null;
}

export function describeEntry(entry: FieldManifestEntry | undefined): string {
  if (!entry) return '(unknown field)';
  return `class=${entry.class}`;
}
