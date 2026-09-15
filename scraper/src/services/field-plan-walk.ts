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
 * WHAT THIS MODULE DOES NOT DO: it does not fetch (the fetchers are the
 * existing orchestrators), it does not consolidate (item 1's writer does),
 * it does not decide field priority (the manifest did, when items 2/3
 * generated the plan rows), and it never writes a null over a value that
 * failed re-sourcing (§2.6 — EXHAUSTED marks the PLAN row only; the data
 * row's existing value is simply not touched, because this walk only ever
 * calls a writer when it HAS a value).
 */

import { logger } from '../utils/logger.js';

/** Which write path a plan row's table takes. */
const SINGLETON_IPO_TABLES: ReadonlySet<string> = new Set(['ipos', 'ipo']);

export interface FieldPlanWalkResult {
  ipoId: string;
  fieldsAttempted: number;
  fieldsSupplied: number;
  fieldsExhausted: number;
  fieldsSkippedProtected: number;
  /** Fields whose write was DROPPED — left PENDING, attempts untouched. */
  fieldsWriteSkipped: number;
  /** Fields re-askable later (NOT_AVAILABLE_YET). */
  fieldsNotAvailableYet: number;
  /** `recordOutcome` returns that were REFUSED (CLAIM_SUPERSEDED). */
  outcomesRefused: number;
  stoppedReason: 'NO_DUE_FIELDS' | 'BUDGET_EXHAUSTED' | 'CLAIM_SUPERSEDED';
}

export type FieldFetcherAnswer =
  | {
      outcome: 'SUPPLIED';
      value: unknown;
      documentId?: string;
      documentType?: string;
      sha256?: string;
      page?: number;
    }
  | { outcome: 'NOT_PRINTED' }
  | { outcome: 'NOT_AVAILABLE_YET' }
  | { outcome: 'CHECK_FAILED'; reason: string };

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

/** The slice of item 5's repository the walk uses. */
export interface FieldPlanWalkRepository {
  claimNextDueField(params: { ipoId?: string }): Promise<any | null>;
  recordOutcome(params: any): Promise<{ written: boolean; reason?: string; skipped?: boolean }>;
  releaseClaimUnrecorded(params: {
    planRowId: string;
    claimToken: string;
  }): Promise<{ released: boolean; reason?: string }>;
}

/** The slice of item 1's orchestrator the walk uses. */
export interface FieldPlanWalkOrchestrator {
  consolidatedUpsertIPO(scraped: any, source: any, confidence?: number): Promise<any>;
  consolidatedUpsertChildRows(
    ipoId: string,
    tableName: any,
    rows: any[],
    source: any,
    docType?: string,
    confidence?: number
  ): Promise<any>;
}

export interface FieldPlanWalkDeps {
  fieldPlanRepository: FieldPlanWalkRepository;
  orchestrator: FieldPlanWalkOrchestrator;
  /** One fetcher per rank-eligible source name, keyed as the manifest names it. */
  sourceFetchers: Record<string, FieldFetcher>;
  protectionFilter?: ProtectionFilter;
}

export interface FieldPlanWalkBudget {
  /** Absolute deadline on the CALLER's clock, exactly like PASS 2's. */
  deadlineMs: number;
  now: () => number;
}

/** What a write attempt concluded, shaped so every branch is explicit. */
type WriteVerdict =
  | { happened: true }
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
    fieldsSkippedProtected: 0,
    fieldsWriteSkipped: 0,
    fieldsNotAvailableYet: 0,
    outcomesRefused: 0,
    stoppedReason: 'NO_DUE_FIELDS',
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

    const plan = await deps.fieldPlanRepository.claimNextDueField({ ipoId });
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
    // backoff budget is not spent on work that was never done.
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
        const released = await deps.fieldPlanRepository.releaseClaimUnrecorded({
          planRowId: plan.id,
          claimToken: plan.claimToken,
        });
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
    const settled = await attemptOneField(ipoId, plan, deps, result);
    if (settled === 'SUPERSEDED') {
      result.stoppedReason = 'CLAIM_SUPERSEDED';
      return result;
    }
  }
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
  result: FieldPlanWalkResult
): Promise<'SETTLED' | 'SUPERSEDED'> {
  const ranks: [number, string | null][] = [
    [1, plan.rank1Source],
    [2, plan.rank2Source],
    [3, plan.rank3Source],
  ];
  const failures: string[] = [];

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
      failures.push(`rank${rank}:${source}:NO_FETCHER_REGISTERED`);
      continue;
    }

    let answer: FieldFetcherAnswer;
    try {
      answer = await fetcher(ipoId, plan.tableName, plan.rowKey, plan.fieldName);
    } catch (error) {
      // A throwing fetcher is this rank's CHECK_FAILED, never an abandoned
      // claim — falling out of the walk here would strand `claimed_at`.
      failures.push(`rank${rank}:${source}:${causeOf(error)}`);
      continue;
    }

    if (answer.outcome === 'NOT_PRINTED') {
      // §2.4: no retry, no error — this source never carries this field.
      continue;
    }

    if (answer.outcome === 'CHECK_FAILED') {
      failures.push(`rank${rank}:${source}:${answer.reason}`);
      continue;
    }

    if (answer.outcome === 'NOT_AVAILABLE_YET') {
      // The field exists but is not published yet. It stays due and is
      // re-asked after the repository's own backoff; no further rank is
      // tried, because a later-ranked source cannot know it earlier.
      result.fieldsNotAvailableYet += 1;
      return recordAndClassify(deps, result, {
        planRowId: plan.id,
        claimToken: plan.claimToken,
        writeHappened: true,
        state: 'NOT_AVAILABLE_YET',
      });
    }

    // SUPPLIED. The §1 per-field check already ran INSIDE the fetcher (the
    // filing-persister's `check.passed` gate, or the website scraper's own
    // validation) — a plan-level re-check is not this item's job.
    const verdict = await runWrite(ipoId, plan, source, answer, deps);

    if (verdict.happened === false) {
      // THE FALSE-CLEAN-STATE GUARD. The write was dropped, so NOTHING about
      // the ask changed: PENDING, `attempts` untouched, claim released, and
      // the field is immediately re-claimable.
      result.fieldsWriteSkipped += 1;
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
        writeHappened: false,
        skipReason: verdict.skipReason,
      });
    }

    result.fieldsSupplied += 1;
    return recordAndClassify(deps, result, {
      planRowId: plan.id,
      claimToken: plan.claimToken,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: evidenceFor(source, rank, answer),
    });
  }

  // Every rank fell through. §2.6: EXHAUSTED marks the PLAN row only — the
  // field's existing value in `ipos`/the child table is untouched, because
  // the walk never called a writer at all on this path.
  result.fieldsExhausted += 1;
  logger.warn(
    { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, failures },
    'PASS 3: every rank failed for this field — EXHAUSTED (the stored value is kept, never blanked)'
  );
  return recordAndClassify(deps, result, {
    planRowId: plan.id,
    claimToken: plan.claimToken,
    writeHappened: true,
    state: 'EXHAUSTED',
  });
}

/**
 * Call the EXISTING consolidated writer for this row shape and reduce its
 * return to a two-way verdict. A dropped write is the silent one, so it is
 * detected from the RESULT, never assumed from the absence of a throw.
 */
async function runWrite(
  ipoId: string,
  plan: any,
  source: string,
  answer: Extract<FieldFetcherAnswer, { outcome: 'SUPPLIED' }>,
  deps: FieldPlanWalkDeps
): Promise<WriteVerdict> {
  try {
    if (SINGLETON_IPO_TABLES.has(plan.tableName)) {
      const r = await deps.orchestrator.consolidatedUpsertIPO(
        { id: ipoId, [plan.fieldName]: answer.value },
        source as any
      );
      if (r?.skipped) return { happened: false, skipReason: r.skipReason ?? 'SKIPPED' };
      return { happened: true };
    }

    const r = await deps.orchestrator.consolidatedUpsertChildRows(
      ipoId,
      plan.tableName as any,
      [{ rowKey: plan.rowKey, data: { [plan.fieldName]: answer.value } }],
      source as any,
      answer.documentType
    );
    // A child-row call returns per-row outcomes; the one row we sent is the
    // only one that can answer for this field.
    const row = r?.rows?.[0];
    if (!row || row.skipped) {
      return { happened: false, skipReason: row?.skipReason ?? 'NO_ROW_RETURNED' };
    }
    return { happened: true };
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
  params: Record<string, unknown>
): Promise<'SETTLED' | 'SUPERSEDED'> {
  const recorded = await deps.fieldPlanRepository.recordOutcome(params);
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

/** A refused write means the counter that was just incremented is fiction. */
function unwind(result: FieldPlanWalkResult, params: Record<string, unknown>): void {
  if (params.writeHappened === false) {
    result.fieldsWriteSkipped = Math.max(0, result.fieldsWriteSkipped - 1);
    return;
  }
  if (params.state === 'SUPPLIED') result.fieldsSupplied = Math.max(0, result.fieldsSupplied - 1);
  else if (params.state === 'EXHAUSTED') result.fieldsExhausted = Math.max(0, result.fieldsExhausted - 1);
  else if (params.state === 'NOT_AVAILABLE_YET')
    result.fieldsNotAvailableYet = Math.max(0, result.fieldsNotAvailableYet - 1);
}

function countsOf(r: FieldPlanWalkResult) {
  return {
    fieldsAttempted: r.fieldsAttempted,
    fieldsSupplied: r.fieldsSupplied,
    fieldsExhausted: r.fieldsExhausted,
    fieldsWriteSkipped: r.fieldsWriteSkipped,
    fieldsSkippedProtected: r.fieldsSkippedProtected,
  };
}

/** Failures carry their cause, wrapped ones included (signal-ownership R6). */
function causeOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${error.message} <- ${cause.message}`;
  return error.message;
}
