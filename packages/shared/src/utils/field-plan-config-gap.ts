/**
 * #884: the causes that are facts about CONFIGURATION, never about the field.
 * A CHECK_FAILED whose cause contains one of these did not ask anything that
 * could have failed: the manifest ranks a source whose adapter has no mapping
 * for the field, a DOC rank with no `documentType`, or a source with no
 * registered fetcher. Spec: data-sourcing-pull-model.md §2.3 (`manifest_version`
 * exists "so the plan is reconciled when the manifest changes"), §2.5.1 (a
 * re-ask is triggered by an event, not burned by a timer) and OD-62's
 * COVERAGE_GAP definition ("resolves with a manifest fix, not by waiting").
 *
 * Deliberately NOT here: `no document provenance … (extractor gap or field
 * absent)` — it shares the COVERAGE_GAP reason code but can mean the field is
 * genuinely absent from the document, which is a real answer that must keep
 * counting toward the cap (1,775 capped staging rows on 2026-09-23). The list
 * is matched by substring against the recorded `cause`; the walk's push sites
 * (`field-plan-walk.ts`) and the fetchers' reason strings are the producers.
 *
 * Mirrored for the mjs detection floor in `scripts/lib/field-plan-slot.mjs`
 * (`FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS`), pinned equal by
 * `scripts/tests/field-plan-reclaim-max-attempts-pin.test.mjs`.
 */
export const FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS: readonly string[] = [
  ':NO_FETCHER_REGISTERED',
  ' has no mapped field for ',
  'no documentType in manifest for this field',
  'DOC column read not implemented for ',
];

/** #884: is this recorded cause a configuration gap (see the marker list above)? */
export function isFieldPlanConfigGapCause(cause: string | null | undefined): boolean {
  if (!cause) return false;
  return FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS.some((marker) => cause.includes(marker));
}
