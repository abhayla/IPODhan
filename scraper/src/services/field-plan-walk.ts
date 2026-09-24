/**
 * The pull walk over `ipo_field_plan` — design §2.4, §2.2 (item 6).
 *
 * This is a SCHEDULING and BOOKKEEPING layer, not a twelfth scraper. It asks
 * ONE field at a time, in the manifest's rank order, through the SAME source
 * fetchers and the SAME consolidated write entry points that already exist,
 * and it commits that field's outcome before claiming the next one. That is
 * what makes §2.2's rule true — "the walk commits one field at a time and is
 * resumable from any point": killed anywhere, it loses at most the one field
 * in flight, whose claim goes stale and is re-claimed by the next walk.
 *
 * THE BRANCH THAT MATTERS MOST. `consolidatedUpsertIPO` can return
 * `skipped: true, skipReason: 'LOCK_NOT_ACQUIRED'` SILENTLY — no throw, no
 * error the caller sees (data-consolidation-orchestrator.ts). A plan row
 * marked SUPPLIED against a write that was dropped is a FALSE-CLEAN STATE:
 * the coverage gate, the PULL-NOOP check and the staging read all count it as
 * a field that was successfully sourced, and nothing ever re-asks it. So the
 * walk decides the plan row FROM THE RESULT of the write, never in parallel
 * with it, and a skipped return goes down `writeHappened: false` — which the
 * repository turns into "state stays PENDING, `attempts` untouched, only the
 * claim released", so the dropped work is retried rather than recorded as done.
 *
 * THE SECOND SILENT RETURN. `recordOutcome` REFUSES and writes nothing when
 * the claim token has been superseded, returning
 * `{ written: false, reason: 'CLAIM_SUPERSEDED' }` rather than throwing. A
 * caller that ignores that return counts an outcome that is not in the table.
 * Worse, a superseded claim means ANOTHER walker now owns this IPO's plan, so
 * continuing would race it field by field. Every call site here reads the
 * return, counts the refusal, and stops the walk.
 *
 * THE THIRD FAILURE MODE, and the one the first version of this comment got
 * WRONG. It claimed `recordOutcome` is called in EVERY branch. That is true of
 * the branches the walk CHOOSES, and false when the settle call itself throws:
 * the repository wraps driver errors in a DatabaseError and rethrows, which
 * propagates past every branch here into document-cycle's per-IPO catch and
 * leaves `claimed_at` set with no outcome -- invisible for the full staleness
 * window. Every settle is therefore wrapped: the claim is RELEASED before the
 * error propagates, so the row is re-claimable immediately rather than
 * stranded. The accurate statement is: every claim is SETTLED -- recorded,
 * released, or released-then-rethrown -- never abandoned.
 *
 * WHAT THIS MODULE DOES NOT DO: it does not fetch (the fetchers are the
 * existing orchestrators), it does not consolidate (item 1's writer does),
 * it does not decide field priority (the manifest did, when items 2/3
 * generated the plan rows), and it never writes a null over a value that
 * failed re-sourcing (§2.6 — EXHAUSTED marks the PLAN row only; the data
 * row's existing value is simply not touched, because this walk only ever
 * calls a writer when it HAS a value).
 */

import { logger } from '../utils/logger.js';
import { normalizeChosen } from './data-consolidation-service.js';
import { areEquivalent } from './normalization-engine.js';
import { getFieldRules } from '../config/field-priority-matrix.js';
import { mapManifestSourceToScraperSource } from '../config/field-source-codes.js';
import { columnToCamelCase } from '../config/field-name-case.js';
import {
  resolveFieldSourcePolicy,
  resolveFieldSourcePolicyAsync,
  policyOriginString,
  type FieldSourcePolicy,
  type OverrideReader,
} from '../config/field-source-policy.js';
import { resolveIpoTypeKey, type PlanIpo } from './field-plan-generator.js';
import { narrowRanksForReopen } from '@ipodhan/shared/utils/settled-field-override-reopen';
import { OVERRIDE_SOURCE_LOST_TO_PRIORITY } from '@ipodhan/shared/utils/conflict-reasons';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { STRUCTURAL_WRITE_SKIP_REASONS, consolidatedWriterCapability } from './consolidated-writer-capability.js';
import {
  fieldPlanGapCodeOf,
  fieldPlanGapToken,
  type FieldPlanGapCode,
} from '@ipodhan/shared/utils/field-plan-config-gap';
import {
  fieldPlanClaimGapKeys,
  fieldPlanGapKeyFor,
  type FieldPlanGapKeySource,
  type FieldPlanIpoGapKeys,
} from './field-plan-gap-keys.js';
import { computeVerdict, type Witness, type Verdict } from './witness-verdict.js';

/**
 * `plan.fieldName` is the manifest's raw snake_case key
 * (field-plan-generator.ts takes it verbatim from `table.field_name`);
 * `consolidatedUpsertIPO`/`consolidatedUpsertChildRows` (and everything they
 * call) read camelCase fields off the payload
 * (data-consolidation-orchestrator.ts reads `scrapedIPO.issueSize`, never
 * `scrapedIPO['issue_size']`). Writing the raw snake_case key writes a field
 * the mapper never reads — no throw, no `skipped: true`, just a silent
 * no-op — so `runWrite` below saw `happened: true` for a write that changed
 * nothing, and the plan row was recorded SUPPLIED against a value that was
 * never persisted (review round 1, C1). `toCamelFieldName` (this file's own private copy) was
 * retired in item 3 slice S1b in favour of the shared `columnToCamelCase` (field-name-case.ts) —
 * byte-identical logic, one place.
 */

/** Which write path a plan row's table takes. */
const SINGLETON_IPO_TABLES: ReadonlySet<string> = new Set(['ipos', 'ipo']);

/**
 * OD-99: the consolidated writer's capability for the path THIS walk takes for
 * `tableName` (`runWrite`: the ipos upsert, or the child-row upsert). Folded
 * into a WRITER_CANNOT_ACCEPT row's gap key (field-plan-gap-keys.ts).
 */
export function fieldPlanWriterCapability(tableName: string): string {
  return consolidatedWriterCapability(SINGLETON_IPO_TABLES.has(tableName) ? 'ipo' : 'child', tableName);
}

export interface FieldPlanWalkResult {
  ipoId: string;
  fieldsAttempted: number;
  fieldsSupplied: number;
  /** Retired: every rank gave a DEFINITIVE no. Terminal. */
  fieldsExhausted: number;
  /** Not retired: at least one rank failed transiently (re-asked next data slot) or every rank hit a structural gap (re-asked when its gap key changes, F-152). */
  fieldsCheckFailed: number;
  fieldsSkippedProtected: number;
  /** Fields whose write was DROPPED — left PENDING, attempts untouched. */
  fieldsWriteSkipped: number;
  /** Fields re-askable later (NOT_AVAILABLE_YET). */
  fieldsNotAvailableYet: number;
  /** Of those, how many got a PROVISIONAL value from a lower rank meanwhile. */
  fieldsProvisional: number;
  /** `recordOutcome` returns that were REFUSED (CLAIM_SUPERSEDED). */
  outcomesRefused: number;
  /** Settle calls that THREW (the DB was unreachable); the claim was released. */
  outcomesFailed: number;
  stoppedReason: 'NO_DUE_FIELDS' | 'BUDGET_EXHAUSTED' | 'CLAIM_SUPERSEDED';
  /**
   * Identities behind `fieldsWriteSkipped` (review round 2, signal-ownership
   * R1: a count is not a reading). `document-cycle.ts`'s PASS 3 summary
   * names these, capped, the same way `BlockedDocumentDetail` already does
   * for extraction_blocked/extraction_failed (#623) — a caller aggregating
   * this across every IPO's walk in the cycle is what makes "13 rows
   * wrongly EXHAUSTED" a readable line instead of a number a human has to
   * go query for.
   */
  droppedWrites: Array<{
    tableName: string;
    rowKey: string;
    fieldName: string;
    source: string;
    skipReason: string;
  }>;
  /** Identities behind `fieldsExhausted` — the exact class RCA2's 13 wrongly-retired rows sat in. */
  exhaustedFields: Array<{ tableName: string; rowKey: string; fieldName: string }>;
}

export type FieldFetcherAnswer =
  | {
      outcome: 'SUPPLIED';
      value: unknown;
      documentId?: string;
      documentType?: string;
      sha256?: string;
      page?: number;
      /**
       * OD-99 (OD-73): the value ALREADY stored for this field in its target
       * table, when the fetcher read it (e.g. the INVESTORGAIN_GMP fetcher
       * answers from the gmp_records row the GMP job wrote). Present and equal
       * to `value` (numerically, `areEquivalent`) -> the walk records SUPPLIED
       * and writes nothing. Omitted -> the walk always writes.
       */
      stored?: { value: unknown };
    }
  | { outcome: 'NOT_PRINTED' }
  | { outcome: 'NOT_AVAILABLE_YET' }
  | {
      outcome: 'CHECK_FAILED';
      reason: string;
      /**
       * Is this failure a fact about THIS MINUTE rather than about the field?
       *
       * A fetcher knows which of the two it hit; the walk cannot tell from a
       * free-text `reason` without guessing, and guessing at the meaning of a
       * free-text label is how this repo has produced confident wrong answers
       * before. So the fetcher DECLARES it.
       *
       * DEFAULT (omitted) is `true` -- transient -- because the two mistakes
       * are not symmetric. Treating a definitive failure as transient costs a
       * re-ask next data slot. Treating a transient failure as
       * definitive retires the field forever. An adapter author who has not
       * thought about it gets the recoverable error.
       */
      transient?: boolean;
      /**
       * #884 review round 1 (MINOR-3): set when this failure is a GAP in our
       * own configuration or code (closed list, `FIELD_PLAN_GAP_CODES`), never
       * a fact about the field. The walk classifies on THIS, never on `reason`.
       */
      gap?: FieldPlanGapCode;
    };

export type FieldFetcher = (
  ipoId: string,
  tableName: string,
  rowKey: string,
  fieldName: string
) => Promise<FieldFetcherAnswer>;

/**
 * True when the admin field-protection gate withholds this field, in which
 * case §2.7 says skip it and store NO state.
 */
export type ProtectionFilter = (
  ipoId: string,
  tableName: string,
  fieldName: string
) => Promise<boolean>;

/**
 * A real interface, not `Record<string, unknown>` (S1a review CRITICAL-1):
 * an untyped bag let `policyOrigin` be passed at every call site and silently
 * dropped by `recordOutcome`'s SQL. The field is optional; the guard that it
 * reaches the SQL is tests/integration/field-plan-walk-resume.integration.test.ts.
 */
export interface RecordOutcomeCallParams {
  planRowId: string;
  claimToken: string;
  writeHappened: boolean;
  skipReason?: string;
  state?: string;
  chosen?: {
    source?: string | null;
    rank?: number | null;
    documentId?: string | null;
    documentType?: string | null;
    sha256?: string | null;
    page?: number | null;
  };
  /** 'registry:<version>' | 'override:<id>' — see `RecordOutcomeParams` in the shared repository. */
  policyOrigin?: string | null;
  /** S4 (#779): the classification of why this attempt did not end SUPPLIED — see `classifyFailure`. */
  reasonCode?: string | null;
  /** S4 (#779): the raw cause the classification was derived from. */
  cause?: string | null;
  /** #884: set only when every rank failed with a structured gap code (see RecordOutcomeParams.gapKey). */
  gapKey?: string | null;
  /** OD-99: a WRITER_CANNOT_ACCEPT gap is still charged (see RecordOutcomeParams.gapChargesAttempt). */
  gapChargesAttempt?: boolean;
}

/** The slice of item 5's repository the walk uses. */
export interface FieldPlanWalkRepository {
  claimNextDueField(params: {
    ipoId?: string;
    excludeIds?: string[];
    gapKeys?: Record<string, readonly string[]>;
  }): Promise<any | null>;
  recordOutcome(
    params: RecordOutcomeCallParams
  ): Promise<{ written: boolean; reason?: string; skipped?: boolean }>;
  releaseClaimUnrecorded(params: {
    planRowId: string;
    claimToken: string;
  }): Promise<{ released: boolean; reason?: string }>;
  /** #968 (OD-95): end an override reopen -- back to SUPPLIED (evidence untouched) stamped with the
   *  order it was tried under, or handed to supersession when `supersededBy` is given. */
  restoreSettledAfterReopen?(params: {
    planRowId: string;
    claimToken: string;
    cause: string;
    tried: { policyOrigin: string; rank1Source: string | null; rank2Source: string | null; rank3Source: string | null };
    supersededBy?: string | null;
  }): Promise<{ restored: boolean; handedToSupersession?: boolean }>;
}

/** The slice of item 1's orchestrator the walk uses. */
export interface FieldPlanWalkOrchestrator {
  /**
   * `preResolvedIPO` (review round 2, RCA1): `consolidatedUpsertIPO`
   * unconditionally calls `computeIpoIdentitySlug(scrapedIPO)` before it even
   * looks at this argument, so the payload MUST carry real identity fields
   * (companyName at minimum) even when a pre-resolved row is supplied. The
   * walk's `runWrite` builds that payload from the row `preResolvedIPO`
   * itself names — see `identityFieldsFor` below.
   *
   * `onlyFields` (review round 3, MAJOR): those SAME spread-in identity
   * fields would otherwise enter consolidation as this write's OWN claim
   * under `source`/`confidence` — fabricated provenance for fields the walk
   * never fetched. The walk always passes exactly `[camelField]`, the one
   * field it actually supplied.
   */
  consolidatedUpsertIPO(
    scraped: any,
    source: any,
    confidence?: number,
    preResolvedIPO?: any,
    onlyFields?: string[]
  ): Promise<any>;
  consolidatedUpsertChildRows(
    ipoId: string,
    tableName: any,
    rows: any[],
    source: any,
    docType?: string,
    confidence?: number
  ): Promise<any>;
}

/** The slice of IPORepository the walk needs to pre-resolve identity for a singleton write. */
export interface FieldPlanWalkIPORepository {
  findById(ipoId: string): Promise<any | null>;
}

export interface FieldPlanWalkDeps {
  fieldPlanRepository: FieldPlanWalkRepository;
  orchestrator: FieldPlanWalkOrchestrator;
  /** One fetcher per rank-eligible source name, keyed as the manifest names it. */
  sourceFetchers: Record<string, FieldFetcher>;
  /**
   * #884 review round 2: `buildFieldPlanGapKeySource()` for THIS cycle,
   * resolved once per IPO walk into per-field keys (the field's own manifest
   * entry content + fetcher coverage + extractor version, and a variant with
   * the IPO's COMPLETED documents for NO_DOCUMENT_PROVENANCE). A row whose
   * every rank failed with a gap code is recorded under its field's key and
   * not re-offered until that key changes. Omitted (or unresolvable for this
   * IPO), gap failures are charged as ordinary attempts (the bounded pre-#884
   * behaviour) — never an unbounded re-ask.
   */
  gapKeys?: FieldPlanGapKeySource;
  protectionFilter?: ProtectionFilter;
  /**
   * Review round 2, RCA1: the walk's own write path needs the SAME existing
   * row the DOC fetcher already reads (findById is Redis-cached, so this is
   * not a second query pattern) — `consolidatedUpsertIPO({ id, [field]: value
   * })` alone has no companyName/symbol/isin, so it can never resolve to an
   * existing row and falls into a CREATE that throws on NOT NULL columns.
   */
  ipoRepository: FieldPlanWalkIPORepository;
  /**
   * The one resolver (item 3 slice S1a). Both `attemptOneField` and
   * `tryProvisional` build their ask order from ONE call to this per field
   * per walk (`policy.ranks`), never from the plan row's own rank columns —
   * those stay the generator's record; S2 reconciles them when they drift.
   * Defaulted to the real `resolveFieldSourcePolicy` so production callers
   * need not wire it; tests stub it to prove the walk follows it.
   */
  resolvePolicy?: (query: {
    table: string;
    column: string;
    ipoType: string;
    ipoId?: string;
  }) => FieldSourcePolicy | Promise<FieldSourcePolicy>;
  /**
   * CRITICAL-1 fix (S4 review round 2): layer 2 (active `field_source_overrides` rows), consulted
   * by `defaultResolvePolicy` via `resolveFieldSourcePolicyAsync`. Optional and defaulted to
   * undefined in production callers that have not wired a repository yet — `resolveFieldSourcePolicyAsync`
   * with no `overrides` behaves exactly like the sync registry-only resolver (safe when the table
   * is absent, per the resolver's own contract). A caller that supplies an explicit `resolvePolicy`
   * (as every existing test does) bypasses this entirely — this field only affects the DEFAULT path.
   */
  overrides?: OverrideReader;
  /**
   * S3b-2 (docs/design/s3b2-verdict-writer-plan.md): writes the computed verdict + witnesses onto
   * the SAME field_sources row `runWrite` already wrote this pass — a second CALL, not a second
   * writer (`trackFieldUpdate`, field-sources-repository.ts, stays the single insertion point).
   * Narrow function dependency (matching `resolvePolicy`'s shape above), not the whole
   * repository, so a test stubs exactly what it needs. Defaulted (via field-plan-walk-deps.ts) to
   * `FieldSourcesRepository.trackFieldUpdate`; only ever called when
   * `FEATURE_FLAGS.ENABLE_VERDICT_WRITER` is true AND the field's `comparisonFamily !== 'ABSTAIN'`.
   */
  trackWitnessVerdict?: (input: {
    ipoId: string;
    tableName: string;
    rowKey: string;
    fieldName: string;
    source: string;
    witnesses: Witness[];
    verdict: Verdict;
  }) => Promise<unknown>;
  /**
   * #968 fix round 1, finding 3 (OD-91): before a reopened settled row is restored, the OD-91
   * supersession rule is run for it (`findSupersessorForReopenedRow`, plan-supersession.ts), so a
   * better document that completed while the row was reopened is not lost. Optional: absent, the
   * row is restored as before.
   */
  supersessionForReopened?: (ipoId: string, planRowId: string) => Promise<{ supersededBy: string; cause: string } | null>;
  /**
   * #968 fix round 1, finding 2 (OD-61, OD-75 shape): the admin conflicts list writer
   * (`DataConflictsRepository.upsertConflict`). Used when an override's higher source answered and
   * the priority matrix kept the settled value (reason OVERRIDE_SOURCE_LOST_TO_PRIORITY).
   */
  logAdminConflict?: (input: {
    ipoId: string;
    tableName: string;
    rowKey?: string;
    fieldName: string;
    source1: any;
    value1: string | null;
    source2: any;
    value2: string | null;
    resolutionReason: string;
    severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  }) => Promise<unknown>;
}

/**
 * Default `resolvePolicy` — CRITICAL-1 fix (S4 review round 2): now the override-aware async
 * resolver, not the registry-only sync one. `overrides` is threaded from `FieldPlanWalkDeps` by
 * `resolvePolicyForPlan` below; when it is undefined (no repository wired), this is byte-for-byte
 * the old registry-only behaviour (`resolveFieldSourcePolicyAsync` with no `deps.overrides` falls
 * straight through to `resolveFieldSourcePolicy`).
 */
function defaultResolvePolicy(
  query: { table: string; column: string; ipoType: string; ipoId?: string },
  overrides?: OverrideReader
): Promise<FieldSourcePolicy> {
  return resolveFieldSourcePolicyAsync(query, { overrides });
}

/**
 * Resolve one IPO's type key ONCE per walk run (S1a review MINOR-2), never
 * once per field: `findById` is Redis-cached so a repeat call is cheap, but
 * `resolvePolicyForPlan` used to call it for every field on the IPO — N
 * reads for an N-field walk when the type cannot change mid-walk. Memoized
 * by closing over a single promise the first caller creates; every
 * subsequent field in the same `walkFieldPlanForIPO` call awaits the SAME
 * promise instead of issuing its own read.
 *
 * Returns `null` when the IPO row cannot be read at all — a real gap
 * `deps.ipoRepository` already tolerates elsewhere in this file. The caller
 * (`resolvePolicyForPlan`) treats that as "policy cannot be resolved", never
 * as a silent MAINBOARD guess (S1a review MINOR-1).
 */
function makeIpoTypeResolver(
  ipoId: string,
  deps: FieldPlanWalkDeps
): () => Promise<ReturnType<typeof resolveIpoTypeKey> | null> {
  let cached: Promise<ReturnType<typeof resolveIpoTypeKey> | null> | undefined;
  return () => {
    if (!cached) {
      cached = deps.ipoRepository.findById(ipoId).then((existing) =>
        existing
          ? resolveIpoTypeKey({
              id: ipoId,
              segment: (existing.segment as PlanIpo['segment']) ?? null,
              listingExchanges: (existing.listingExchanges as PlanIpo['listingExchanges']) ?? null,
            })
          : null
      );
    }
    return cached;
  };
}

/**
 * Resolve one field's policy for the walk: use the walk-scoped memoized IPO
 * type (see `makeIpoTypeResolver`), then ask the resolver. When the IPO row
 * cannot be read at all, returns `ipoRowNotFound: true` instead of guessing
 * MAINBOARD ranks for what might be an SME issue (S1a review MINOR-1) — the
 * caller records the field as CHECK_FAILED rather than walking wrong ranks.
 */
async function resolvePolicyForPlan(
  plan: any,
  deps: FieldPlanWalkDeps,
  resolveIpoType: () => Promise<ReturnType<typeof resolveIpoTypeKey> | null>
): Promise<{ outcome: 'IPO_ROW_NOT_FOUND' } | { outcome: 'RESOLVED'; policy: FieldSourcePolicy }> {
  // A string-literal discriminant, not a boolean one: with this project's
  // `strict: false` (no `strictNullChecks`), TS fails to narrow a
  // `{ x: true } | { x: false; ... }` union after an `if (r.x)` check — a
  // real compiler quirk reproduced standalone while fixing this finding —
  // but narrows correctly on a string-literal `outcome` tag either way.
  // CRITICAL-1 fix (S4 review round 2): the default path closes over `deps.overrides` so the walk
  // consults layer 2 without changing the `deps.resolvePolicy` override's 1-arg call signature —
  // every existing test that stubs `resolvePolicy` is untouched; only the production default changes.
  const resolvePolicy = deps.resolvePolicy ?? ((query: { table: string; column: string; ipoType: string; ipoId?: string }) =>
    defaultResolvePolicy(query, deps.overrides));
  const ipoType = await resolveIpoType();
  if (ipoType === null) {
    return { outcome: 'IPO_ROW_NOT_FOUND' };
  }
  const policy = await resolvePolicy({ table: plan.tableName, column: plan.fieldName, ipoType, ipoId: plan.ipoId });
  return { outcome: 'RESOLVED', policy };
}

export interface FieldPlanWalkBudget {
  /** Absolute deadline on the CALLER's clock, exactly like PASS 2's. */
  deadlineMs: number;
  now: () => number;
}

/**
 * Review round 5, item A: `runWrite` returning `{ happened: true }` used to
 * be trusted as "the consolidator stored our value" — but the write path is
 * a CONSOLIDATED writer (item 1), not a dumb setter: when a higher-priority
 * source's value is already stored (e.g. CHITTORGARH outranks BSE for
 * issue_size, T-453), `consolidatedUpsertIPO` KEEPS the existing value and
 * still returns `skipped: false` — the write "happened" in the sense that no
 * lock/create error occurred, but OUR value never landed. Recording SUPPLIED
 * from that return alone put 7 false rows on staging (review round 5): the
 * plan said "sourced from BSE", `field_sources` said CHITTORGARH.
 *
 * `happened` and `accepted` are now separate questions. `accepted: false`
 * means the write reached the consolidator without a lock/create/DB error,
 * but the consolidator's OWN result disagrees that OUR source/value won —
 * this is a settled, re-askable fact (CHECK_FAILED, transient), never a
 * PENDING drop (this write did not fail to happen; it happened and lost).
 */
type WriteVerdict =
  | { happened: true; accepted: true }
  | { happened: true; accepted: false; reason: string }
  | { happened: false; skipReason: string };

/**
 * Evidence is ALL-OR-NOTHING (item 5's contract): `chosen` provided at all
 * replaces every one of the six columns from THAT object, so a key omitted
 * here would silently become NULL rather than keeping a previous source's
 * value. Building the complete six-key object in one place is what stops a
 * partial evidence write reintroducing the false-provenance defect item 5
 * fixed in review.
 */
function evidenceFor(
  source: string,
  rank: number,
  answer: Extract<FieldFetcherAnswer, { outcome: 'SUPPLIED' }>
) {
  return {
    source,
    rank,
    documentId: answer.documentId ?? null,
    documentType: answer.documentType ?? null,
    sha256: answer.sha256 ?? null,
    page: answer.page ?? null,
  };
}

/**
 * Run §2.4's loop for ONE IPO until its due fields are drained or the shared
 * budget is spent. The budget is the CALLER's remaining wake budget — this
 * function never computes its own.
 */
export async function walkFieldPlanForIPO(
  ipoId: string,
  deps: FieldPlanWalkDeps,
  budget: FieldPlanWalkBudget
): Promise<FieldPlanWalkResult> {
  const result: FieldPlanWalkResult = {
    ipoId,
    fieldsAttempted: 0,
    fieldsSupplied: 0,
    fieldsExhausted: 0,
    fieldsCheckFailed: 0,
    fieldsSkippedProtected: 0,
    fieldsWriteSkipped: 0,
    fieldsNotAvailableYet: 0,
    fieldsProvisional: 0,
    outcomesRefused: 0,
    outcomesFailed: 0,
    stoppedReason: 'NO_DUE_FIELDS',
    droppedWrites: [],
    exhaustedFields: [],
  };

  /**
   * Rows this walk has already settled.
   *
   * TWO of the walk's branches deliberately leave a row IMMEDIATELY
   * re-claimable — a dropped write (PENDING, attempts untouched) and an
   * admin-protection skip (claim released, nothing recorded). That is correct
   * for the NEXT cycle and a livelock inside THIS one: `claimNextDueField`
   * orders by `next_due_at NULLS FIRST`, so the row this walk just released
   * is the very next row it claims, forever. Found by the integration test
   * against the real claim SQL; a stubbed repository handing rows out of an
   * array cannot expose it, because its queue empties.
   *
   * So the walk remembers what it has settled and stops when the only rows
   * left due are ones it already handled this pass. The table is untouched by
   * this — the rows really are due, and the next cycle really should re-ask
   * them.
   */
  const settledThisWalk = new Set<string>();

  // #884 review round 2: this IPO's per-field gap keys, resolved ONCE per walk
  // (the documents part reads the IPO's documents). Unresolvable → null: gap
  // rows are not offered and a gap failure is charged (bounded), never unkeyed.
  let ipoGapKeys: FieldPlanIpoGapKeys | null = null;
  if (deps.gapKeys) {
    try {
      ipoGapKeys = await deps.gapKeys.forIpo(ipoId);
    } catch (err) {
      logger.warn(
        { ipoId, err: (err as Error).message, cause: (err as { cause?: { message?: string } }).cause?.message },
        'PASS 3: gap keys unresolvable for this IPO — gap rows not offered, gap failures charged this walk'
      );
    }
  }
  const claimGapKeys = ipoGapKeys ? fieldPlanClaimGapKeys(ipoGapKeys) : null;

  // One IPO-type read for the whole walk (S1a review MINOR-2) — every field
  // on this IPO shares the same memoized resolver rather than each paying
  // its own `findById`.
  const resolveIpoType = makeIpoTypeResolver(ipoId, deps);

  for (;;) {
    // Checked BEFORE the claim, so the walk never takes a claim it has no
    // budget to settle — a claimed-but-unsettled row is exactly the stuck
    // `claimed_at` the staging proof reads as a crash.
    if (budget.now() >= budget.deadlineMs) {
      result.stoppedReason = 'BUDGET_EXHAUSTED';
      logger.info(
        { ipoId, ...countsOf(result) },
        'PASS 3 field-plan walk stopped: shared wake budget exhausted — remaining fields resume next cycle'
      );
      return result;
    }

    // #762 review round 2 CRITICAL fix: exclude ids this walk has ALREADY
    // settled (released-but-still-due rows -- a dropped write left PENDING,
    // or an admin-protection skip) so the claim query cannot hand the SAME
    // row back. Before this, `pri = 0` guaranteed a released PENDING row
    // outranked every reclaim/verify leg, so the very next claim WAS that
    // row again -- and the `settledThisWalk.has(plan.id)` branch below then
    // stopped the WHOLE walk, discarding every other due row on the IPO.
    // Reproduced live: 180 PENDING rows on one staging IPO would have hit
    // this on the first cycle after deploy.
    const plan = await deps.fieldPlanRepository.claimNextDueField({
      ipoId,
      excludeIds: Array.from(settledThisWalk),
      ...(claimGapKeys ? { gapKeys: claimGapKeys } : {}),
    });
    if (!plan) {
      result.stoppedReason = 'NO_DUE_FIELDS';
      return result;
    }

    // Everything still due is something this walk already handled — see
    // `settledThisWalk`. Release the claim (it is this walk's own, taken one
    // line ago) and stop, rather than spinning on it until the budget dies.
    if (settledThisWalk.has(plan.id)) {
      await deps.fieldPlanRepository.releaseClaimUnrecorded({
        planRowId: plan.id,
        claimToken: plan.claimToken,
      });
      result.stoppedReason = 'NO_DUE_FIELDS';
      return result;
    }
    settledThisWalk.add(plan.id);

    // §2.7 — an admin-protected field is SKIPPED and stores NO state. The
    // claim is released without an attempt being charged, so the field's
    // attempt budget is not spent on work that was never done.
    if (deps.protectionFilter) {
      let isProtected = false;
      try {
        isProtected = await deps.protectionFilter(ipoId, plan.tableName, plan.fieldName);
      } catch (error) {
        // A protection gate that cannot answer must not be read as "not
        // protected" — that would let the walk overwrite an admin value.
        // Treat it as protected and skip.
        isProtected = true;
        logger.warn(
          { ipoId, field: plan.fieldName, error: causeOf(error) },
          'PASS 3: field-protection check failed — skipping the field rather than risking an admin overwrite'
        );
      }
      if (isProtected) {
        result.fieldsSkippedProtected += 1;
        // F4: this release IS this branch's settle, so a throw here strands
        // the claim exactly as a throwing `recordOutcome` would. There is no
        // second repair to attempt (the repair and the settle are the same
        // call), so it is counted, logged with its cause, and propagated --
        // never swallowed into a walk that looks like it skipped cleanly.
        let released: { released: boolean; reason?: string };
        try {
          released = await deps.fieldPlanRepository.releaseClaimUnrecorded({
            planRowId: plan.id,
            claimToken: plan.claimToken,
          });
        } catch (error) {
          result.outcomesFailed += 1;
          result.fieldsSkippedProtected -= 1;
          logger.error(
            { ipoId, field: plan.fieldName, error: causeOf(error) },
            'PASS 3: releasing a protected field THREW — the claim stays set until the staleness window reclaims it'
          );
          throw error;
        }
        if (!released.released) {
          result.outcomesRefused += 1;
          result.stoppedReason = 'CLAIM_SUPERSEDED';
          logger.warn(
            { ipoId, field: plan.fieldName, reason: released.reason },
            'PASS 3: claim superseded while skipping a protected field — another walker owns this plan; stopping'
          );
          return result;
        }
        continue;
      }
    }

    result.fieldsAttempted += 1;
    const settled = await attemptOneField(ipoId, plan, deps, result, resolveIpoType, ipoGapKeys);
    if (settled === 'SUPERSEDED') {
      result.stoppedReason = 'CLAIM_SUPERSEDED';
      return result;
    }
  }
}

/**
 * #968 (OD-95): end an override reopen and release the claim.
 *
 * `triedOrigin` / `triedRanks` are the FULL effective order the row was just
 * tried under (before narrowing). They are stamped on the row so the next plan
 * pass under the same override decides NONE: one reopen per distinct override
 * (fix round 1, finding 1). Before restoring, the OD-91 supersession rule is run
 * for the row (finding 3); a better document that completed during the reopen
 * takes the row instead of the outranked evidence coming back.
 *
 * A repository without the method (an old mock) releases the claim unrecorded
 * instead: the row stays reopened and narrowed, never overwritten by a lower source.
 */
async function restoreReopened(
  ipoId: string,
  plan: any,
  deps: FieldPlanWalkDeps,
  cause: string,
  triedOrigin: string,
  triedRanks: ReadonlyArray<string | null>
): Promise<'SETTLED' | 'SUPERSEDED'> {
  if (deps.fieldPlanRepository.restoreSettledAfterReopen) {
    const supersession = deps.supersessionForReopened ? await deps.supersessionForReopened(ipoId, plan.id) : null;
    logger.info(
      { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, cause, triedOrigin, supersession },
      supersession
        ? 'PASS 3: override-reopened row handed to supersession, a better document completed during the reopen (OD-91, OD-95)'
        : 'PASS 3: override-reopened settled row restored to SUPPLIED, stamped with the order it was tried under (OD-95)'
    );
    const { restored, handedToSupersession } = await deps.fieldPlanRepository.restoreSettledAfterReopen({
      planRowId: plan.id,
      claimToken: plan.claimToken,
      cause: supersession ? supersession.cause : cause,
      tried: {
        policyOrigin: triedOrigin,
        rank1Source: triedRanks[0] ?? null,
        rank2Source: triedRanks[1] ?? null,
        rank3Source: triedRanks[2] ?? null,
      },
      supersededBy: supersession?.supersededBy ?? null,
    });
    return restored || handedToSupersession ? 'SETTLED' : 'SUPERSEDED';
  }
  const { released } = await deps.fieldPlanRepository.releaseClaimUnrecorded({
    planRowId: plan.id,
    claimToken: plan.claimToken,
  });
  return released ? 'SETTLED' : 'SUPERSEDED';
}

/**
 * One field: walk ranks 1..3, write on the first SUPPLIED answer, and record
 * an outcome in EVERY branch. Returns 'SUPERSEDED' when `recordOutcome`
 * refused — the signal that another walker has taken this plan over.
 */
async function attemptOneField(
  ipoId: string,
  plan: any,
  deps: FieldPlanWalkDeps,
  result: FieldPlanWalkResult,
  resolveIpoType: () => Promise<ReturnType<typeof resolveIpoTypeKey> | null>,
  ipoGapKeys: FieldPlanIpoGapKeys | null
): Promise<'SETTLED' | 'SUPERSEDED'> {
  const policyResolution = await resolvePolicyForPlan(plan, deps, resolveIpoType);
  if (policyResolution.outcome === 'IPO_ROW_NOT_FOUND') {
    // S1a review MINOR-1: the IPO row could not be read at all, so there is
    // no type key to resolve ranks from — never guess MAINBOARD for what may
    // be an SME issue. This is a fact about THIS MINUTE (the row may be
    // readable next pass), so CHECK_FAILED/transient, never a terminal state
    // and no ranks are walked.
    result.fieldsCheckFailed += 1;
    logger.warn(
      { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName },
      'PASS 3: ipo row not found for policy resolution — CHECK_FAILED, re-asked next data slot (no ranks guessed)'
    );
    return recordAndClassify(deps, result, {
      planRowId: plan.id,
      claimToken: plan.claimToken,
      writeHappened: true,
      state: 'CHECK_FAILED',
    });
  }
  let policy = policyResolution.policy;
  const policyOrigin = policyOriginString(policy.origin);
  // The full effective order, before any #968 narrowing: what a restore records as tried.
  const fullRanks: ReadonlyArray<string | null> = [...policy.ranks];

  // #968 (spec §2.3.5, OD-73, OD-95): a SETTLED row an override reopened. Only the
  // sources ranked ABOVE the settling source in the current effective order are
  // asked (a prefix, so rank numbers are unchanged), so a source at or below it can
  // never overwrite the settled value. The narrowing is the stored
  // `reopened_under_policy`, so it holds on every pass. If that override is no
  // longer the effective order (expired or replaced) or nothing ranks above the
  // settling source any more, the row goes back to SUPPLIED with its value.
  const reopenedUnder: string | null = plan.reopenedUnderPolicy ?? null;
  if (reopenedUnder) {
    const narrowed = plan.chosenSource ? narrowRanksForReopen(policy.ranks, plan.chosenSource) : [...policy.ranks];
    if (policyOrigin !== reopenedUnder || narrowed.length === 0) {
      return restoreReopened(
        ipoId,
        plan,
        deps,
        policyOrigin !== reopenedUnder
          ? `OVERRIDE_RESTORED: ${reopenedUnder} is no longer the effective order (now ${policyOrigin}); settled value kept (OD-95)`
          : `OVERRIDE_RESTORED: no source ranks above ${plan.chosenSource} under ${reopenedUnder}; settled value kept (OD-95)`,
        policyOrigin,
        fullRanks
      );
    }
    policy = { ...policy, ranks: narrowed as typeof policy.ranks };
  }
  const ranks: [number, string | null][] = policy.ranks.map((source, i) => [i + 1, source]);

  const planRanks = [plan.rank1Source, plan.rank2Source, plan.rank3Source].filter(Boolean);
  const policyRanksDiffer =
    planRanks.length !== policy.ranks.length || planRanks.some((s, i) => s !== policy.ranks[i]);
  if (policyRanksDiffer) {
    logger.warn(
      { ipoId, table: plan.tableName, field: plan.fieldName, policyRanks: policy.ranks, planRanks },
      'PASS 3: policy ranks differ from plan row'
    );
  }
  logger.info(
    { ipoId, table: plan.tableName, field: plan.fieldName, policyOrigin, ranks: policy.ranks.join(',') },
    `PASS 3: policy origin=${policyOrigin} ranks=${policy.ranks.join(',')}`
  );

  const failures: string[] = [];
  /**
   * Did any rank fail for a reason that might not fail again?
   *
   * F1 (Tier A review): every all-ranks fallthrough used to record EXHAUSTED,
   * which is in the repository's TERMINAL_STATES -- `next_due_at` is nulled
   * and NOTHING reopens the row. So three network timeouts in one pass
   * permanently retired a field. Nobody decided to retire it; a flaky minute
   * did.
   *
   * The distinction that fixes it is not "how many times has this failed" but
   * "did every source actually ANSWER". A definitive answer (NOT_PRINTED --
   * this source never carries this field; a structural CHECK_FAILED -- the
   * page parsed and the field is not in it) is a fact about the world that
   * will read the same next pass. A throw, a timeout, or a source with no
   * adapter registered is a fact about THIS MINUTE.
   *
   * Chosen over an attempts-cap deliberately: a cap still retires a field
   * permanently once N transient failures accumulate, so a genuinely flaky
   * source is retired on a slower clock rather than not at all, and the row
   * that gets retired is the one whose source is WORST, not the one whose
   * answer is settled. Classification makes EXHAUSTED mean what it says --
   * every source gave a definitive answer. The transient path is re-asked
   * once per OD-19 data slot (F-152 removed the 15m -> 6h elapsed-time
   * backoff) and bounded by FIELD_PLAN_RECLAIM_MAX_ATTEMPTS at claim time, so
   * a permanently-broken adapter degrades to at most one re-ask per slot,
   * never a hot loop.
   */
  let sawTransientFailure = false;

  /**
   * S3a (docs/design/s3a-collect-witnesses-plan.md): every SUPPLIED answer in
   * this pass, in rank order. The rank loop below no longer RETURNS on the
   * first SUPPLIED answer -- it keeps asking lower ranks so all of them can
   * be logged together. The WRITE still happens exactly once, with the
   * lowest-rank SUPPLIED answer, which is exactly what the old find-first
   * loop returned -- see the `winner` write-out after the loop. The other
   * answers go nowhere yet: S2's `witnesses` column is filled by S3b, not
   * here (trap 1: `tryProvisional` overlaps this collection but is NOT
   * deleted in S3a -- deleting it would change the NOT_AVAILABLE_YET
   * behaviour, which is a different slice with its own proof).
   */
  const suppliedAnswers: Array<{
    rank: number;
    source: string;
    answer: Extract<FieldFetcherAnswer, { outcome: 'SUPPLIED' }>;
  }> = [];
  let winner: { rank: number; source: string; answer: Extract<FieldFetcherAnswer, { outcome: 'SUPPLIED' }> } | null =
    null;

  for (const [rank, source] of ranks) {
    // No source at this rank for this IPO's type (§2.3.5 capability) — not a
    // failure, just nothing to ask here.
    if (!source) continue;

    const fetcher = deps.sourceFetchers[source];
    if (!fetcher) {
      // A source named in the plan with no fetcher registered is a real
      // configuration gap, but it is this RANK's failure, not the field's —
      // ranks 2 and 3 may still answer. Named in the cause so the gap is
      // identifiable from the log line (signal-ownership R6).
      // TRANSIENT: a missing adapter is a deployment/config state, not the
      // source answering "this field is not here". Registering the adapter
      // must be enough to make the field askable again -- retiring it
      // terminally would mean a config gap silently outlived its own fix.
      failures.push(`rank${rank}:${source}:NO_FETCHER_REGISTERED ${fieldPlanGapToken('NO_FETCHER')}`);
      sawTransientFailure = true;
      continue;
    }

    let answer: FieldFetcherAnswer;
    try {
      answer = await fetcher(ipoId, plan.tableName, plan.rowKey, plan.fieldName);
    } catch (error) {
      // TRANSIENT: a throw is a socket, a timeout, a 503 -- this minute's
      // fact, not the field's. Never an abandoned claim either: falling out
      // of the walk here would strand `claimed_at`. Tagged `:THROWN:` so
      // `classifyFailure` (#785) can tell "the source could not even be
      // asked" apart from a transient CHECK_FAILED reason string, which
      // shares the same `rank<N>:<source>:...` shape but means something
      // different (the source WAS reached and answered).
      failures.push(`rank${rank}:${source}:THROWN:${causeOf(error)}`);
      sawTransientFailure = true;
      continue;
    }

    if (answer.outcome === 'NOT_PRINTED') {
      // §2.4: no retry, no error — this source never carries this field.
      continue;
    }

    if (answer.outcome === 'CHECK_FAILED') {
      // `transient` defaults to TRUE when the fetcher does not say: see the
      // field's doc comment for why the two mistakes are not symmetric.
      const isTransient = answer.transient !== false;
      // Tagged `:CHECK_FAILED:` (definitive suffix unchanged) so a transient
      // instance is unambiguously distinguishable from a thrown error above
      // (#785) — both otherwise share the same `rank<N>:<source>:...` shape.
      failures.push(
        `rank${rank}:${source}:CHECK_FAILED:${answer.reason}${isTransient ? '' : ' (definitive)'}${
          answer.gap ? ` ${fieldPlanGapToken(answer.gap)}` : ''
        }`
      );
      if (isTransient) sawTransientFailure = true;
      continue;
    }

    if (answer.outcome === 'NOT_AVAILABLE_YET') {
      // The authoritative source has not published this field yet.
      //
      // F3 (Tier A review): the first version returned here immediately, on
      // the reasoning that "a later-ranked source cannot know it earlier".
      // That was an assumption, never verified, and the card says the
      // opposite in §2.4's own words: try rank+1 for a PROVISIONAL value. It
      // is right and the assumption was wrong -- a lower-ranked aggregator
      // routinely carries an indicative figure before the exchange posts the
      // authoritative one (GMP and expected listing dates are the obvious
      // cases). Publishing that value while the ask stays open is strictly
      // better than publishing nothing.
      //
      // The state recorded is NOT_AVAILABLE_YET either way, whether or not a
      // provisional value was found: it is non-terminal, so the field keeps
      // being re-asked until the authoritative source answers, and the
      // provisional value is replaced the moment it does. Recording SUPPLIED
      // here would close the ask against a value we already know is
      // second-best.
      result.fieldsNotAvailableYet += 1;
      const provisional = await tryProvisional(ipoId, plan, rank, deps, failures, policy);
      if (provisional) {
        result.fieldsProvisional += 1;
        logger.info(
          {
            ipoId,
            table: plan.tableName,
            field: plan.fieldName,
            authoritativeSource: source,
            provisionalSource: provisional.source,
            provisionalRank: provisional.rank,
          },
          'PASS 3: authoritative source has not published this field yet — wrote a PROVISIONAL value from a lower rank; the ask stays open'
        );
      }
      return recordAndClassify(deps, result, {
        planRowId: plan.id,
        claimToken: plan.claimToken,
        policyOrigin,
        writeHappened: true,
        state: 'NOT_AVAILABLE_YET',
        reasonCode: 'NOT_PUBLISHED_YET',
        cause: `rank${rank}:${source}:NOT_AVAILABLE_YET`,
      });
    }

    // SUPPLIED. The §1 per-field check already ran INSIDE the fetcher (the
    // filing-persister's `check.passed` gate, or the website scraper's own
    // validation) — a plan-level re-check is not this item's job.
    //
    // S3a: collect this answer and KEEP GOING instead of writing+returning
    // here. The first SUPPLIED answer found (lowest rank, loop order) is
    // still the one written — `winner` is set once and never overwritten —
    // so the value/source/state recorded below is byte-identical to the old
    // find-first return. Only lower-ranked witnesses that answer AFTER the
    // winner is already known are new: they are logged, never written
    // (S2's `witnesses` column is S3b's job).
    suppliedAnswers.push({ rank, source, answer });
    if (!winner) {
      winner = { rank, source, answer };
    }
    continue;
  }

  if (winner) {
    if (suppliedAnswers.length > 1) {
      logger.info(
        {
          ipoId,
          table: plan.tableName,
          field: plan.fieldName,
          answers: suppliedAnswers.map((a) => ({ rank: a.rank, source: a.source, outcome: 'SUPPLIED' as const })),
        },
        `PASS 3: collected ${suppliedAnswers.length} answers for ${plan.fieldName} [${suppliedAnswers
          .map((a) => `rank${a.rank}:${a.source}=SUPPLIED`)
          .join(', ')}]`
      );
    }

    const { rank, source, answer } = winner;

    // OD-99 (OD-73: "An identical incoming value is never written and never
    // re-stamps provenance"): the answer IS the value already stored for this
    // field, so there is nothing to write. Recorded SUPPLIED from this source
    // without calling the writer -- which is also what keeps a table the
    // writer cannot key (gmp_records, one row per GMP job run) from being
    // refused on every wake. Checked before the write, so it takes precedence
    // over the structural-refusal branch below.
    if (answer.stored && storedValueEquals(plan.tableName, plan.fieldName, answer.stored.value, answer.value)) {
      logger.info(
        { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, source, rank },
        'PASS 3: the answer equals the stored value — SUPPLIED, nothing written (OD-73, OD-99)'
      );
      result.fieldsSupplied += 1;
      return recordAndClassify(deps, result, {
        planRowId: plan.id,
        claimToken: plan.claimToken,
        policyOrigin,
        writeHappened: true,
        state: 'SUPPLIED',
        chosen: evidenceFor(source, rank, answer),
      });
    }

    const verdict = await runWrite(ipoId, plan, source, answer, deps);

    if (verdict.happened === false && STRUCTURAL_WRITE_SKIP_REASONS.has(verdict.skipReason)) {
      // OD-99: the writer refused for a STRUCTURAL reason -- it will refuse
      // the same way on every wake (OD-78: same cause, same outcome, no
      // retry). Re-queuing it PENDING (the branch below) looped 26 staging
      // gmp_records.gmp rows forever, claimed first on every wake with no
      // state naming the cause. Recorded instead: CHECK_FAILED, the attempt
      // charged, the skip reason in `cause`, under the field's writer gap key
      // so the row is asked again only when the writer's capability changes.
      // No key for this field (not in the manifest, or no keys this cycle):
      // a charged CHECK_FAILED re-asked next slot, bounded by the attempts cap.
      result.fieldsCheckFailed += 1;
      const gap: FieldPlanGapCode = 'WRITER_CANNOT_ACCEPT';
      const cause = `rank${rank}:${source}:WRITE_REFUSED:${verdict.skipReason} ${fieldPlanGapToken(gap)}`;
      const gapKey = ipoGapKeys ? fieldPlanGapKeyFor(ipoGapKeys, plan.tableName, plan.fieldName, [gap]) : null;
      logger.warn(
        { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, source, rank, skipReason: verdict.skipReason, gapKey },
        gapKey
          ? 'PASS 3: the writer REFUSED this write structurally — CHECK_FAILED under its writer gap key, re-asked when the writer changes (OD-99)'
          : 'PASS 3: the writer REFUSED this write structurally but no gap key could be computed — CHECK_FAILED, re-asked next data slot (OD-99)'
      );
      return recordAndClassify(deps, result, {
        planRowId: plan.id,
        claimToken: plan.claimToken,
        policyOrigin,
        writeHappened: true,
        state: 'CHECK_FAILED',
        reasonCode: 'COVERAGE_GAP',
        cause,
        ...(gapKey ? { gapKey, gapChargesAttempt: true } : {}),
      });
    }

    if (verdict.happened === false) {
      // THE FALSE-CLEAN-STATE GUARD. The write was dropped, so NOTHING about
      // the ask changed: PENDING, `attempts` untouched, claim released, and
      // the field is immediately re-claimable.
      result.fieldsWriteSkipped += 1;
      result.droppedWrites.push({
        tableName: plan.tableName,
        rowKey: plan.rowKey,
        fieldName: plan.fieldName,
        source,
        skipReason: verdict.skipReason,
      });
      logger.warn(
        {
          ipoId,
          table: plan.tableName,
          rowKey: plan.rowKey,
          field: plan.fieldName,
          source,
          rank,
          skipReason: verdict.skipReason,
        },
        'PASS 3: the write was DROPPED — plan row left PENDING with attempts untouched, NOT recorded as SUPPLIED'
      );
      return recordAndClassify(deps, result, {
        planRowId: plan.id,
        claimToken: plan.claimToken,
        policyOrigin,
        writeHappened: false,
        skipReason: verdict.skipReason,
      });
    }

    if (verdict.accepted === false && reopenedUnder && verdict.reason !== NO_FIELD_RESULT_REASON) {
      // #968 fix round 1, finding 2: an override-reopened settled row whose higher
      // source answered but LOST to the field-priority matrix. For THIS override
      // that is a definitive no: re-asking every slot changes nothing. The page
      // keeps the settled value, the refused value goes to the admin conflicts
      // list under its own named reason (OD-61, OD-75 shape; admin-only, no
      // alert), and the row is restored, tried once under this override.
      logger.warn(
        { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, source, rank, reason: verdict.reason },
        'PASS 3: override source answered but the priority matrix kept the settled value; admin conflict logged, row restored (OD-95)'
      );
      if (deps.logAdminConflict && plan.chosenSource) {
        await deps.logAdminConflict({
          ipoId,
          tableName: plan.tableName,
          rowKey: plan.rowKey ?? '',
          fieldName: columnToCamelCase(plan.fieldName),
          source1: mapManifestSourceToScraperSource(source),
          value1: answer.value === undefined || answer.value === null ? null : String(answer.value),
          source2: mapManifestSourceToScraperSource(plan.chosenSource),
          value2: null,
          resolutionReason: OVERRIDE_SOURCE_LOST_TO_PRIORITY,
          severity: 'INFO',
        });
      }
      return restoreReopened(
        ipoId,
        plan,
        deps,
        `OVERRIDE_SOURCE_LOST_TO_PRIORITY: ${source} answered under ${reopenedUnder} but the priority matrix kept ${plan.chosenSource} [${verdict.reason}] (OD-95)`,
        policyOrigin,
        fullRanks
      );
    }

    if (verdict.accepted === false) {
      // Review round 5, item A: the write REACHED the consolidator, but the
      // consolidator's OWN result says a DIFFERENT source's value won
      // (matrix priority) — recording SUPPLIED here is exactly the false-
      // clean-state class this walk exists to guard against, just from a
      // NEW direction (round 2 covered `skipped: true`; this covers
      // `skipped: false` with a losing value). Settled and re-askable, never
      // a PENDING drop: the write DID happen, it simply did not win.
      result.fieldsCheckFailed += 1;
      logger.warn(
        {
          ipoId,
          table: plan.tableName,
          rowKey: plan.rowKey,
          field: plan.fieldName,
          source,
          rank,
          reason: verdict.reason,
        },
        'PASS 3: the write reached the consolidator but LOST to a higher-priority source — CHECK_FAILED, re-asked next data slot, NOT recorded as SUPPLIED'
      );
      const rejection = classifyValidationRejection(verdict.reason);
      return recordAndClassify(deps, result, {
        planRowId: plan.id,
        claimToken: plan.claimToken,
        policyOrigin,
        writeHappened: true,
        state: 'CHECK_FAILED',
        reasonCode: rejection.reasonCode,
        cause: rejection.cause,
      });
    }

    // S3b-2: the verdict write is a SECOND call onto the same field_sources row `runWrite` just
    // wrote (never a second writer — trackWitnessVerdict defaults to the same
    // FieldSourcesRepository.trackFieldUpdate as everything else). Flag OFF (default) skips this
    // block entirely — no manifest read, no computeVerdict call, no trackWitnessVerdict call — so
    // behaviour is byte-identical to before this slice.
    if (FEATURE_FLAGS.ENABLE_VERDICT_WRITER && deps.trackWitnessVerdict) {
      const manifestEntry = loadFieldManifest().fields[`${plan.tableName}.${plan.fieldName}`];
      const family = manifestEntry?.comparisonFamily;
      // ABSTAIN is filtered out HERE, before computeVerdict — never passed through. ABSTAIN is
      // deliberately absent from areEquivalent's ComparisonFamily union (#786); a field with no
      // manifest entry at all (row-less field, matrix-shim path) has no family to filter on
      // either, so it is treated the same as ABSTAIN: no verdict computed.
      if (family && family !== 'ABSTAIN') {
        const witnessAnswers = suppliedAnswers.map((a) => ({
          rank: a.rank,
          source: a.source,
          value: a.answer.value,
          at: new Date().toISOString(),
          docType: a.answer.documentType,
        }));
        const { verdict: computedVerdict, witnesses } = computeVerdict(
          witnessAnswers,
          policy.ranks.length,
          family
        );
        await deps.trackWitnessVerdict({
          ipoId,
          tableName: plan.tableName,
          rowKey: plan.rowKey,
          // field_sources.fieldName is camelCase (lesson field-sources-field-name-is-camelCase)
          // — same conversion `runWrite` applies independently for its own write below.
          fieldName: columnToCamelCase(plan.fieldName),
          // field_sources.source (the TOP-LEVEL column, distinct from witnesses[].source below)
          // is the scraper_source Postgres enum, which has no 'DOC' member — same mapping
          // `runWrite` now applies to its own orchestrator call, for the same reason. Each
          // WITNESS's own `source` field stays the raw manifest code (a jsonb value, not enum
          // constrained) — that is what identifies WHICH ranked source answered.
          source: mapManifestSourceToScraperSource(source),
          witnesses,
          verdict: computedVerdict,
        });
      }
    }

    result.fieldsSupplied += 1;
    return recordAndClassify(deps, result, {
      planRowId: plan.id,
      claimToken: plan.claimToken,
      policyOrigin,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: evidenceFor(source, rank, answer),
    });
  }

  // #968 (OD-95): a reopened settled row where every higher source gave a
  // definitive no keeps its settled value -- back to SUPPLIED, never EXHAUSTED
  // (which would leave a settled field looking unsupplied). A transient failure
  // falls through below: the row stays open, narrowed, and is re-asked next slot.
  if (reopenedUnder && !sawTransientFailure) {
    return restoreReopened(
      ipoId,
      plan,
      deps,
      `OVERRIDE_RESTORED: no source above ${plan.chosenSource} under ${reopenedUnder} has this field [${failures.join('; ')}]; settled value kept (OD-95)`,
      policyOrigin,
      fullRanks
    );
  }

  // Every rank fell through. Which of the two fallthroughs this is decides
  // whether the field is ever asked again, so it is decided explicitly.
  //
  // §2.6 holds either way: the field's existing value in `ipos`/the child
  // table is untouched, because the walk never called a writer on this path.
  if (sawTransientFailure) {
    // CHECK_FAILED is deliberately NOT in the repository's TERMINAL_STATES,
    // so the field is never retired here. What re-asks it depends on WHY
    // every rank failed (F-152):
    //  - every failure a STRUCTURAL gap (no mapping, no document provenance,
    //    no fetcher, no documentType, no column read -- FIELD_PLAN_GAP_CODES,
    //    declared by the fetcher, never parsed from text): a settled fact
    //    under the field's gap key. Recorded as definitive: no next-due time,
    //    re-asked only when the key changes (OD-78, §2.3). Staging 2026-09-24
    //    logged 320 such fields as "TRANSIENT".
    //  - at least one genuine failure (throw, timeout, 5xx, an unflagged
    //    CHECK_FAILED): re-asked in the next OD-19 data slot, never on an
    //    elapsed-time backoff (OD-21, §2.5 "never on a backoff timer").
    result.fieldsCheckFailed += 1;
    const classified = classifyWalkFailures(failures);
    const structural = classified?.allGaps === true;
    const gapKey =
      classified?.allGaps && ipoGapKeys
        ? fieldPlanGapKeyFor(ipoGapKeys, plan.tableName, plan.fieldName, classified.gapCodes)
        : null;
    // Round 2 MINOR: the log says what the write below actually does. A
    // structural failure with no gap key (no ipoGapKeys for this IPO) is NOT
    // recorded under a key; it takes the charged next-slot path like a
    // transient one, so it must not be logged as "re-asked only when the key changes".
    logger.warn(
      { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, failures, gapKey },
      structural && gapKey
        ? 'PASS 3: every rank failed with a STRUCTURAL gap — CHECK_FAILED recorded as definitive under its gap key, re-asked only when the key changes (NOT transient, NOT retired)'
        : structural
          ? 'PASS 3: every rank failed with a STRUCTURAL gap but no gap key could be computed — CHECK_FAILED, re-asked next data slot (NOT retired)'
          : 'PASS 3: every rank failed for this field, at least one TRANSIENTLY — CHECK_FAILED, re-asked next data slot (NOT retired)'
    );
    return recordAndClassify(deps, result, {
      planRowId: plan.id,
      claimToken: plan.claimToken,
      policyOrigin,
      writeHappened: true,
      state: 'CHECK_FAILED',
      reasonCode: classified?.reasonCode ?? null,
      cause: classified?.cause ?? null,
      ...(gapKey ? { gapKey } : {}),
    });
  }

  // Every rank ANSWERED, and every answer was "not here". That is a settled
  // fact about the field, so EXHAUSTED (terminal, `next_due_at` nulled) is
  // the honest record of it.
  result.fieldsExhausted += 1;
  result.exhaustedFields.push({ tableName: plan.tableName, rowKey: plan.rowKey, fieldName: plan.fieldName });
  logger.warn(
    { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, failures },
    'PASS 3: every rank gave a DEFINITIVE no for this field — EXHAUSTED (the stored value is kept, never blanked)'
  );
  // `failures` may be empty here (every rank answered NOT_PRINTED, which
  // pushes nothing) or may hold a definitive CHECK_FAILED cause — either
  // way `classifyFailure` returns the right thing: null, or EXTRACTION_FAILED.
  const exhaustedCause = classifyFailure(failures);
  return recordAndClassify(deps, result, {
    planRowId: plan.id,
    claimToken: plan.claimToken,
    policyOrigin,
    writeHappened: true,
    state: 'EXHAUSTED',
    reasonCode: exhaustedCause?.reasonCode ?? null,
    cause: exhaustedCause?.cause ?? null,
  });
}

/**
 * §2.4's provisional fetch: after the authoritative source says NOT_AVAILABLE_YET,
 * ask the REMAINING lower ranks for an indicative value and write the first one
 * offered.
 *
 * Deliberately best-effort. Everything here is a bonus on top of an ask that
 * is staying open regardless, so a failure at any step -- a throw, a dropped
 * write, a source that also has nothing -- costs the provisional value and
 * NOTHING else. It must never turn a clean NOT_AVAILABLE_YET into an error,
 * and it never touches the plan row: the caller records the state.
 */
async function tryProvisional(
  ipoId: string,
  plan: any,
  authoritativeRank: number,
  deps: FieldPlanWalkDeps,
  failures: string[],
  policy: FieldSourcePolicy
): Promise<{ source: string; rank: number } | null> {
  // Same resolver call `attemptOneField` already made for this field this walk — passed in
  // rather than re-resolved, so this stays ONE `resolvePolicy` call per field per walk.
  const lowerRanks: [number, string | null][] = policy.ranks
    .map((source, i): [number, string | null] => [i + 1, source])
    .filter(([r]) => r > authoritativeRank);

  for (const [rank, source] of lowerRanks) {
    if (!source) continue;
    const fetcher = deps.sourceFetchers[source];
    if (!fetcher) continue;
    try {
      const answer = await fetcher(ipoId, plan.tableName, plan.rowKey, plan.fieldName);
      if (answer.outcome !== 'SUPPLIED') continue;
      const verdict = await runWrite(ipoId, plan, source, answer, deps);
      if (verdict.happened === false) {
        // The provisional write was dropped. The field is re-asked anyway, so
        // this is noted and abandoned -- never escalated.
        // TAGGED `:CHECK_FAILED:` like the main loop's push site (#785 review):
        // a dropped write is a this-pass coverage/config fact, not "the source
        // could not be asked". Untagged it fell through to UNCLASSIFIED.
        failures.push(`provisional-rank${rank}:${source}:CHECK_FAILED:${verdict.skipReason}`);
        continue;
      }
      if (verdict.accepted === false) {
        // Review round 5, item A: a provisional write that LOST to a
        // higher-priority source is the same "abandon, never escalate" shape
        // as a dropped one -- the ask stays open regardless (this function's
        // whole contract), so a losing provisional value costs nothing but
        // itself.
        // TAGGED `:LOST_TO_PRIORITY:` (#785 review): this branch is BY
        // DEFINITION a priority loss — the comment above says so — which is the
        // exact thing #785 gave its own code. Untagged it read as UNCLASSIFIED.
        failures.push(`provisional-rank${rank}:${source}:LOST_TO_PRIORITY:${verdict.reason}`);
        continue;
      }
      return { source, rank };
    } catch (error) {
      // TAGGED `:THROWN:` like the main loop's catch (#785 review): a throw here
      // is the same socket/timeout/5xx fact. Untagged, a genuine network failure
      // on the provisional path recorded UNCLASSIFIED instead of
      // SOURCE_UNREACHABLE — a regression against the pre-#785 behaviour.
      failures.push(`provisional-rank${rank}:${source}:THROWN:${causeOf(error)}`);
      continue;
    }
  }
  return null;
}

/**
 * The identity fields `computeIpoIdentitySlug` and `resolveIpoRow` read off a
 * `ScrapedIPO`-shaped payload (data-consolidation-orchestrator.ts:158-231,
 * data-persister.ts's `computeIpoIdentitySlug`) — read STRAIGHT off the
 * existing row so the walk's write is never a guess at what the row's
 * identity is. `computeIpoIdentitySlug` runs BEFORE the pre-resolved-row
 * short-circuit (it is the distributed-lock key), so `companyName` is
 * REQUIRED even though `preResolvedIPO` will make `resolveIpoRow` itself
 * unreachable.
 *
 * `offeringTypeExplicit` is deliberately NOT set: that flag exists to guard
 * an INCOMING scrape's classification against downgrading an existing
 * corporate-action row (see `resolveOfferingTypeKeepingClassification` in
 * the orchestrator) — this write is not a new scrape, it already resolved to
 * `existing`, and OFS-slug-year still reads `offeringType`/open/close dates
 * off the existing row when the OFS branch applies.
 */
function identityFieldsFor(existing: Record<string, unknown>): Record<string, unknown> {
  return {
    companyName: existing.companyName,
    symbol: existing.symbol ?? null,
    isin: existing.isin ?? null,
    offeringType: existing.offeringType,
    openDate: existing.openDate ?? null,
    closeDate: existing.closeDate ?? null,
    priceRangeMin: existing.priceRangeMin ?? null,
    segment: existing.segment ?? null,
  };
}

/**
 * The manifest names sources `DOC`/`BSE`/`CHITTORGARH`; `consolidateIPOData`'s
 * `FieldConsolidationResult.chosenSource` is a `scraper_source` ENUM value
 * (`field-priority-matrix.ts`'s `ScraperSource`) — every filing document type
 * writes as `DRHP` (filing-persister.ts's SOURCE ENUM NOTE;
 * `scraperSourceForDocType` always returns `'DRHP'`). This mapping is used
 * ONLY for the agreement check below; `chosen_source` on the plan row still
 * stores the manifest word (`'DOC'`), matching `evidenceFor` and the proof
 * tool's own DOC<->DRHP mapping (review round 5, item B) — one canonical
 * mapping, referenced from both places rather than duplicated.
 *
 * Moved to `field-source-codes.ts` (stage 3 S0c); re-exported here so this
 * module's own use below and its existing importers keep working.
 */
export { mapManifestSourceToScraperSource } from '../config/field-source-codes.js';

/**
 * Does the consolidator's OWN field result say OUR source/value won? Reads
 * `fieldResults` (both write shapes carry it — the singleton path via
 * `ConsolidatedUpsertResult.consolidation.fieldResults`, the child-row path
 * via the per-row `fieldResults` review round 5 added to
 * `ChildRowConsolidationResult`) and compares `chosenSource` (mapped) and
 * `finalValue` against what THIS write supplied. No result found for the
 * field at all (the fallback/degenerate path, which does not populate
 * `fieldResults`) is its own explicit "cannot verify" answer, never treated
 * as agreement.
 */
/** The consolidator returned no result for the field: the write could not be verified. A failed
 *  write (transient CHECK_FAILED), never a priority-matrix loss (#968 final review, MINOR). */
const NO_FIELD_RESULT_REASON = 'no field result returned';

function checkConsolidatorAgreed(
  fieldResults: Array<{ fieldName: string; finalValue: unknown; chosenSource: string }> | undefined,
  camelFieldName: string,
  source: string,
  suppliedValue: unknown
): { accepted: true } | { accepted: false; reason: string } {
  const result = fieldResults?.find((f) => f.fieldName === camelFieldName);
  if (!result) {
    return { accepted: false, reason: NO_FIELD_RESULT_REASON };
  }
  const wantedSource = mapManifestSourceToScraperSource(source);
  // Review round 6, item 2 (MAJOR): a raw `!==` compares a JS value
  // (`suppliedValue`) against a pg round-trip (`result.finalValue` — NUMERIC
  // reads back as a STRING "6800000000.00", a date column as a `Date`), so a
  // genuine win read as LOST and the row re-asked forever. Reuse the SAME
  // normalize+areEquivalent pair data-consolidation-service.ts already uses
  // for its own write-suppression decision (S-02 §5) — imported, not
  // re-implemented, so the two files can never disagree on "did this change".
  const rules = getFieldRules(camelFieldName);
  const normalizedFinal = normalizeChosen(camelFieldName, result.finalValue, rules);
  const normalizedSupplied = normalizeChosen(camelFieldName, suppliedValue, rules);
  if (result.chosenSource !== wantedSource || !areEquivalent(normalizedFinal, normalizedSupplied)) {
    return {
      accepted: false,
      reason: `consolidator kept ${result.chosenSource} value ${JSON.stringify(result.finalValue)} over ${wantedSource} ${JSON.stringify(suppliedValue)} (matrix priority; PULL-WRITE)`,
    };
  }
  return { accepted: true };
}

/**
 * Call the EXISTING consolidated writer for this row shape and reduce its
 * return to a THREE-way verdict (review round 5, item A). A dropped write
 * (lock/create/DB error) is detected from the RESULT, never assumed from the
 * absence of a throw. A write that reached the consolidator but LOST to a
 * higher-priority source's stored value (matrix priority, e.g. CHITTORGARH
 * outranking BSE for issue_size, T-453) is a SEPARATE, settled fact — never
 * conflated with "happened" the way it used to be, which is what recorded
 * SUPPLIED against 7 rows on staging whose value the consolidator did not
 * actually accept.
 */
async function runWrite(
  ipoId: string,
  plan: any,
  source: string,
  answer: Extract<FieldFetcherAnswer, { outcome: 'SUPPLIED' }>,
  deps: FieldPlanWalkDeps
): Promise<WriteVerdict> {
  try {
    const camelFieldName = columnToCamelCase(plan.fieldName);
    // The manifest's `source` vocabulary (DOC, RHP, PRICE_BAND_AD, ...) is wider than the
    // writer's `ScraperSource` enum — every filing document-type code collapses to DRHP
    // (field-source-codes.ts; `field_sources.source` is a Postgres enum with no 'DOC' member).
    // `checkConsolidatorAgreed` below already maps `source` before comparing against
    // `chosenSource`; the call to the orchestrator itself must pass the SAME mapped value, not
    // the raw manifest code — a raw 'DOC' passed as `ScraperSource` writes a value Postgres
    // cannot store under that column, and the provenance write fails silently (caught in
    // `trackFieldSource`'s own try/catch), which is what made a real DOC-sourced write always
    // read back as "LOST to a higher-priority source" against the REAL orchestrator (surfaced by
    // this slice's own real-data proof, docs/design/s3b2-verdict-writer-plan.md).
    const writerSource = mapManifestSourceToScraperSource(source);
    if (SINGLETON_IPO_TABLES.has(plan.tableName)) {
      // Review round 2, RCA1: never write `{ id, [field]: value }` alone —
      // computeIpoIdentitySlug needs companyName even with a pre-resolved
      // row, and resolveIpoRow (skipped here) is what a missing
      // preResolvedIPO would fall back to, landing in a CREATE that throws.
      const existing = await deps.ipoRepository.findById(ipoId);
      if (!existing) {
        return { happened: false, skipReason: 'ipo row missing' };
      }
      const r = await deps.orchestrator.consolidatedUpsertIPO(
        { id: ipoId, ...identityFieldsFor(existing), [camelFieldName]: answer.value },
        writerSource as any,
        100,
        existing,
        // Review round 3 (MAJOR): the identity fields above are for the lock
        // slug / resolveIpoRow ONLY, never a claim this write is making —
        // consolidate exactly the one field this write actually supplied.
        [camelFieldName]
      );
      if (r?.skipped) return { happened: false, skipReason: r.skipReason ?? 'SKIPPED' };
      const verdict = checkConsolidatorAgreed(
        r?.consolidation?.fieldResults,
        camelFieldName,
        source,
        answer.value
      );
      if (verdict.accepted === false) return { happened: true, accepted: false, reason: verdict.reason };
      return { happened: true, accepted: true };
    }

    const r = await deps.orchestrator.consolidatedUpsertChildRows(
      ipoId,
      plan.tableName as any,
      [{ rowKey: plan.rowKey, data: { [camelFieldName]: answer.value } }],
      writerSource as any,
      answer.documentType
    );
    // A child-row call returns per-row outcomes; the one row we sent is the
    // only one that can answer for this field.
    const row = r?.rows?.[0];
    if (!row || row.skipped) {
      return { happened: false, skipReason: row?.skipReason ?? 'NO_ROW_RETURNED' };
    }
    const verdict = checkConsolidatorAgreed(
      (row as { fieldResults?: Array<{ fieldName: string; finalValue: unknown; chosenSource: string }> }).fieldResults,
      camelFieldName,
      source,
      answer.value
    );
    if (verdict.accepted === false) return { happened: true, accepted: false, reason: verdict.reason };
    return { happened: true, accepted: true };
  } catch (error) {
    // A THROWING write is a dropped write too — the same rule applies, and
    // the cause travels with it (signal-ownership R6).
    return { happened: false, skipReason: causeOf(error) };
  }
}

/**
 * Record an outcome and READ THE RETURN. `recordOutcome` refuses silently
 * when the claim token was superseded; a caller that ignores that counts work
 * the table does not contain.
 */
async function recordAndClassify(
  deps: FieldPlanWalkDeps,
  result: FieldPlanWalkResult,
  params: RecordOutcomeCallParams
): Promise<'SETTLED' | 'SUPERSEDED'> {
  // F4 (Tier A review): `recordOutcome` wraps any driver error in a
  // DatabaseError and RETHROWS. Unwrapped, that propagates out of
  // `walkFieldPlanForIPO` into document-cycle's per-IPO catch -- which logs
  // and moves on, leaving `claimed_at` and `claim_token` SET with no outcome.
  // The row is then invisible for the full 30-minute staleness window: not
  // claimable by the next walk, not settled, not counted anywhere. The claim
  // that was supposed to make the walk resumable is what strands it.
  //
  // So a throwing settle is caught here and the claim is RELEASED before the
  // error propagates. Release is the right repair rather than a retry: the
  // attempt's result is lost either way, and a released row is immediately
  // re-claimable, which is exactly the dropped-write branch's own contract.
  let recorded: { written: boolean; reason?: string; skipped?: boolean };
  try {
    recorded = await deps.fieldPlanRepository.recordOutcome(params);
  } catch (error) {
    result.outcomesFailed += 1;
    unwind(result, params);
    logger.error(
      { planRowId: params.planRowId, error: causeOf(error) },
      'PASS 3: recordOutcome THREW — releasing the claim so the row is re-claimable now rather than stranded for the staleness window'
    );
    await releaseQuietly(deps, params, 'recordOutcome threw');
    throw error;
  }
  if (!recorded.written) {
    result.outcomesRefused += 1;
    // Undo the optimistic tally: nothing was persisted, so nothing happened.
    unwind(result, params);
    logger.warn(
      { planRowId: params.planRowId, reason: recorded.reason },
      'PASS 3: recordOutcome REFUSED (claim superseded) — this attempt is NOT in the plan; another walker owns it. Stopping this IPO.'
    );
    return 'SUPERSEDED';
  }
  return 'SETTLED';
}

/**
 * Release a claim on the error path, swallowing a SECOND failure.
 *
 * The caller is already propagating the first error; a throw from the repair
 * would replace the real cause with the repair's cause and still leave the
 * claim set. Losing the release is survivable -- the staleness window
 * reclaims the row -- so this is the one place a failure is logged and not
 * raised.
 */
async function releaseQuietly(
  deps: FieldPlanWalkDeps,
  params: RecordOutcomeCallParams,
  why: string
): Promise<void> {
  try {
    await deps.fieldPlanRepository.releaseClaimUnrecorded({
      planRowId: params.planRowId as string,
      claimToken: params.claimToken as string,
    });
  } catch (releaseError) {
    logger.error(
      { planRowId: params.planRowId, why, error: causeOf(releaseError) },
      'PASS 3: could not release the claim after a failed settle — the row stays claimed until the staleness window reclaims it'
    );
  }
}

/** A refused write means the counter that was just incremented is fiction. */
function unwind(result: FieldPlanWalkResult, params: RecordOutcomeCallParams): void {
  if (params.writeHappened === false) {
    result.fieldsWriteSkipped = Math.max(0, result.fieldsWriteSkipped - 1);
    // The identity this same branch just pushed is fiction too (review round 2).
    result.droppedWrites.pop();
    return;
  }
  if (params.state === 'SUPPLIED') result.fieldsSupplied = Math.max(0, result.fieldsSupplied - 1);
  else if (params.state === 'EXHAUSTED') {
    result.fieldsExhausted = Math.max(0, result.fieldsExhausted - 1);
    result.exhaustedFields.pop();
  } else if (params.state === 'CHECK_FAILED')
    result.fieldsCheckFailed = Math.max(0, result.fieldsCheckFailed - 1);
  else if (params.state === 'NOT_AVAILABLE_YET')
    result.fieldsNotAvailableYet = Math.max(0, result.fieldsNotAvailableYet - 1);

  // `fieldsProvisional` is DELIBERATELY NOT unwound, and this is the one
  // counter here that is not a plan-row state.
  //
  // Every other counter above describes something the PLAN row was going to
  // say; when the record is refused or throws, the plan says nothing, so the
  // count was fiction and is removed. A provisional value is different: it was
  // written to the DATA table by item 1's writer before the plan row was ever
  // touched, and that write is still there. Decrementing would under-report a
  // write that really happened, which is the opposite of the false-clean-state
  // problem this walk exists to avoid.
  //
  // THE READING TRAP, named because the number invites it: after a refusal
  // `fieldsProvisional` can exceed `fieldsNotAvailableYet`, which looks
  // impossible if you read one as the parent of the other. They are NOT parent
  // and child. `fieldsNotAvailableYet` counts plan rows SETTLED in that state;
  // `fieldsProvisional` counts DATA WRITES that landed. A refused settle
  // removes the first and leaves the second, so provisional > notAvailableYet
  // means exactly "a provisional value was written and its plan row was then
  // taken over by another walker" -- unusual, worth noticing, not corrupt.
}

/**
 * Every counter, so the budget-exhaustion line is a COMPLETE reading of the
 * partial pass rather than a flattering subset of it. Omitting
 * `fieldsCheckFailed`/`outcomesFailed` here would hide exactly the two states
 * that say the pass went badly (signal-ownership R1/R3).
 */
function countsOf(r: FieldPlanWalkResult) {
  return {
    fieldsAttempted: r.fieldsAttempted,
    fieldsSupplied: r.fieldsSupplied,
    fieldsExhausted: r.fieldsExhausted,
    fieldsCheckFailed: r.fieldsCheckFailed,
    fieldsNotAvailableYet: r.fieldsNotAvailableYet,
    fieldsProvisional: r.fieldsProvisional,
    fieldsWriteSkipped: r.fieldsWriteSkipped,
    fieldsSkippedProtected: r.fieldsSkippedProtected,
    outcomesRefused: r.outcomesRefused,
    outcomesFailed: r.outcomesFailed,
  };
}

/**
 * OD-62's reason codes (S4, #779; remapped #785): why a plan row did not end SUPPLIED.
 *
 * `SOURCE_UNREACHABLE` — the source could not even be asked: no fetcher
 *   registered for it, or the ask itself threw (socket/timeout/5xx). A fact
 *   about this minute/this deployment, not about the field.
 * `EXTRACTION_FAILED` — a document was held and read, but the field could
 *   not be gotten out of it: a DEFINITIVE CHECK_FAILED (`transient: false`).
 * `FAILED_VALIDATION` — a value was read but FAILED ITS SHAPE CHECK (OD-62,
 *   verbatim) — e.g. a 7-digit phone number, a CIN that is not 21 characters.
 *   The value itself was bad. NEVER assigned to a priority loss — see
 *   `LOST_TO_HIGHER_PRIORITY` below. `field_extraction_failures.ruleId`
 *   already exists for the shape-check path this code names.
 * `NOT_PUBLISHED_YET` — the authoritative source has not printed this field
 *   yet (NOT_AVAILABLE_YET); not a failure at all, just not time yet.
 * `LOST_TO_HIGHER_PRIORITY` (#785) — a value WAS produced, reached
 *   consolidation, and was FINE, but the field-priority matrix kept a
 *   different source's value instead. A healthy, expected outcome — the
 *   system working as designed — never something to "fix".
 * `COVERAGE_GAP` (#785) — a TRANSIENT CHECK_FAILED where a document WAS held
 *   and the fetcher WAS reached, but it returned a real reason (e.g. "no
 *   documentType in manifest", "no document provenance"). A config/manifest
 *   gap, not a network/deployment fact — resolves with a manifest fix, not
 *   by waiting for the network to recover.
 * `UNCLASSIFIED` (#785) — the cause did not match any named shape above. The
 *   raw cause is still recorded in `cause`, so this is a VISIBLE, countable
 *   gap rather than a confident wrong answer silently defaulted into one of
 *   the other codes.
 */
export const FIELD_PLAN_REASON_CODES = [
  'SOURCE_UNREACHABLE',
  'EXTRACTION_FAILED',
  'FAILED_VALIDATION',
  'NOT_PUBLISHED_YET',
  'LOST_TO_HIGHER_PRIORITY',
  'COVERAGE_GAP',
  'UNCLASSIFIED',
  // OD-77 (OD-62's fifth code): no source we read supplies this field for this offering.
  // Written by the one-time repair (scripts/lib/od77-issue-size-zeros.ts), never by the walk.
  'NOT_SOURCED',
] as const;
export type FieldPlanReasonCode = (typeof FIELD_PLAN_REASON_CODES)[number];

/**
 * Classify the LAST entry of `failures[]` — the most recent (highest-rank)
 * cause tried this pass. The array can hold several ranks' worth of
 * different causes (a timeout on rank 1, a definitive CHECK_FAILED on rank
 * 2); the reason code records one classification per row, so the most
 * recent attempt — the one that decided the fallthrough — is the one whose
 * cause is kept. Returns `null` when `failures` is empty (the EXHAUSTED
 * fallthrough on an all-NOT_PRINTED pass pushes nothing).
 *
 * Exported for unit testing the UNCLASSIFIED fallback directly (#785) — no
 * live push site in this file currently produces an untagged cause (every
 * real shape is tagged `:NO_FETCHER_REGISTERED`, `:THROWN:` or
 * `:CHECK_FAILED:`), so the fallback is deliberately tested at this level
 * rather than contorting the integration test to fabricate an impossible one.
 */
export function classifyFailure(failures: readonly string[]): { reasonCode: FieldPlanReasonCode; cause: string } | null {
  const cause = failures[failures.length - 1];
  if (cause === undefined) return null;

  if (cause.includes(':NO_FETCHER_REGISTERED')) {
    return { reasonCode: 'SOURCE_UNREACHABLE', cause };
  }
  // A definitive CHECK_FAILED is tagged by the walk's own `isTransient`
  // branch above (` (definitive)` suffix) — a document was held and read,
  // and the field genuinely was not extractable from it.
  if (cause.endsWith(' (definitive)')) {
    return { reasonCode: 'EXTRACTION_FAILED', cause };
  }
  // A transient CHECK_FAILED is tagged `:CHECK_FAILED:` at the push site
  // (#785) — a document WAS held and the fetcher WAS reached; it just could
  // not resolve the field from what it found (a manifest/config gap, e.g.
  // "no documentType in manifest"). This is NOT the same fact as "the
  // source could not be asked" (a throw, or NO_FETCHER_REGISTERED).
  if (cause.includes(':CHECK_FAILED:')) {
    return { reasonCode: 'COVERAGE_GAP', cause };
  }
  // A thrown error's cause is tagged `:THROWN:` at the push site (#785) — a
  // genuine this-minute fact: socket, timeout, 5xx — the source could not
  // even be asked.
  if (cause.includes(':THROWN:')) {
    return { reasonCode: 'SOURCE_UNREACHABLE', cause };
  }
  // The provisional path's own priority loss, tagged `:LOST_TO_PRIORITY:`
  // (#785 review). Same fact as `classifyValidationRejection`'s branch — a
  // value was produced and a better-ranked source already had one — so it gets
  // the same code rather than being left to the UNCLASSIFIED fallback.
  if (cause.includes(':LOST_TO_PRIORITY:')) {
    return { reasonCode: 'LOST_TO_HIGHER_PRIORITY', cause };
  }
  // Nothing above recognised this shape. Recording it as SOURCE_UNREACHABLE
  // (or any other named code) would be a confident wrong answer that is
  // invisible forever; UNCLASSIFIED keeps the raw cause and makes the gap
  // countable (#785 defect 2's "visible gap" fix).
  return { reasonCode: 'UNCLASSIFIED', cause };
}

/**
 * #884: the cause a transient CHECK_FAILED row records, and whether it was a
 * GAP. `allGaps` is true only when EVERY rank's failure carries a structured
 * gap token (`[gap:<code>]`, written by the walk from the fetcher's `gap`
 * field or its own no-fetcher branch) — so a genuine failure on any rank is
 * still charged. `classifyFailure` alone keeps the LAST failure, which let a
 * trailing gap (rank 3: no fetcher) mask a real failure on rank 1; so the
 * most recent GENUINE failure is classified when there is one.
 */
export function classifyWalkFailures(
  failures: readonly string[]
): { reasonCode: FieldPlanReasonCode; cause: string; allGaps: boolean; gapCodes: FieldPlanGapCode[] } | null {
  const genuine = failures.filter((f) => fieldPlanGapCodeOf(f) === null);
  const classified = classifyFailure(genuine.length > 0 ? genuine : failures);
  if (!classified) return null;
  const gapCodes = [...new Set(failures.map(fieldPlanGapCodeOf).filter((c): c is FieldPlanGapCode => c !== null))];
  return { ...classified, allGaps: genuine.length === 0, gapCodes };
}

/**
 * The write REACHED consolidation but was NOT accepted. Two different facts
 * share this codepath and must never share a reason code (#785):
 *
 *   - the field-priority matrix kept a DIFFERENT source's value instead —
 *     the value itself was FINE, just outranked. `LOST_TO_HIGHER_PRIORITY`.
 *   - a genuine shape-check rejected the value itself. `FAILED_VALIDATION`,
 *     exactly as OD-62 defines it. `checkConsolidatorAgreed`'s `reason`
 *     string for a priority loss always contains "matrix priority" (see the
 *     fixture at `consolidatedUpsertResultFixture`/`checkConsolidatorAgreed`)
 *     — anything else on this path is treated as a shape-check rejection.
 */
function classifyValidationRejection(reason: string): { reasonCode: FieldPlanReasonCode; cause: string } {
  if (reason.includes('matrix priority')) {
    return { reasonCode: 'LOST_TO_HIGHER_PRIORITY', cause: reason };
  }
  return { reasonCode: 'FAILED_VALIDATION', cause: reason };
}

/**
 * OD-99: is the incoming answer the value already stored (OD-73: "An identical
 * incoming value is never written")? Numbers are compared EXACTLY after
 * parsing, so a NUMERIC read back as text ("1250000000.00") equals the number
 * 1250000000 (#976's text-compare trap) while a real one-rupee move still
 * counts as a change -- MONEY's 0.5% tolerance is for two sources' rounding,
 * not for "identical". Anything else goes through the field's own
 * comparison family (manifest), the same `areEquivalent` the verdict writer
 * uses. A null/absent stored value never equals an answer.
 */
const EXACT_NUMERIC_TEXT = /^\s*-?\d+(?:\.\d+)?\s*$/;
function exactNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && EXACT_NUMERIC_TEXT.test(value)) return Number(value);
  return null;
}

export function storedValueEquals(tableName: string, fieldName: string, stored: unknown, incoming: unknown): boolean {
  if (stored === null || stored === undefined || incoming === null || incoming === undefined) return false;
  const n1 = exactNumber(stored);
  const n2 = exactNumber(incoming);
  if (n1 !== null && n2 !== null) return n1 === n2;
  const family = loadFieldManifest().fields[`${tableName}.${fieldName}`]?.comparisonFamily;
  const camel = columnToCamelCase(fieldName);
  const rules = getFieldRules(camel);
  const a = normalizeChosen(camel, stored, rules);
  const b = normalizeChosen(camel, incoming, rules);
  return family && family !== 'ABSTAIN' ? areEquivalent(a, b, { family } as never) : areEquivalent(a, b, 0);
}

/** Failures carry their cause, wrapped ones included (signal-ownership R6). */
function causeOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${error.message} <- ${cause.message}`;
  return error.message;
}
