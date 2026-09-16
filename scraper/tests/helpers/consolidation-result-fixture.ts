// Shared test-only factory for the consolidated writer's return shape.
//
// WHY THIS EXISTS (2026-09-16 CI run 35134002865; supervisor RCA, second
// occurrence of the same class in one night). Three separate walk<->writer
// contract bugs -- round 4's missing `ipoRepository`, and round 5/6's
// `fieldResults` agreement check on both write paths -- all lived behind a
// HAND-WRITTEN stub of `ConsolidatedUpsertResult`/`ConsolidatedChildRowsResult`
// that each test file re-typed loosely (`as never`/`any`) and could drift
// from the real interface with no compiler check. A stub built from the REAL
// exported interfaces (this file) cannot silently drop a field the walk now
// reads, because adding a required field to the real type breaks this file's
// own type-check, not just production code three call sites away.
//
// Both the integration suite's stub orchestrator (field-plan-walk-resume) and
// the unit suite's `makeOrchestrator` (field-plan-walk.test.ts) build their
// results through these two factories.
import type {
  ConsolidatedUpsertResult,
  ChildRowConsolidationResult,
  ConsolidatedChildRowsResult,
} from '../../src/services/data-consolidation-orchestrator.js';
import type { FieldConsolidationResult } from '../../src/services/data-consolidation-service.js';

/** One field's resolved outcome -- the piece the walk's agreement check reads. */
export function fieldResult(
  fieldName: string,
  finalValue: unknown,
  chosenSource: FieldConsolidationResult['chosenSource'],
  overrides: Partial<FieldConsolidationResult> = {}
): FieldConsolidationResult {
  return {
    fieldName,
    finalValue,
    chosenSource,
    hadConflict: false,
    ...overrides,
  };
}

/**
 * `ConsolidatedUpsertResult` for the singleton (`ipos`) write path, in the
 * REAL shape `consolidatedUpsertIPO` actually returns -- `consolidation`
 * nested one level, carrying `fieldResults`.
 *
 * `fieldResults: undefined` (the default) reproduces the degenerate/fallback
 * path on purpose -- pass an explicit array for the win/loss cases.
 */
export function consolidatedUpsertResultFixture(
  overrides: Partial<ConsolidatedUpsertResult> & { fieldResults?: FieldConsolidationResult[] } = {}
): ConsolidatedUpsertResult {
  const { fieldResults, ...rest } = overrides;
  return {
    ipoId: '00000000-0000-4000-8000-0000000660a1',
    isNew: false,
    locked: true,
    skipped: false,
    ...(fieldResults !== undefined
      ? {
          consolidation: {
            ipoId: '00000000-0000-4000-8000-0000000660a1',
            fieldsProcessed: fieldResults.length,
            fieldsUpdated: fieldResults.length,
            conflictsDetected: fieldResults.filter((f) => f.hadConflict).length,
            conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
            fieldResults,
            errors: [],
          },
        }
      : {}),
    ...rest,
  };
}

/**
 * `ConsolidatedChildRowsResult` for the child-row write path, ONE row, in the
 * real shape `consolidatedUpsertChildRows` returns -- `fieldResults` sits
 * directly on the per-row result (review round 5, item A).
 */
export function consolidatedChildRowsResultFixture(
  rowKey: string,
  fieldResults: FieldConsolidationResult[] | undefined,
  overrides: Partial<ChildRowConsolidationResult> = {}
): ConsolidatedChildRowsResult {
  const consolidatedData = Object.fromEntries((fieldResults ?? []).map((f) => [f.fieldName, f.finalValue]));
  const row: ChildRowConsolidationResult = {
    rowKey,
    consolidatedData,
    fieldResults,
    fieldsProcessed: fieldResults?.length ?? 0,
    fieldsUpdated: fieldResults?.length ?? 0,
    conflictsDetected: fieldResults?.filter((f) => f.hadConflict).length ?? 0,
    skipped: false,
    ...overrides,
  };
  return {
    rowsProcessed: 1,
    rowsUpdated: row.skipped ? 0 : 1,
    rowsSkipped: row.skipped ? 1 : 0,
    conflictsDetected: row.conflictsDetected,
    rows: [row],
  };
}
