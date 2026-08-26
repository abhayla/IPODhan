/**
 * Write-path integrity guard (T-339 item 1).
 *
 * The single invariant this module enforces:
 *
 *   A HIGH_VALUE field is never published to `ipos` unless the consolidation
 *   layer produced a decision record for it.
 *
 * "Decision record" = an entry in `ConsolidationResult.fieldResults` — the
 * per-field output of the priority/conflict layer, which is also what gets
 * persisted into `field_sources` / `data_conflicts`. A HIGH_VALUE value that
 * arrives at the repository's IPO update call with no matching entry means SOME
 * bypass ran (a disabled flag, a percentage gate that missed, a legacy
 * fallback update) and the value was chosen by last-writer-wins instead of by
 * source priority. That is precisely the class T-339 closes, so it is a
 * throw, not a warning: an unexplainable HIGH_VALUE write is worse than a
 * skipped cycle, because it silently republishes a disputed price band or
 * date as settled fact.
 *
 * HIGH_VALUE_FIELDS is deliberately imported from
 * `cross-source-disagreement-monitor.ts` rather than re-listed here — the
 * monitor, the nightly audit (`scripts/lib/detection-floor-checks.mjs`) and
 * this guard must agree on the same four fields, and a second hand-copy of
 * the list is exactly how guard/write pairs drift apart (write-path-hardening
 * §1.4).
 */
import { HIGH_VALUE_FIELDS } from './cross-source-disagreement-monitor.js';

/**
 * Thrown when a write reaches the DB boundary carrying a HIGH_VALUE field
 * that consolidation never decided. Deliberately a distinct class so callers
 * (and tests) can tell a write-path integrity breach apart from an ordinary
 * DB/network failure — the two need very different responses.
 */
export class WritePathIntegrityError extends Error {
  constructor(
    message: string,
    readonly ipoId: string,
    readonly source: string,
    readonly undecidedFields: string[]
  ) {
    super(message);
    this.name = 'WritePathIntegrityError';
  }
}

export interface ConsolidationDecisionCheckInput {
  ipoId: string;
  source: string;
  /** The exact object about to be handed to the repository update call. */
  writtenData: Record<string, unknown>;
  /** `ConsolidationResult.fieldResults` for this write. */
  fieldResults: Array<{ fieldName: string }>;
}

/**
 * Assert that every HIGH_VALUE field actually present in `writtenData` has a
 * consolidation decision record behind it.
 *
 * A key whose value is `undefined` counts as NOT written — Drizzle drops
 * undefined keys, so guarding it would be a false positive on the very common
 * "scraper did not supply this field" shape.
 */
export function assertConsolidationDecisionRecorded(
  input: ConsolidationDecisionCheckInput
): void {
  const decided = new Set(input.fieldResults.map((f) => f.fieldName));

  const undecided = [...HIGH_VALUE_FIELDS].filter(
    (field) =>
      Object.prototype.hasOwnProperty.call(input.writtenData, field) &&
      input.writtenData[field] !== undefined &&
      !decided.has(field)
  );

  if (undecided.length === 0) return;

  throw new WritePathIntegrityError(
    `[T-339] write-path integrity breach: ipo ${input.ipoId} (source ${input.source}) is about to ` +
      `publish HIGH_VALUE field(s) [${undecided.join(', ')}] with no consolidation decision record. ` +
      `Consolidation is mandatory — a value with no recorded decision was chosen by last-writer-wins. ` +
      `Refusing the write.`,
    input.ipoId,
    input.source,
    undecided
  );
}
