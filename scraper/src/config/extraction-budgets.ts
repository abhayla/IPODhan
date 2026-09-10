/**
 * The extraction / wake / lock budgets, and the invariant they are DERIVED
 * from (item 7 part A, build card
 * `docs/design/build-cards/item-07-job-scheduler-and-budgets.md`).
 *
 * Before this file, every number here was typed independently in a different
 * module and "hoped to fit": `EXTRACT_TIMEOUT_MS` in filing-auto-persist.ts,
 * `DEFAULT_WAKE_BUDGET_MS` / `DEFAULT_EXTRACTION_BUDGET_MS` in
 * document-cycle.ts, `FILING_EXTRACTION_LOCK_TTL_MS` beside the first, and a
 * static test that re-typed the relationship between them. Changing one and
 * forgetting the others silently broke the relationship the lock depends on.
 *
 * ## The invariant
 *
 *   Never start an extraction unless the remaining extraction budget can
 *   absorb its FULL timeout.
 *
 * (`hasFullBudgetRemaining()` in filing-auto-persist.ts is the code that
 * enforces it, at every spawn site.) Everything below is arithmetic on that
 * sentence plus two owner-given inputs (OD-19). Nothing below is a number
 * chosen because it looked big enough.
 *
 * ## The chain, in order
 *
 *   1. inputs (owner, OD-19): EXTRACT_TIMEOUT_MS = 30 min, DEFAULT_WAKE_BUDGET_MS = 50 min
 *   2. extractionBudgetMs(wake)  = wake - DISCOVERY_RESERVE_MS - PURGE_RESERVE_MS
 *                                = 50 - 1 - 2 = 47 min
 *      ...and the invariant REQUIRES extractionBudgetMs >= EXTRACT_TIMEOUT_MS,
 *      or the pass can never start even one extraction (see
 *      `budgetDerivationViolations()`). This is the check that fails the old
 *      25-minute `DEFAULT_EXTRACTION_BUDGET_MS` against a 30-minute timeout.
 *   3. filingPassWorstCaseMs(wake) = extractionBudgetMs(wake) = 47 min
 *      BECAUSE of the invariant: a spawn only starts with >= one full timeout
 *      left, and runs at most one full timeout, so it always ends at or before
 *      the deadline. The worst case is therefore the BUDGET, not
 *      spawns x timeout (3 x 30 min = 90 min, which fits in no sane lock).
 *   4. filingExtractionLockTtlMs(wake)
 *        = next whole minute STRICTLY above
 *          (filingPassWorstCase + DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE x SIDECAR_TIMEOUT_MS + LOCK_SLACK_MS)
 *        = next minute above (47 + 1x2 + 1 = 50 min) = 51 min
 *   5. maxAnchorSpawnsWithinLockTtl(sidecar) = largest n with
 *          filingWorst + n x sidecar + slack < lockTtl
 *        = largest n with n x 2 min < (51 - 47 - 1) = 3 min  =>  n = 1
 *      which is exactly DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE — it FALLS OUT of
 *      the arithmetic rather than being asserted next to it.
 *
 * The build card states the lock TTL "rounds to 60 * 60 * 1000". It does not:
 * the derivation above yields 51 minutes, and 60 would be nine minutes of
 * unexplained slack held on a lock. The derived value is used.
 *
 * ## What this file does NOT bound
 *
 * Nothing here stops a cycle that overruns anyway (a wedged python child, a
 * hung fetch). The only thing that bounds a runaway cycle is lock EXPIRY —
 * `FILING_EXTRACTION_LOCK_TTL_MS` here and `CYCLE_LOCK_TTL_MS` in index.ts
 * (`getWakeBudgetMs() + 5 min` = 55 min) — after which a later wake is free to
 * start work alongside the runaway one. That is the honest answer; there is no
 * watchdog, and once item 7 part B removes the PM2 `--cron-restart` force-kill
 * there will be no external killer either.
 */

/** Owner input (OD-19): the per-document extractor wall-clock cap. Was 10 min. */
export const EXTRACT_TIMEOUT_MS = 30 * 60 * 1000;

/** Owner input (OD-19): how long one scraper wake may run. Was 20 min. */
export const DEFAULT_WAKE_BUDGET_MS = 50 * 60 * 1000;

/** The anchor sidecar spawn timeout. Re-exported by anchor-investors-scraper.ts. */
export const SIDECAR_TIMEOUT_MS = 120_000;

/**
 * Discovery's share of the wake, reserved before extraction gets any.
 * `CYCLE_BUDGET.DISCOVERY_MS` (document-state-machine.ts) reads this.
 */
export const DISCOVERY_RESERVE_MS = 60_000;

/**
 * Reserved for `triggerDocumentPurge()`, which runs in the SAME wake after the
 * document cycle returns.
 */
export const PURGE_RESERVE_MS = 2 * 60 * 1000;

/** Margin between the worst-case pass and the lock that protects it. */
export const LOCK_SLACK_MS = 60_000;

/** Cap on python spawns per document cycle, across every IPO. */
export const DEFAULT_MAX_SPAWNS_PER_CYCLE = 3;

/** Anchors get their own per-cycle spawn budget (W-168), never the filing one. */
export const DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE = 1;

/** `DOCUMENT_CYCLE_WAKE_BUDGET_MS` env override, default `DEFAULT_WAKE_BUDGET_MS`. */
export function getWakeBudgetMs(): number {
  const raw = process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS;
  if (!raw) return DEFAULT_WAKE_BUDGET_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WAKE_BUDGET_MS;
}

/**
 * Step 2. Extraction gets the wake minus the two fixed reservations. Floors at
 * 0 so a pathologically small override degrades to "extract nothing" rather
 * than to a negative deadline.
 */
export function extractionBudgetMs(wakeBudgetMs: number = getWakeBudgetMs()): number {
  return Math.max(0, wakeBudgetMs - DISCOVERY_RESERVE_MS - PURGE_RESERVE_MS);
}

/** The default-env value of step 2. Was a separately-typed 25 min. */
export const DEFAULT_EXTRACTION_BUDGET_MS = extractionBudgetMs(DEFAULT_WAKE_BUDGET_MS);

/**
 * Step 3. The invariant is what makes this the budget rather than
 * `spawns x timeout` — see the header.
 */
export function filingPassWorstCaseMs(wakeBudgetMs: number = getWakeBudgetMs()): number {
  return extractionBudgetMs(wakeBudgetMs);
}

/** The next whole minute strictly greater than `ms` (never equal to it). */
function nextWholeMinuteAbove(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000 + 60_000;
}

/**
 * Step 4. The lock must outlive the filing pass, the anchor pass that follows
 * it in the same call, and the slack — strictly, with the result rounded to a
 * whole minute so the deployed TTL is readable in `redis-cli TTL` output.
 */
export function filingExtractionLockTtlMs(wakeBudgetMs: number = getWakeBudgetMs()): number {
  const worstMs =
    filingPassWorstCaseMs(wakeBudgetMs) +
    DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE * SIDECAR_TIMEOUT_MS +
    LOCK_SLACK_MS;
  return nextWholeMinuteAbove(worstMs);
}

/** The default-env value of step 4. Was a separately-typed 45 min. */
export const FILING_EXTRACTION_LOCK_TTL_MS = filingExtractionLockTtlMs(DEFAULT_WAKE_BUDGET_MS);

/**
 * Step 5. The largest anchor spawn count that still leaves the filing worst
 * case + that many sidecars + slack under the lock TTL. Exported so the static
 * test asserts THIS derivation instead of a re-typed copy.
 */
export function maxAnchorSpawnsWithinLockTtl(sidecarTimeoutMs: number): number {
  const filingWorstMs = filingPassWorstCaseMs();
  const budgetForAnchors = FILING_EXTRACTION_LOCK_TTL_MS - filingWorstMs - LOCK_SLACK_MS;
  // Strict "<", not "<=": a count whose worst case lands EXACTLY on the budget
  // leaves zero margin against the TTL.
  let n = Math.max(0, Math.floor(budgetForAnchors / sidecarTimeoutMs));
  while (n > 0 && n * sidecarTimeoutMs >= budgetForAnchors) n--;
  return n;
}

/**
 * The derivation, as a checkable predicate. Returns one string per broken link
 * in the chain, empty when every number still follows from the invariant.
 *
 * This is what makes the numbers derived rather than typed: change
 * `EXTRACT_TIMEOUT_MS` alone and link 1 breaks; hard-code
 * `FILING_EXTRACTION_LOCK_TTL_MS` back to a constant and link 2 or 3 breaks;
 * raise `DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE` past its headroom and link 4
 * breaks. No caller has to re-type an expected number to notice.
 */
export function budgetDerivationViolations(wakeBudgetMs: number = DEFAULT_WAKE_BUDGET_MS): string[] {
  const out: string[] = [];
  const budget = extractionBudgetMs(wakeBudgetMs);
  const filingWorst = filingPassWorstCaseMs(wakeBudgetMs);
  const ttl = FILING_EXTRACTION_LOCK_TTL_MS;

  if (budget < EXTRACT_TIMEOUT_MS) {
    out.push(
      `extraction budget ${budget}ms cannot absorb one full EXTRACT_TIMEOUT_MS ${EXTRACT_TIMEOUT_MS}ms — ` +
        `the never-start invariant would refuse EVERY extraction`
    );
  }
  if (filingWorst + LOCK_SLACK_MS >= ttl) {
    out.push(
      `filing pass worst case ${filingWorst}ms + slack ${LOCK_SLACK_MS}ms does not fit under ` +
        `FILING_EXTRACTION_LOCK_TTL_MS ${ttl}ms`
    );
  }
  if (ttl !== filingExtractionLockTtlMs(wakeBudgetMs)) {
    out.push(
      `FILING_EXTRACTION_LOCK_TTL_MS ${ttl}ms is not the derived value ` +
        `${filingExtractionLockTtlMs(wakeBudgetMs)}ms for a ${wakeBudgetMs}ms wake`
    );
  }
  if (DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE > maxAnchorSpawnsWithinLockTtl(SIDECAR_TIMEOUT_MS)) {
    out.push(
      `DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE ${DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE} exceeds the ` +
        `${maxAnchorSpawnsWithinLockTtl(SIDECAR_TIMEOUT_MS)} the lock TTL can absorb`
    );
  }
  return out;
}

/**
 * The PM2 `--cron-restart` every-30-minutes interval that item 7 part B removes
 * (`scripts/deploy-linux.sh`). While that flag is still deployed, PM2 KILLS an
 * online scraper at the cron minute — so every budget above is only safe once
 * it is gone.
 *
 * This is not a knob; it is the precondition, named so it can be asserted.
 * `budgetsRequireForceKillRemoval()` is true at the shipped constants, which is
 * why this commit must land together with part B and not ahead of it.
 */
export const LEGACY_PM2_FORCE_KILL_INTERVAL_MS = 30 * 60 * 1000;

/** The whole-cycle Redis lock TTL in index.ts (`getWakeBudgetMs() + 5 min`). */
export function cycleLockTtlMs(wakeBudgetMs: number = getWakeBudgetMs()): number {
  return wakeBudgetMs + 5 * 60 * 1000;
}

/**
 * True when a cycle at these budgets would still be running (or still holding
 * its lock) when the legacy PM2 force-kill fires — i.e. when these numbers
 * REQUIRE the force-kill to have been removed first.
 */
export function budgetsRequireForceKillRemoval(
  wakeBudgetMs: number = DEFAULT_WAKE_BUDGET_MS
): boolean {
  return cycleLockTtlMs(wakeBudgetMs) >= LEGACY_PM2_FORCE_KILL_INTERVAL_MS;
}
