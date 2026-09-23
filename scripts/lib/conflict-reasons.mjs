// OD-75 round 2 (PR #914 review): SQL twin of packages/shared/src/utils/conflict-reasons.ts
// (ADMIN_ONLY_CONFLICT_REASONS). Rows under these reasons exist ONLY for the admin conflicts list
// (a source changing its own value, not a dispute); every count or behaviour-deciding read of
// data_conflicts in the .mjs scripts excludes them through behaviourConflictPredicate().
// Parity with the TS list: scripts/tests/conflict-reasons-parity.test.mjs.

export const SOURCE_CHANGED_OWN_VALUE = 'SOURCE_CHANGED_OWN_VALUE';
export const ADMIN_ONLY_CONFLICT_REASONS = Object.freeze([SOURCE_CHANGED_OWN_VALUE]);

/**
 * SQL predicate: this data_conflicts row is a real dispute (not an admin-only record).
 * `IS DISTINCT FROM` keeps rows whose resolution_reason is NULL.
 * @param {string} [alias] table alias, e.g. 'dc'
 */
export function behaviourConflictPredicate(alias) {
  const col = alias ? `${alias}.resolution_reason` : 'resolution_reason';
  const list = ADMIN_ONLY_CONFLICT_REASONS.map((r) => `'${r}'`).join(', ');
  return `(${col} IS NULL OR ${col} NOT IN (${list}))`;
}

/** Unresolved real-dispute rows — the backlog the ratchet (check f) counts. */
export const UNRESOLVED_CONFLICT_COUNT_SQL =
  `SELECT count(*)::int total FROM data_conflicts WHERE resolved_at IS NULL AND ${behaviourConflictPredicate()}`;

/** Unresolved real-dispute rows that are noise (check f's ratio numerator). */
export const UNRESOLVED_CONFLICT_NOISE_SQL =
  `SELECT count(*)::int noise FROM data_conflicts WHERE resolved_at IS NULL AND (value2 IS NULL OR value2 = '' OR value1 = value2) AND ${behaviourConflictPredicate()}`;

/** Real-dispute rows detected in the last 24h (check g: is the detector inert?). */
export const CONFLICTS_INSERTED_24H_SQL =
  `SELECT count(*)::int inserted FROM data_conflicts WHERE detected_at > now() - interval '24 hours' AND ${behaviourConflictPredicate()}`;
