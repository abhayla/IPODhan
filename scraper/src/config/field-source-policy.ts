/**
 * The one resolver — item 3, slice S1a; layer 2 (overrides) filled in by S4. Answers "which
 * sources, in which order, for this field, table, IPO type" — layer 2 (an active, unexpired
 * `field_source_overrides` row) beats layer 1 (the manifest). The plan generator and the walk
 * both call `resolveFieldSourcePolicy` (sync, registry-only — unchanged by this slice, per its
 * scope limit) and neither re-reads `entry.rank[...]` directly.
 *
 * `resolveFieldSourcePolicyAsync` (S4, NEW) is the override-aware entry point: same manifest
 * logic, plus an optional `deps.overrides` reader consulted for layer 2. It is not wired into the
 * generator/walk in this slice (out of scope — "Do NOT change the writer, the walk" — a future
 * slice threads it through call sites that are currently synchronous, per-field loops). Layer 3
 * (the walk's existing `field_protection_metadata` skip, §2.7) is untouched here; it sits above
 * the resolver in the walk, not inside it.
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

/** One active override row, as the reader hands it to the resolver (layer 2, S4). */
export interface ResolvedOverride {
  id: string;
  ranks: SourceCode[];
  expiresAt: string;
  /** true when this row is scoped to the one IPO in the query; false for a global (all-IPO) row. */
  ipoScoped: boolean;
}

/**
 * S4. `resolve` returns every currently-active row (not expired) for the query's (table, column) —
 * both an ipo-scoped and a global row may be active at once; the resolver (not the reader) decides
 * precedence (ipo-scoped beats global). Returning [] means "no active override" — including when
 * the underlying table does not exist (the reader's job to catch that, never the resolver's).
 */
export interface OverrideReader {
  resolve(query: PolicyQuery): Promise<ResolvedOverride[]>;
}

export interface PolicyDeps {
  manifest?: FieldManifest;
  /** Consulted only by `resolveFieldSourcePolicyAsync` (S4) — the sync function ignores it. */
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

/**
 * S4: the override-aware resolver. Same manifest read as `resolveFieldSourcePolicy`, plus layer 2
 * — when `deps.overrides` is given and returns at least one active row for (table, column[, ipoId]),
 * an ipo-scoped row beats a global row, and the winning row's ranks + origin replace the registry's.
 * `incapable`/`documentType`/`na` always come from the manifest — an override changes WHICH sources
 * rank, never what the manifest thinks each source can do.
 */
export async function resolveFieldSourcePolicyAsync(
  query: PolicyQuery,
  deps: PolicyDeps = {}
): Promise<FieldSourcePolicy> {
  const registryPolicy = resolveFieldSourcePolicy(query, deps);
  if (!deps.overrides) return registryPolicy;

  const active = await deps.overrides.resolve(query);
  if (active.length === 0) return registryPolicy;

  // ipo-scoped beats global (S4 precedence rule); among ties, the reader's own ordering
  // (newest `setAt` first, per the repository) decides — take the first ipo-scoped row if any,
  // else the first global row.
  const winner = active.find((row) => row.ipoScoped) ?? active[0];

  const origin: PolicyOrigin = { kind: 'override', id: winner.id, expiresAt: winner.expiresAt };
  return { ...registryPolicy, ranks: [...winner.ranks], origin };
}
