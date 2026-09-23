/**
 * OD-75 (owner, 2026-09-23): the named `data_conflicts.resolution_reason` for a source changing a
 * value IT set earlier, where it has no right to refresh it. The page keeps the old value (OD-73);
 * the admin conflicts list shows the change under this reason; it is never alerted (the
 * cross-source disagreement monitor reads only `source1 <> source2`). One definition: the writer
 * (scraper data-consolidation-service.ts) sets it, the repository's W-79 same-source guard admits
 * only it.
 */
export const SOURCE_CHANGED_OWN_VALUE = 'SOURCE_CHANGED_OWN_VALUE';

/**
 * OD-75 round 2 (PR #914 review): the reasons whose rows exist ONLY for the admin conflicts list.
 * Such a row is a record that one source changed its own value; it is not a dispute. Every reader
 * of `data_conflicts` that decides behaviour or reports a count (the status-transition hold, the
 * conflict stats, the admin-queue size, the nightly backlog ratchet / noise ratio / inert-detector
 * and live-disagreement checks) MUST skip these rows; only the admin list shows them.
 * The SQL twin for the `.mjs` scripts is `scripts/lib/conflict-reasons.mjs`, kept equal to this
 * list by `scripts/tests/conflict-reasons-parity.test.mjs`.
 */
export const ADMIN_ONLY_CONFLICT_REASONS: readonly string[] = [SOURCE_CHANGED_OWN_VALUE];

/** True for a row that exists only for the admin list and must not affect behaviour or counts. */
export function isAdminOnlyConflict(row: { resolutionReason?: string | null }): boolean {
  return row.resolutionReason != null && ADMIN_ONLY_CONFLICT_REASONS.includes(row.resolutionReason);
}
