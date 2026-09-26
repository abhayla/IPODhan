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
 * #968 fix round 1 (OD-95, OD-61/OD-75 shape): an override ranked a source above the one that
 * settled a field, that source answered, and the field-priority matrix kept the settled value.
 * The page keeps the settled value, the row is restored (tried once under that override), and the
 * admin conflicts list shows the refused value under this reason. Admin-only, never an alert.
 */
export const OVERRIDE_SOURCE_LOST_TO_PRIORITY = 'OVERRIDE_SOURCE_LOST_TO_PRIORITY';

/**
 * OD-75 round 2 (PR #914 review): the reasons whose rows exist ONLY for the admin conflicts list.
 * Such a row is a record that one source changed its own value; it is not a dispute. Every reader
 * of `data_conflicts` that decides behaviour or reports a count (the status-transition hold, the
 * conflict stats, the admin-queue size, the nightly backlog ratchet / noise ratio / inert-detector
 * and live-disagreement checks) MUST skip these rows; only the admin list shows them.
 * The SQL twin for the `.mjs` scripts is `scripts/lib/conflict-reasons.mjs`, kept equal to this
 * list by `scripts/tests/conflict-reasons-parity.test.mjs`.
 */
export const ADMIN_ONLY_CONFLICT_REASONS: readonly string[] = [
  SOURCE_CHANGED_OWN_VALUE,
  OVERRIDE_SOURCE_LOST_TO_PRIORITY,
];

/** True for a row that exists only for the admin list and must not affect behaviour or counts. */
export function isAdminOnlyConflict(row: { resolutionReason?: string | null }): boolean {
  return row.resolutionReason != null && ADMIN_ONLY_CONFLICT_REASONS.includes(row.resolutionReason);
}

/**
 * OD-90 (item 9): a corrigendum SUGGESTION is a `data_conflicts` row that carries the document it
 * was read from (`document_id` set). It is the admin's to accept or dismiss — ONLY an admin accept
 * writes. Every AUTOMATIC reader of unresolved rows (the consolidation HOLD escapes, the
 * status-transition hold, the cross-source disagreement monitor, conflict counts, auto-resolve)
 * MUST skip it. The SQL twin for the `.mjs` scripts is `behaviourConflictPredicate()` in
 * `scripts/lib/conflict-reasons.mjs` (`document_id IS NULL`).
 */
export function isCorrigendumSuggestion(row: { documentId?: string | null } | null | undefined): boolean {
  return Boolean(row && row.documentId);
}

/**
 * True for a row that is a real source-vs-source dispute: neither an admin-only record (OD-75) nor
 * a corrigendum suggestion (OD-90). Use it wherever a row decides behaviour or enters a count.
 */
export function isBehaviourConflict(row: { resolutionReason?: string | null; documentId?: string | null }): boolean {
  return !isAdminOnlyConflict(row) && !isCorrigendumSuggestion(row);
}

/**
 * #818 / F-181 (spec §1 class I, "Our own pipeline produces it (bookkeeping) — writer named, no
 * ranking"): columns the writer itself stamps. No source ranks them, so two values of one of these
 * can never be a source disagreement or a source changing its own value (OD-75) — a new
 * `lastScrapedAt` on every scrape is the pipeline clock moving, not a conflict. Measured on staging
 * 2026-09-23..25: `lastScrapedAt` / `updatedAt` DRHP-vs-DRHP rows on moneyview-ltd,
 * skyways-air-services-ltd, steamhouse-india-ltd, veegaland-developers-ltd. The consolidator
 * passes these straight through and the conflicts repository refuses them.
 */
export const WRITER_BOOKKEEPING_FIELDS: readonly string[] = [
  'id',
  'createdAt',
  'updatedAt',
  'lastScrapedAt',
  'scrapedAt',
  'lastUpdated',
  'lastVerifiedAt',
];

/** True for a column the writer stamps itself (spec class I) — never resolved, never a conflict. */
export function isWriterBookkeepingField(fieldName: string): boolean {
  return WRITER_BOOKKEEPING_FIELDS.includes(fieldName);
}
