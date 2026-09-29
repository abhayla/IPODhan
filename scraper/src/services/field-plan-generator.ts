/**
 * Field-plan generator - pull model, design §2.3. The generator itself lives in
 * `packages/shared/src/services/field-plan-generator.ts` (ONE definition, used by this scraper AND
 * the admin plan rebuild, spec §2.8 / §9.2 item 18). This module binds the scraper's loaded
 * manifest as the default and keeps `applyWriteResult`, which only the scraper uses.
 */
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import type { FieldManifest } from '../config/field-manifest-schema.js';
import {
  generateFieldPlan as generateSharedFieldPlan,
  generateFieldPlanAsync as generateSharedFieldPlanAsync,
  resolveIpoTypeKey,
  type IpoTypeKey,
  type FieldPlanState,
  type PlanIpo,
  type PlannedFieldRow,
  type PlanOverridesReader,
  type PlanManifest,
} from '@ipodhan/shared/services/field-plan-generator';

export { resolveIpoTypeKey };
export type { IpoTypeKey, FieldPlanState, PlanIpo, PlannedFieldRow };

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

/**
 * The zod schema REQUIRES `version` (1 | 2); it infers as optional only because the scraper
 * compiles with strict:false. A validated manifest is therefore a PlanManifest.
 */
const asPlanManifest = (manifest: FieldManifest): PlanManifest => manifest as PlanManifest;

/** The shared generator with the scraper's loaded manifest as the default. */
export const generateFieldPlan = (ipo: PlanIpo, manifest: FieldManifest = loadFieldManifest()): PlannedFieldRow[] =>
  generateSharedFieldPlan(ipo, asPlanManifest(manifest));

/** The shared override-aware generator with the scraper's loaded manifest as the default. */
export const generateFieldPlanAsync = (
  ipo: PlanIpo,
  deps: { overrides?: PlanOverridesReader },
  manifest: FieldManifest = loadFieldManifest()
): Promise<PlannedFieldRow[]> => generateSharedFieldPlanAsync(ipo, deps, asPlanManifest(manifest));

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
