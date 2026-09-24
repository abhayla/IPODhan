/**
 * OD-99: what the consolidated writer (`data-consolidation-orchestrator.ts`)
 * can and cannot accept, kept in a module with no DB imports so the
 * field-plan walk and its gap keys can read it without loading the writer.
 */
import { FEATURE_FLAGS } from '../config/feature-flags.js';

/**
 * Tables with structurally ONE row per IPO. Only these may legitimately carry
 * the `''` row key — for any other table `''` means "the caller could not key
 * this row", which is a skip, not a write.
 */
export const SINGLETON_ROW_CHILD_TABLES: ReadonlySet<string> = new Set([
  'ipo_details',
  'anchor_investors',
]);

/**
 * OD-99: the skip reasons this writer gives for a STRUCTURAL refusal -- it
 * will give the same one every time it is asked until the writer itself (its
 * flags, its keyable tables, its code) changes. Every other skip (a lost
 * lock, an error mid-write) is transient. The field-plan walk records a
 * structural refusal as a gap instead of re-queuing it (OD-62, OD-78).
 */
export const STRUCTURAL_WRITE_SKIP_REASONS: ReadonlySet<string> = new Set([
  'CONSOLIDATION_DISABLED',
  'CHILD_TABLE_CONSOLIDATION_DISABLED',
  'MISSING_ROW_KEY',
]);

/**
 * OD-99: bump when a change to this writer's CODE (not its flags or the table
 * set below, which are read directly) lets it accept a write it used to refuse
 * structurally -- e.g. keying a table it could not key. The bump reopens every
 * plan row parked as WRITER_CANNOT_ACCEPT.
 */
export const CONSOLIDATED_WRITER_CAPABILITY_VERSION = 1;

/**
 * OD-99: what decides whether this writer can accept a write for `tableName`,
 * as one string. Part of a WRITER_CANNOT_ACCEPT row's gap key, so when any of
 * these change the row is asked again.
 */
export function consolidatedWriterCapability(path: 'ipo' | 'child', tableName: string): string {
  const version = `v${CONSOLIDATED_WRITER_CAPABILITY_VERSION}`;
  if (path === 'ipo') return `${version}|ipo|c${FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION ? 1 : 0}`;
  return `${version}|child|cc${FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION ? 1 : 0}|s${
    SINGLETON_ROW_CHILD_TABLES.has(tableName) ? 1 : 0
  }`;
}
