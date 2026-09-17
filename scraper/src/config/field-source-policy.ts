/**
 * The one resolver — item 3, slice S1a. Answers "which sources, in which order, for this field,
 * table, IPO type" from the manifest (layer 1). The plan generator and the walk both call this
 * and nothing else; neither re-reads `entry.rank[...]` directly after this slice.
 *
 * Layer 2 (per-IPO overrides, admin corrections) is a stub parameter here — S4 fills it in. The
 * signature is fixed now so S4 needs no caller change (design finding 6). Layer 3 (the walk's
 * existing `field_protection_metadata` skip, §2.7) is untouched by this slice; it sits above the
 * resolver in the walk, not inside it.
 */
import { loadFieldManifest } from './field-manifest-loader.js';
import type { FieldManifest, FieldManifestEntry, SourceCode } from './field-manifest-schema.js';
import type { IpoTypeKey } from '../services/field-plan-generator.js';

export interface PolicyQuery {
  table: string;
  column: string;
  ipoType: IpoTypeKey;
  ipoId?: string;
}

export type PolicyOrigin =
  | { kind: 'registry'; version: number }
  | { kind: 'override'; id: string; expiresAt: string };

export interface FieldSourcePolicy {
  /** e.g. ['DOC', 'CHITTORGARH']. ADMIN is never listed (that is layer 3, not this resolver). */
  ranks: SourceCode[];
  /**
   * The manifest row's ONE document type (field-manifest-schema.ts's `documentType` is a single
   * optional enum, not an ordered list — there is no per-field document-type order anywhere in
   * the data, measured on the real 190-row manifest 2026-09-17: RHP on 103 rows, PRICE_BAND_AD on
   * 52, absent on 35). Absent -> undefined; the DOC fetcher's existing CHECK_FAILED 'no
   * documentType in manifest' path is unchanged by this slice.
   */
  documentType?: FieldManifestEntry['documentType'];
  origin: PolicyOrigin;
  /** True when the manifest row has no rank entry for this query's ipoType; `ranks` is then []. */
  na: boolean;
  /** Sources the manifest marks capable:false for this field, with the manifest's stated reason.
   *  Distinct from "absent from ranks": an unranked-but-capable source is merely not preferred;
   *  an incapable source must never be written (S1c). */
  incapable: Readonly<Record<string, string>>;
}

/**
 * Reserved for S4 (layer 2, per-IPO overrides). Accepted and ignored in this slice — S4 wires
 * this reader in without changing the caller-facing signature.
 */
export interface OverrideReader {
  resolve(query: PolicyQuery): PolicyOrigin extends { kind: 'override' } ? PolicyOrigin : never;
}

export interface PolicyDeps {
  manifest?: FieldManifest;
  /** S4. Accepted and ignored — see `OverrideReader`'s doc comment. */
  overrides?: OverrideReader;
}

export function resolveFieldSourcePolicy(query: PolicyQuery, deps: PolicyDeps = {}): FieldSourcePolicy {
  const manifest = deps.manifest ?? loadFieldManifest();
  const fieldKey = `${query.table}.${query.column}`;
  const entry = manifest.fields[fieldKey];

  if (!entry) {
    throw new Error(
      `resolveFieldSourcePolicy: unknown field "${fieldKey}" — no entry in the field manifest (version ${manifest.version}).`
    );
  }

  const origin: PolicyOrigin = { kind: 'registry', version: manifest.version };
  // deps.overrides is accepted (interface stability for S4) but never consulted in this slice —
  // layer 2 is not built yet, so every resolution today is a registry answer.

  // Built here, where the manifest entry is already in hand — the writer must never load the
  // manifest a second time (S1c card correction K1: a second config read on the write path is a
  // second source of truth).
  const incapable: Record<string, string> = {};
  for (const [code, capability] of Object.entries(entry.capability ?? {})) {
    if (capability.capable === false) incapable[code] = capability.reason;
  }

  const ranks = entry.rank[query.ipoType];
  if (!Array.isArray(ranks)) {
    // The manifest has no rank entry for this IPO type — not "source it the MAINBOARD way"
    // (field-plan-generator.ts's generateFieldPlan makes the same call for the same reason).
    // An N/A field still has a capability map — a source that cannot produce this field is
    // incapable regardless of whether this IPO type ranks anyone at all.
    return { ranks: [], documentType: entry.documentType, origin, na: true, incapable };
  }

  return { ranks: [...ranks], documentType: entry.documentType, origin, na: false, incapable };
}

export function policyOriginString(origin: PolicyOrigin): string {
  return origin.kind === 'registry' ? `registry:${origin.version}` : `override:${origin.id}`;
}
