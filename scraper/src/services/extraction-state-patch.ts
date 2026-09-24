/**
 * extraction-state-patch.ts — split out of `filing-auto-persist.ts` (build-hygiene refactor,
 * PR #1017 follow-up).
 *
 * WHY THIS MODULE EXISTS: `scraper/scripts/repair-readmit-stranded-documents.ts` needs only
 * `buildExtractionStatePatch` (a pure function with zero imports of its own), but importing it
 * from `filing-auto-persist.ts` pulled that file's WHOLE import graph (anchor-investors-scraper,
 * cache-invalidator, filing-persist-deps, …) into `tsconfig.scripts.json`'s stricter program,
 * surfacing 21 pre-existing type errors in unrelated files that `src`'s own type-check never
 * reports. Moving the pure function (and the minimal types it needs) here keeps the script's
 * import graph light. `filing-auto-persist.ts` re-exports both symbols, so no other import site
 * changes. Behaviour is unchanged — this is a pure move, not a rewrite.
 */

/** The status values `buildExtractionStatePatch` (and the `documents` column) accept. */
export type ExtractionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'MANUAL_REVIEW';

export interface ExtractionStatePatchContext {
  /** Explicit `undefined` leaves `extraction_error` untouched; pass `null` to clear it. */
  error?: string | null;
  retryCount?: number;
  /**
   * Round 3 (MAJOR-1): explicit override for `updatedAt`, used ONLY by the
   * busy-box revert path — a busy skip must restore the row's ORIGINAL
   * `updatedAt`, not stamp a new one, because `documentExtractionBlocked`'s
   * backoff gate anchors its wait window on `updatedAt`. Any other caller
   * omits this and gets the real "now" below.
   */
  updatedAt?: Date;
}

/**
 * THE single function every extraction-status write goes through. Pure, so
 * every transition in `filing-auto-persist.ts`'s module doc comment's state
 * table is a plain input/output test with no database. Stamps `updatedAt:
 * now` for every REAL transition — the one exception is `ctx.updatedAt`
 * (round 3 MAJOR-1), which the busy-revert path uses to restore the row's
 * exact pre-attempt `updatedAt` instead of advancing the backoff clock on a
 * skip.
 */
export function buildExtractionStatePatch(
  transition: ExtractionStatus,
  ctx: ExtractionStatePatchContext = {},
  now: Date = new Date()
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    extractionStatus: transition,
    updatedAt: ctx.updatedAt ?? now,
  };
  if (ctx.error !== undefined) patch.extractionError = ctx.error;
  if (transition === 'COMPLETED') patch.extractedAt = now;
  if (ctx.retryCount !== undefined) patch.retryCount = ctx.retryCount;
  return patch;
}
