/**
 * #1379 round 3 (spec §5.3 rule 4, OD-21; run-discipline B8): THE table of every code the consolidator
 * (`data-consolidation-service.ts`, incl. `runPreRankChecks`) and `listing-exchange-resolution.ts` put on
 * a rejected source (`rejectedSources[].reason`, a REFUSED pre-rank check's `reason`, and the
 * `resolutionReason` that becomes one). Each code has ONE category:
 *
 *  - KEEP:   the stored value / a better-ranked source legitimately holds the field (a priority or
 *            holding loss). The field-plan walk records LOST_TO_HIGHER_PRIORITY and does NOT try rank 2.
 *  - REFUSE: the write door refused THIS value (a validation rule, matrix bounds, an incapable source,
 *            an implausible value, nothing usable). The walk drops it and tries the next rank (§5.3 r4).
 *
 * Emit sites use `OUTCOME_CODE.<NAME>` (or `${OUTCOME_CODE.<PREFIX>}<suffix>` for a prefix family), never
 * a string literal. `scraper/tests/unit/services/consolidation-outcome-codes-completeness.test.ts` parses
 * the emitter files and fails when an emit site is not a table entry (a literal, an unknown name, a shape
 * it cannot read) and when a table entry is never emitted. At runtime an UNKNOWN code is still read as a
 * refusal (fail closed) -- the static test is what keeps that path empty.
 *
 * Why a table (two rounds missed this class): round 1 matched only the OD-21 prefix; round 2's
 * hand-typed PRIORITY_LOSS_REASONS missed OD129_DOCUMENT_LISTING_HOLDS, and its tests looped over the
 * list itself, so a code dropped from the list dropped its own test.
 */
import { SOURCE_CHANGED_OWN_VALUE as SHARED_SOURCE_CHANGED_OWN_VALUE } from '@ipodhan/shared/utils/conflict-reasons';

export type OutcomeCategory = 'KEEP' | 'REFUSE';

/** Every code, by name. A `*_PREFIX`-style family carries its separator; see OUTCOME_PREFIX_NAMES. */
export const OUTCOME_CODE = {
  // ---- KEEP: priority / holding losses ------------------------------------------------------------
  SOURCE_PRIORITY: 'SOURCE_PRIORITY',
  DEFAULT_KEEP_EXISTING: 'DEFAULT_KEEP_EXISTING',
  TIME_BASED_PRIORITY: 'TIME_BASED_PRIORITY',
  TIME_BASED_PRIORITY_EXISTING_NEWER: 'TIME_BASED_PRIORITY_EXISTING_NEWER',
  SAME_SOURCE_REFRESH: 'SAME_SOURCE_REFRESH',
  SAME_SOURCE_REFRESH_STORED_DOCUMENT_OUTRANKS: 'SAME_SOURCE_REFRESH_STORED_DOCUMENT_OUTRANKS',
  SAME_SOURCE_REFRESH_INCOMING_DOCUMENT_OUTRANKS: 'SAME_SOURCE_REFRESH_INCOMING_DOCUMENT_OUTRANKS',
  SAME_SOURCE_REFRESH_EXISTING_NEWER: 'SAME_SOURCE_REFRESH_EXISTING_NEWER',
  SOURCE_CHANGED_OWN_VALUE: SHARED_SOURCE_CHANGED_OWN_VALUE as 'SOURCE_CHANGED_OWN_VALUE',
  HELD_DISPUTED_HIGH_VALUE_LIVE: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
  TERMINAL_STATUS_KEPT: 'TERMINAL_STATUS_KEPT',
  BACKWARD_STATUS_KEPT: 'BACKWARD_STATUS_KEPT',
  POSTPONED_KEPT_NO_RELAUNCH: 'POSTPONED_KEPT_NO_RELAUNCH',
  UNTRACKED_EXISTING_VALUE_KEPT: 'UNTRACKED_EXISTING_VALUE_KEPT',
  OD129_DOCUMENT_LISTING_WRITES: 'OD129_DOCUMENT_LISTING_WRITES',
  OD129_DOCUMENT_LISTING_CONFIRMS: 'OD129_DOCUMENT_LISTING_CONFIRMS',
  OD129_DOCUMENT_LISTING_HOLDS: 'OD129_DOCUMENT_LISTING_HOLDS',
  OD129_DOCUMENT_LISTING_DISAGREES: 'OD129_DOCUMENT_LISTING_DISAGREES',
  SME_SINGLE_EXCHANGE_INVARIANT: 'SME_SINGLE_EXCHANGE_INVARIANT',
  SME_SINGLE_EXCHANGE_COLLAPSE: 'SME_SINGLE_EXCHANGE_COLLAPSE_',
  SET_MERGE_NO_NEW_MEMBERS: 'SET_MERGE_NO_NEW_MEMBERS',
  SET_MERGED: 'SET_MERGED',
  TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE: 'TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE',
  EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE: 'EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE',
  DATE_INVARIANT_OVERRIDE_HELD_VALUE: 'DATE_INVARIANT_OVERRIDE_HELD_VALUE',
  PLAN_RANK_REPLACED_KEPT_VALUE: 'PLAN_RANK_REPLACED_KEPT_VALUE',
  // ---- REFUSE: the write door refused this value --------------------------------------------------
  VALIDATION_RULE_FAILED: 'VALIDATION_RULE_FAILED:',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  REJECTED_INCAPABLE_SOURCE: 'REJECTED_INCAPABLE_SOURCE',
  DEGENERATE_PRICE_BAND: 'DEGENERATE_PRICE_BAND',
  ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR: 'ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR',
  ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND: 'ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND',
  NO_INCOMING_VALUE: 'NO_INCOMING_VALUE',
  NOTHING_TO_RECORD: 'NOTHING_TO_RECORD',
} as const;

export type OutcomeCodeName = keyof typeof OUTCOME_CODE;
export type OutcomeCode = (typeof OUTCOME_CODE)[OutcomeCodeName];

/** The category of every name. A `Record` over the names: a code without a category does not compile. */
export const OUTCOME_CATEGORY: { readonly [K in OutcomeCodeName]: OutcomeCategory } = {
  SOURCE_PRIORITY: 'KEEP',
  DEFAULT_KEEP_EXISTING: 'KEEP',
  TIME_BASED_PRIORITY: 'KEEP',
  TIME_BASED_PRIORITY_EXISTING_NEWER: 'KEEP',
  SAME_SOURCE_REFRESH: 'KEEP',
  SAME_SOURCE_REFRESH_STORED_DOCUMENT_OUTRANKS: 'KEEP',
  SAME_SOURCE_REFRESH_INCOMING_DOCUMENT_OUTRANKS: 'KEEP',
  SAME_SOURCE_REFRESH_EXISTING_NEWER: 'KEEP',
  SOURCE_CHANGED_OWN_VALUE: 'KEEP',
  HELD_DISPUTED_HIGH_VALUE_LIVE: 'KEEP',
  TERMINAL_STATUS_KEPT: 'KEEP',
  BACKWARD_STATUS_KEPT: 'KEEP',
  POSTPONED_KEPT_NO_RELAUNCH: 'KEEP',
  UNTRACKED_EXISTING_VALUE_KEPT: 'KEEP',
  // WRITES / CONFIRMS: the document's set is (or already was) stored -- never a rejection in practice;
  // KEEP so a future path that rejects on them does not walk rank 2 over a document-held set.
  OD129_DOCUMENT_LISTING_WRITES: 'KEEP',
  OD129_DOCUMENT_LISTING_CONFIRMS: 'KEEP',
  // HOLDS: a document/admin-held set and a feed naming a subset of it -- a genuine keep (round 2 missed it).
  OD129_DOCUMENT_LISTING_HOLDS: 'KEEP',
  OD129_DOCUMENT_LISTING_DISAGREES: 'KEEP',
  SME_SINGLE_EXCHANGE_INVARIANT: 'KEEP',
  SME_SINGLE_EXCHANGE_COLLAPSE: 'KEEP',
  SET_MERGE_NO_NEW_MEMBERS: 'KEEP',
  SET_MERGED: 'KEEP',
  TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE: 'KEEP',
  EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE: 'KEEP',
  DATE_INVARIANT_OVERRIDE_HELD_VALUE: 'KEEP',
  PLAN_RANK_REPLACED_KEPT_VALUE: 'KEEP',
  VALIDATION_RULE_FAILED: 'REFUSE',
  VALIDATION_FAILED: 'REFUSE',
  REJECTED_INCAPABLE_SOURCE: 'REFUSE',
  DEGENERATE_PRICE_BAND: 'REFUSE',
  ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR: 'REFUSE',
  ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND: 'REFUSE',
  NO_INCOMING_VALUE: 'REFUSE',
  NOTHING_TO_RECORD: 'REFUSE',
};

/** Names whose code is a PREFIX: the emitted reason is `<code><suffix>` (a rule id, a collapse tier). */
export const OUTCOME_PREFIX_NAMES: ReadonlySet<OutcomeCodeName> = new Set<OutcomeCodeName>([
  'VALIDATION_RULE_FAILED',
  'SME_SINGLE_EXCHANGE_COLLAPSE',
]);

/** The table entry a reason resolves to, or null (an unknown code). */
export function outcomeCodeNameOf(reason: unknown): OutcomeCodeName | null {
  if (typeof reason !== 'string') return null;
  for (const name of Object.keys(OUTCOME_CODE) as OutcomeCodeName[]) {
    const code = OUTCOME_CODE[name];
    if (OUTCOME_PREFIX_NAMES.has(name) ? reason.startsWith(code) && reason.length > code.length : reason === code) {
      return name;
    }
  }
  return null;
}

/** KEEP / REFUSE from the table; an unknown code reads as REFUSE (fail closed). */
export function outcomeCategoryOf(reason: unknown): OutcomeCategory {
  const name = outcomeCodeNameOf(reason);
  return name === null ? 'REFUSE' : OUTCOME_CATEGORY[name];
}
