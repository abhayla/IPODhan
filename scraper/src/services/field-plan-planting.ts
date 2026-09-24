/**
 * Plant one IPO's field plan: the EXISTING generator (`generateFieldPlanAsync`,
 * design §2.3) followed by the repository's reconciling upsert.
 *
 * Why this is its own function (OD-76, 2026-09-23): the plan is planted by two
 * callers -- the document cycle's PASS 2.5 for every live IPO, and the 22:00
 * closed-IPO job for a closed IPO that never had a plan. OD-76 requires ONE
 * code path ("creating that IPO's plan rows exactly as for a live IPO"), so
 * both call this and neither re-implements the row mapping. A second copy of
 * the mapping is how the two drift (a `rowKey` or `policyOrigin` set in one
 * and not the other).
 *
 * RECONCILED, NEVER REGENERATED: `upsertGeneratedRows` inserts only missing
 * (ipo, table, row_key, field) keys and re-ranks a non-SUPPLIED row only when
 * the manifest version is higher, so calling this on an already-planned IPO
 * writes nothing.
 */
import { generateFieldPlanAsync, type PlanIpo } from './field-plan-generator.js';
import type { FieldManifest } from '../config/field-manifest-schema.js';

type OverridesReader = NonNullable<Parameters<typeof generateFieldPlanAsync>[1]['overrides']>;

export interface GeneratedPlanRowInput {
  ipoId: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  manifestVersion: number;
  policyOrigin: string;
}

export interface FieldPlanPlantingDeps {
  overrides?: OverridesReader;
  fieldPlanRepository: {
    upsertGeneratedRows(rows: GeneratedPlanRowInput[]): Promise<{ inserted: number; updated?: number }>;
    /** #968 (OD-95): reopen / restore SETTLED rows when an override changes the effective order.
     *  Optional so a caller or mock without it plants exactly as before. */
    reconcileSettledToOverrides?(
      rows: GeneratedPlanRowInput[]
    ): Promise<{ reopened: number; retargeted: number; restoreDue: number }>;
  };
  /** Test seam only: production always plants from the loaded manifest (the generator's default). */
  manifest?: FieldManifest;
}

export interface FieldPlanPlantingResult {
  /** Rows the generator produced for this IPO. 0 = the manifest ranks no field for its type. */
  rowsGenerated: number;
  inserted: number;
  updated: number;
  /** #968 (OD-95): settled rows an override reopened / moved to a new override / made due for the walk to restore (override ended). */
  settledReopened: number;
  settledRetargeted: number;
  settledRestoreDue: number;
}

export async function plantFieldPlanForIpo(
  ipo: PlanIpo,
  deps: FieldPlanPlantingDeps
): Promise<FieldPlanPlantingResult> {
  const rows = deps.manifest
    ? await generateFieldPlanAsync(ipo, { overrides: deps.overrides }, deps.manifest)
    : await generateFieldPlanAsync(ipo, { overrides: deps.overrides });
  if (rows.length === 0) {
    return {
      rowsGenerated: 0,
      inserted: 0,
      updated: 0,
      settledReopened: 0,
      settledRetargeted: 0,
      settledRestoreDue: 0,
    };
  }
  const planned: GeneratedPlanRowInput[] = rows.map((r) => ({
    ipoId: r.ipoId,
    tableName: r.tableName,
    rowKey: '',
    fieldName: r.fieldName,
    rank1Source: r.rank1Source,
    rank2Source: r.rank2Source,
    rank3Source: r.rank3Source,
    manifestVersion: r.manifestVersion,
    policyOrigin: r.policyOrigin,
  }));
  const { inserted, updated } = await deps.fieldPlanRepository.upsertGeneratedRows(planned);
  // #968 (OD-95): AFTER the upsert, which never touches a SUPPLIED or reopened row, the settled
  // rows are reconciled against the same generated order. A plain re-plan changes nothing here.
  const settled = deps.fieldPlanRepository.reconcileSettledToOverrides
    ? await deps.fieldPlanRepository.reconcileSettledToOverrides(planned)
    : { reopened: 0, retargeted: 0, restoreDue: 0 };
  // `?? 0`: a caller/mock still returning the pre-S7 shape `{ inserted }`
  // must not turn the operator summary into NaN (signal-ownership R1).
  return {
    rowsGenerated: rows.length,
    inserted,
    updated: updated ?? 0,
    settledReopened: settled.reopened,
    settledRetargeted: settled.retargeted,
    settledRestoreDue: settled.restoreDue,
  };
}
