/**
 * #884: a CHECK_FAILED that asked nothing which could have failed is a GAP in
 * our own configuration or code, never a fact about the field. Spec:
 * data-sourcing-pull-model.md §2.3 (`manifest_version` exists "so the plan is
 * reconciled when the manifest changes"), §2.5.1 (a re-ask is triggered by an
 * event, not by a timer), OD-62 (COVERAGE_GAP "resolves with a manifest fix,
 * not by waiting") and OD-78 (same cause, same outcome, no retry).
 *
 * The closed list below is DECLARED by the fetcher on its answer (`gap` on a
 * CHECK_FAILED) or by the walk itself (no fetcher registered). Nothing here
 * parses free text on the live path (review round 1, MINOR-3).
 *
 * `NO_DOCUMENT_PROVENANCE` (review round 1, MAJOR-2): a COMPLETED document with
 * no field_sources row for the field is an EXTRACTOR gap —
 * field-plan-walk-doc-fetcher.ts: "NEVER evidence the document does not
 * print". It is re-asked when the extractor version changes, like a config
 * gap is re-asked when the manifest or fetcher coverage changes.
 */
export const FIELD_PLAN_GAP_CODES = [
  'NO_FETCHER',
  'NO_MAPPING',
  'NO_DOCUMENT_TYPE',
  'COLUMN_READ_NOT_IMPLEMENTED',
  'NO_DOCUMENT_PROVENANCE',
] as const;
export type FieldPlanGapCode = (typeof FIELD_PLAN_GAP_CODES)[number];

export function isFieldPlanGapCode(value: unknown): value is FieldPlanGapCode {
  return typeof value === 'string' && (FIELD_PLAN_GAP_CODES as readonly string[]).includes(value);
}

/** The token the walk appends to one rank's failure string. Only the walk writes it, from the structured code. */
export function fieldPlanGapToken(code: FieldPlanGapCode): string {
  return `[gap:${code}]`;
}

const GAP_TOKEN_RE = /\[gap:([A-Z_]+)\]/;

/** The structured gap code on one rank's failure string, or null when the failure was genuine. */
export function fieldPlanGapCodeOf(failure: string): FieldPlanGapCode | null {
  const m = GAP_TOKEN_RE.exec(failure);
  return m && isFieldPlanGapCode(m[1]) ? m[1] : null;
}

/**
 * The prefix the repository stamps on a gap row's recorded `cause`:
 * `[gap-key:<key>] <cause>`. `<key>` is `buildFieldPlanGapKey`'s output at the
 * moment of the ask (manifest version + fetcher coverage + extractor version).
 * The claim query offers a stamped row again ONLY when the current key differs
 * — no schema change: the key lives in the existing `cause` column.
 */
export const FIELD_PLAN_GAP_KEY_PREFIX = '[gap-key:';

export function stampFieldPlanGapCause(gapKey: string, cause: string | null): string {
  return `${FIELD_PLAN_GAP_KEY_PREFIX}${gapKey}] ${cause ?? ''}`.trimEnd();
}

/** The gap key a stamped cause was recorded under, or null for an unstamped cause. */
export function fieldPlanGapKeyOf(cause: string | null | undefined): string | null {
  if (!cause || !cause.startsWith(FIELD_PLAN_GAP_KEY_PREFIX)) return null;
  const end = cause.indexOf(']', FIELD_PLAN_GAP_KEY_PREFIX.length);
  return end < 0 ? null : cause.slice(FIELD_PLAN_GAP_KEY_PREFIX.length, end);
}

/**
 * LEGACY ONLY: the free-text shapes gap causes were recorded in BEFORE the
 * structured codes existed. Used by the one-off repair tool and the nightly
 * detection floor to find pre-stamp rows; the live claim/record path never
 * reads it. Mirrored in `scripts/lib/field-plan-slot.mjs`, pinned equal by
 * `scripts/tests/field-plan-reclaim-max-attempts-pin.test.mjs`.
 */
export const FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS: readonly string[] = [
  ':NO_FETCHER_REGISTERED',
  ' has no mapped field for ',
  'no documentType in manifest for this field',
  'DOC column read not implemented for ',
  '(extractor gap or field absent)',
];

/** LEGACY ONLY (see above): is this pre-stamp recorded cause a gap? A stamped cause always is. */
export function isFieldPlanConfigGapCause(cause: string | null | undefined): boolean {
  if (!cause) return false;
  if (cause.startsWith(FIELD_PLAN_GAP_KEY_PREFIX)) return true;
  return FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS.some((marker) => cause.includes(marker));
}
