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

/** Which write path a plan row's table takes. */
const SINGLETON_IPO_TABLES: ReadonlySet<string> = new Set(['ipos', 'ipo']);

export interface FieldPlanWalkResult {
  ipoId: string;
  fieldsAttempted: number;
  fieldsSupplied: number;
  /** Retired: every rank gave a DEFINITIVE no. Terminal. */
  fieldsExhausted: number;
  /** Not retired: at least one rank failed transiently. Re-asked after backoff. */
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
       * re-ask on a doubling backoff. Treating a transient failure as
       * definitive retires the field forever. An adapter author who has not
       * thought about it gets the recoverable error.
       */
      transient?: boolean;
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
    fieldsCheckFailed: 0,
    fieldsSkippedProtected: 0,
    fieldsWriteSkipped: 0,
    fieldsNotAvailableYet: 0,
    fieldsProvisional: 0,
    outcomesRefused: 0,
    outcomesFailed: 0,
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
   * every source gave a definitive answer. `attempts` still bounds the
   * transient path via the repository's own doubling backoff (15m -> 6h cap),
   * so a permanently-broken adapter degrades to one re-ask every six hours
   * rather than a hot loop.
   */
  let sawTransientFailure = false;

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
      failures.push(`rank${rank}:${source}:NO_FETCHER_REGISTERED`);
      sawTransientFailure = true;
      continue;
    }

    let answer: FieldFetcherAnswer;
    try {
      answer = await fetcher(ipoId, plan.tableName, plan.rowKey, plan.fieldName);
    } catch (error) {
      // TRANSIENT: a throw is a socket, a timeout, a 503 -- this minute's
      // fact, not the field's. Never an abandoned claim either: falling out
      // of the walk here would strand `claimed_at`.
      failures.push(`rank${rank}:${source}:${causeOf(error)}`);
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
      failures.push(`rank${rank}:${source}:${answer.reason}${isTransient ? '' : ' (definitive)'}`);
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
      const provisional = await tryProvisional(ipoId, plan, rank, deps, failures);
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

  // Every rank fell through. Which of the two fallthroughs this is decides
  // whether the field is ever asked again, so it is decided explicitly.
  //
  // §2.6 holds either way: the field's existing value in `ipos`/the child
  // table is untouched, because the walk never called a writer on this path.
  if (sawTransientFailure) {
    // At least one rank failed for a reason that may not fail again, so this
    // is NOT a settled answer. CHECK_FAILED is deliberately NOT in the
    // repository's TERMINAL_STATES: `next_due_at` is set to the doubling
    // backoff and the field is re-asked. Three timeouts in one pass cost a
    // delay, not the field.
    result.fieldsCheckFailed += 1;
    logger.warn(
      { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, failures },
      'PASS 3: every rank failed for this field, at least one TRANSIENTLY — CHECK_FAILED, re-asked after backoff (NOT retired)'
    );
    return recordAndClassify(deps, result, {
      planRowId: plan.id,
      claimToken: plan.claimToken,
      writeHappened: true,
      state: 'CHECK_FAILED',
    });
  }

  // Every rank ANSWERED, and every answer was "not here". That is a settled
  // fact about the field, so EXHAUSTED (terminal, `next_due_at` nulled) is
  // the honest record of it.
  result.fieldsExhausted += 1;
  logger.warn(
    { ipoId, table: plan.tableName, rowKey: plan.rowKey, field: plan.fieldName, failures },
    'PASS 3: every rank gave a DEFINITIVE no for this field — EXHAUSTED (the stored value is kept, never blanked)'
  );
  return recordAndClassify(deps, result, {
    planRowId: plan.id,
    claimToken: plan.claimToken,
    writeHappened: true,
    state: 'EXHAUSTED',
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
  failures: string[]
): Promise<{ source: string; rank: number } | null> {
  const lowerRanks: [number, string | null][] = [
    [1, plan.rank1Source],
    [2, plan.rank2Source],
    [3, plan.rank3Source],
  ].filter(([r]) => (r as number) > authoritativeRank) as [number, string | null][];

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
        failures.push(`provisional-rank${rank}:${source}:${verdict.skipReason}`);
        continue;
      }
      return { source, rank };
    } catch (error) {
      failures.push(`provisional-rank${rank}:${source}:${causeOf(error)}`);
      continue;
    }
  }
  return null;
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
  params: Record<string, unknown>,
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
function unwind(result: FieldPlanWalkResult, params: Record<string, unknown>): void {
  if (params.writeHappened === false) {
    result.fieldsWriteSkipped = Math.max(0, result.fieldsWriteSkipped - 1);
    return;
  }
  if (params.state === 'SUPPLIED') result.fieldsSupplied = Math.max(0, result.fieldsSupplied - 1);
  else if (params.state === 'EXHAUSTED') result.fieldsExhausted = Math.max(0, result.fieldsExhausted - 1);
  else if (params.state === 'CHECK_FAILED')
    result.fieldsCheckFailed = Math.max(0, result.fieldsCheckFailed - 1);
  else if (params.state === 'NOT_AVAILABLE_YET')
    result.fieldsNotAvailableYet = Math.max(0, result.fieldsNotAvailableYet - 1);
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

/** Failures carry their cause, wrapped ones included (signal-ownership R6). */
function causeOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${error.message} <- ${cause.message}`;
  return error.message;
}
