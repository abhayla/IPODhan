/**
 * The ONE place that records "this child row's provenance could not be
 * resolved" — shared by every persister that routes a child table through
 * `consolidatedUpsertChildRows` (item 1).
 *
 * WHY IT IS A MODULE (slice s7c). Both helpers were closures inside
 * `persistFilingExtraction` (added in #625), bound to that function's `apply`,
 * `ipoId`, `source`, `lineage` and `deps`. The anchor persister is a SEPARATE
 * service with its own deps interface, so it could not call them — and the
 * brief for this slice is explicit that a fourth hand-written variant is not
 * acceptable. Extracting them into a factory makes the helper genuinely shared:
 * the filing persister builds one from its locals, the anchor persister builds
 * one from its own, and the handling shape has exactly one definition.
 *
 * Behaviour is unchanged from the closures it replaces.
 */

import logger from '../utils/logger.js';
import type { TrackFieldUpdateInput } from '@ipodhan/shared';

/**
 * The prefix that separates "the child-table consolidation flag was OFF" from
 * "the row-keyed child writer ran and FAILED": both leave a catch-all row under
 * `row_key = ''` written by the legacy `trackField(table, 'rows')` call that
 * still sits beside the consolidated writer. No change to the audit check can
 * separate them — the information is not in the data, it is only in the writer.
 * So the writer records it.
 *
 * The key is deliberately prefixed: `row-key-coverage-checks.mjs` flips a pair
 * from UNVERIFIABLE into enforcement the moment ONE non-empty row_key exists
 * for it, and every DERIVED key is then missing — so a failed writer reads FAIL
 * where it used to read as an unstarted one.
 *
 * Truncated to `field_sources.row_key`'s varchar(200); the prefix and the cause
 * class survive truncation because they lead.
 */
export const UNRESOLVED_ROW_KEY_PREFIX = 'unresolved:';
const ROW_KEY_MAX_LENGTH = 200;

export function unresolvedRowKey(reason: string): string {
  const key = `${UNRESOLVED_ROW_KEY_PREFIX}${reason.replace(/\s+/g, ' ').trim()}`;
  return key.length <= ROW_KEY_MAX_LENGTH ? key : key.slice(0, ROW_KEY_MAX_LENGTH);
}

/** The one `field_sources` method these helpers call. */
export interface UnresolvedNoterFieldSources {
  trackFieldUpdate(input: TrackFieldUpdateInput): Promise<unknown>;
}

/** The source ranks `field_sources` accepts, narrowed from its own input type. */
export type UnresolvedNoterSource = TrackFieldUpdateInput['source'];

export interface ChildRowNoterConfig {
  /** A dry run records nothing: it wrote no rows to have provenance about. */
  apply: boolean;
  ipoId: string;
  source: UnresolvedNoterSource;
  /**
   * The persister's lineage object, read lazily. A getter rather than a value
   * because the filing persister declares its `lineage` const AFTER the point
   * where it builds this noter; capturing it eagerly would capture `undefined`.
   */
  lineage: () => Record<string, unknown>;
  /**
   * Optional so a persister whose deps make `fieldSources` optional can still
   * build a noter. Absent means the marker cannot be filed — logged loudly,
   * never thrown: the caller is mid-write and must finish writing the row.
   */
  fieldSources?: UnresolvedNoterFieldSources;
  /** `field_sources.updated_by`, e.g. `FILING_PERSISTER`. */
  updatedBy: string;
  /** Log tag, e.g. `[FilingPersister]`. */
  logPrefix: string;
}

export interface ChildRowNoter {
  markChildRowsUnresolved(tableName: string, reason: string): Promise<void>;
  /**
   * The ONE handling shape for "the consolidator threw", shared by every call
   * site so no site can quietly diverge.
   *
   * Why it exists: with a real consolidator wired in, a Redis or DB fault
   * inside `consolidatedUpsertChildRows` PROPAGATES — and an unhandled throw
   * aborts the persist mid-write, skipping every table after the failing one.
   * Losing provenance is the cheap loss; losing the rest of the write is not.
   * So a throw is treated exactly like "no consolidator": the rows are still
   * WRITTEN, marked unresolved, with the cause recorded.
   *
   * Returns the `(...)` reason fragment callers append to each row's entry.
   */
  noteConsolidationThrew(
    tableName: string,
    error: unknown,
    context?: Record<string, unknown>
  ): Promise<string>;
}

export function createChildRowNoter(config: ChildRowNoterConfig): ChildRowNoter {
  const { apply, ipoId, source, lineage, fieldSources, updatedBy, logPrefix } = config;

  const markChildRowsUnresolved = async (tableName: string, reason: string): Promise<void> => {
    if (!apply) return;
    const rowKey = unresolvedRowKey(reason);
    if (!fieldSources) {
      logger.error(
        { ipoId, tableName, rowKey },
        `${logPrefix} no fieldSources repository — could not file the unresolved-row provenance marker`
      );
      return;
    }
    try {
      await fieldSources.trackFieldUpdate({
        ipoId,
        tableName,
        rowKey,
        fieldName: 'rows',
        source,
        // NOT tier 1a: nothing about these rows was resolved against a rank.
        confidence: 0,
        previousValue: null,
        previousSource: null,
        dataLineage: { ...lineage(), unresolvedReason: reason },
        updatedBy,
      });
    } catch (error) {
      logger.error(
        { err: error, ipoId, tableName, rowKey },
        `${logPrefix} could not file the unresolved-row provenance marker — this pair still reads as "writer not live" to the row-key coverage check`
      );
    }
  };

  const noteConsolidationThrew = async (
    tableName: string,
    error: unknown,
    context: Record<string, unknown> = {}
  ): Promise<string> => {
    const cause = (error as { cause?: { message?: string } } | undefined)?.cause?.message;
    const detail = `${(error as Error)?.message ?? 'unknown'}${cause ? ` <- ${cause}` : ''}`;
    logger.error(
      { err: error, cause, ipoId, tableName, ...context },
      `${logPrefix} child-row consolidation failed — writing the rows unresolved`
    );
    await markChildRowsUnresolved(tableName, `consolidation-threw: ${detail}`);
    return `consolidation failed: ${detail}`;
  };

  return { markChildRowsUnresolved, noteConsolidationThrew };
}
