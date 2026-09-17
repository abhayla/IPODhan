/**
 * Field-plan generator - pull model, design §2.3.
 *
 * `field_sources` records successful writes only, so a field never attempted and a field
 * attempted and failed are indistinguishable in it (both absent). `ipo_field_plan` is the row
 * that separates them. This module produces those rows for one IPO, and applies the RESULT of a
 * write back onto a row.
 *
 * It builds nothing else: no pull walk (item 6), no re-read loop (item 9), no scheduling, and no
 * database access at all - every function here is pure.
 */
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import type { FieldManifest } from '../config/field-manifest-schema.js';
import { resolveFieldSourcePolicy, policyOriginString } from '../config/field-source-policy.js';

/**
 * The manifest keys its rank arrays by IPO type, not by the DB `segment` enum. `segment` is only
 * MAINBOARD | SME, so SME_BSE vs SME_NSE is decided by the listing exchanges - the same rule the
 * design's own walkthrough probe uses (docs/design/probes/walkthrough.mjs:55-57).
 */
export type IpoTypeKey = 'MAINBOARD' | 'SME_BSE' | 'SME_NSE' | string;

export type FieldPlanState =
  | 'PENDING'
  | 'SUPPLIED'
  | 'NOT_PRINTED'
  | 'NOT_AVAILABLE_YET'
  | 'CHECK_FAILED'
  | 'EXHAUSTED';

/** The slice of an `ipos` row the plan needs. */
export interface PlanIpo {
  id: string;
  segment: 'MAINBOARD' | 'SME' | null;
  listingExchanges?: ('NSE' | 'BSE')[] | null;
}

/** One planned (IPO, table, field) row, shaped like the `ipo_field_plan` columns it inserts into. */
export interface PlannedFieldRow {
  ipoId: string;
  tableName: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  state: FieldPlanState;
  chosenSource: string | null;
  chosenRank: number | null;
  chosenDocumentId: string | null;
  chosenDocumentType: string | null;
  chosenSha256: string | null;
  chosenPage: number | null;
  attempts: number;
  lastAttemptAt: Date | null;
  manifestVersion: number;
  /** 'registry:<version>' | 'override:<id>' — which configuration produced this row's ranks. */
  policyOrigin: string;
}

/**
 * What came back from the write attempt. `skipped` mirrors
 * `ConsolidatedUpsertResult.skipped` (data-consolidation-orchestrator.ts:50-59).
 */
export interface WriteOutcome {
  skipped: boolean;
  skipReason?: string;
  source?: string;
  rank?: number;
  value?: string | null;
  documentId?: string | null;
  documentType?: string | null;
  sha256?: string | null;
  page?: number | null;
  /** When the attempt was made. Injected so the function stays pure and testable. */
  at?: Date;
}

/** How many rank columns `ipo_field_plan` has. A longer rank list is refused, never truncated. */
const RANK_COLUMNS = 3;

export function resolveIpoTypeKey(ipo: PlanIpo): IpoTypeKey {
  if (ipo.segment !== 'SME') return 'MAINBOARD';
  // An SME issue listing on NSE Emerge is SME_NSE; everything else SME is SME_BSE. A missing
  // listing_exchanges is NOT evidence of NSE, so it falls to SME_BSE - and it must never fall
  // back to MAINBOARD, which would plan NSE-first ranks for a BSE-only SME issue.
  return (ipo.listingExchanges ?? []).includes('NSE') ? 'SME_NSE' : 'SME_BSE';
}

/**
 * One planned row per manifest field that declares a rank for THIS IPO's type.
 *
 * A field whose rank map has no entry for this type is NOT planned. field-manifest-schema.ts
 * makes MAINBOARD the only required key and deliberately does not default a missing key to `[]`,
 * so "no entry" means the manifest has not said how to source this field for this type - which
 * is not the same as "source it the MAINBOARD way". Falling back to MAINBOARD would plan NSE as
 * rank 1 for an SME-on-BSE issue.
 */
export function generateFieldPlan(
  ipo: PlanIpo,
  manifest: FieldManifest = loadFieldManifest()
): PlannedFieldRow[] {
  const typeKey = resolveIpoTypeKey(ipo);
  const rows: PlannedFieldRow[] = [];

  for (const [fieldKey, entry] of Object.entries(manifest.fields)) {
    const dot = fieldKey.indexOf('.');
    if (dot <= 0 || dot === fieldKey.length - 1 || fieldKey.indexOf('.', dot + 1) !== -1) {
      throw new Error(
        `generateFieldPlan: manifest field key "${fieldKey}" is not of the form table.field - ` +
          `the plan row's key is (ipo_id, table_name, field_name) and cannot be derived from it.`
      );
    }
    const tableName = fieldKey.slice(0, dot);
    const fieldName = fieldKey.slice(dot + 1);

    // The resolver is the ONE place rank[typeKey] is read (S1a) — the generator no longer reads
    // entry.rank directly, so it and the walk can never disagree on "no entry for this type".
    const policy = resolveFieldSourcePolicy({ table: tableName, column: fieldName, ipoType: typeKey }, { manifest });
    if (policy.na) continue;

    const ranks = policy.ranks;
    if (ranks.length > RANK_COLUMNS) {
      throw new Error(
        `generateFieldPlan: field "${fieldKey}" ranks ${ranks.length} sources for ${typeKey} ` +
          `(${ranks.join(', ')}) but ipo_field_plan has only ${RANK_COLUMNS} rank columns - ` +
          `refusing rather than silently dropping rank ${RANK_COLUMNS + 1}.`
      );
    }

    rows.push({
      ipoId: ipo.id,
      tableName,
      fieldName,
      rank1Source: ranks[0] ?? null,
      rank2Source: ranks[1] ?? null,
      rank3Source: ranks[2] ?? null,
      state: 'PENDING',
      chosenSource: null,
      chosenRank: null,
      chosenDocumentId: null,
      chosenDocumentType: null,
      chosenSha256: null,
      chosenPage: null,
      attempts: 0,
      lastAttemptAt: null,
      // Stamped so the plan is RECONCILED when the manifest changes, never regenerated per cycle.
      manifestVersion: manifest.version,
      policyOrigin: policyOriginString(policy.origin),
    });
  }

  return rows;
}

/**
 * CRITICAL-1 fix (S4 review round 2): the async, override-aware entry point for the PRODUCTION
 * write path (`document-cycle.ts`). `generateFieldPlan` above stays pure and synchronous -- its
 * own header says "no database access at all" and ~20 existing unit/integration tests call it with
 * the old 2-arg signature, so it is never converted. This wrapper calls it unchanged, then --
 * ONLY for rows where `deps.overrides` returns an active row -- overwrites `rank1Source` /
 * `rank2Source` / `rank3Source` / `policyOrigin` with the override's ranks/origin, exactly mirroring
 * what `resolveFieldSourcePolicyAsync` does inside the resolver for the walk's read path.
 *
 * Cost: ONE `overrides.resolve` call per (table, field) the pure generator already produced for
 * this IPO -- not one query per field globally, and never repeated per cycle for IPOs with no
 * candidate fields (rows.length === 0 short-circuits before this runs). This is the SAME
 * per-generate-call granularity the card's cost note requires ("resolve once per walk run/per
 * generate call, not a DB read per field") -- resolving is not memoized further because unlike the
 * walk's per-field loop (which asks up to 3x per field across retries), generate runs once per IPO
 * per cycle and the manifest field count here (a page's worth) is the loop already paid for.
 */
export async function generateFieldPlanAsync(
  ipo: PlanIpo,
  deps: { overrides?: { resolve(query: { table: string; column: string; ipoType: string; ipoId?: string }): Promise<{ id: string; ranks: string[]; expiresAt: string; ipoScoped: boolean }[]> } },
  manifest: FieldManifest = loadFieldManifest()
): Promise<PlannedFieldRow[]> {
  const rows = generateFieldPlan(ipo, manifest);
  if (rows.length === 0 || !deps.overrides) return rows;
  const typeKey = resolveIpoTypeKey(ipo);

  const resolved = await Promise.all(
    rows.map(async (row) => {
      const active = await deps.overrides!.resolve({
        table: row.tableName,
        column: row.fieldName,
        ipoType: typeKey,
        ipoId: ipo.id,
      });
      if (active.length === 0) return row;
      const winner = active.find((r) => r.ipoScoped) ?? active[0];
      const ranks = winner.ranks as PlannedFieldRow['rank1Source'][];
      if (ranks.length > RANK_COLUMNS) {
        throw new Error(
          `generateFieldPlanAsync: override "${winner.id}" ranks ${ranks.length} sources for ` +
            `${row.tableName}.${row.fieldName} but ipo_field_plan has only ${RANK_COLUMNS} rank columns.`
        );
      }
      return {
        ...row,
        rank1Source: ranks[0] ?? null,
        rank2Source: ranks[1] ?? null,
        rank3Source: ranks[2] ?? null,
        policyOrigin: `override:${winner.id}`,
      };
    })
  );
  return resolved;
}

/**
 * Apply the RESULT of a write to a plan row. Returns a new row; never mutates its argument.
 *
 * The sharp rule: `consolidatedUpsertIPO` returns `{ skipped: true, skipReason: 'LOCK_NOT_ACQUIRED' }`
 * silently (data-consolidation-orchestrator.ts:205-207). The write was DROPPED. Marking the plan
 * row SUPPLIED against it would be a false-clean state that every downstream check reads as
 * success - so a skipped return leaves the row PENDING with `attempts` untouched, whatever the
 * skip reason was.
 *
 * The richer terminal states (NOT_PRINTED, NOT_AVAILABLE_YET, CHECK_FAILED, EXHAUSTED) are
 * decided by the pull walk in item 6, not here.
 */
export function applyWriteResult(row: PlannedFieldRow, outcome: WriteOutcome): PlannedFieldRow {
  if (outcome.skipped) return { ...row };

  const attempted: PlannedFieldRow = {
    ...row,
    attempts: row.attempts + 1,
    lastAttemptAt: outcome.at ?? new Date(),
  };

  if (outcome.value === undefined || outcome.value === null || outcome.value === '') {
    return attempted;
  }

  return {
    ...attempted,
    state: 'SUPPLIED',
    chosenSource: outcome.source ?? null,
    chosenRank: outcome.rank ?? null,
    chosenDocumentId: outcome.documentId ?? null,
    chosenDocumentType: outcome.documentType ?? null,
    chosenSha256: outcome.sha256 ?? null,
    chosenPage: outcome.page ?? null,
  };
}
