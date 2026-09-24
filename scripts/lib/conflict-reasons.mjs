// OD-75 round 2 (PR #914 review): SQL twin of packages/shared/src/utils/conflict-reasons.ts
// (ADMIN_ONLY_CONFLICT_REASONS). Rows under these reasons exist ONLY for the admin conflicts list
// (a source changing its own value, not a dispute); every count or behaviour-deciding read of
// data_conflicts in the .mjs scripts excludes them through behaviourConflictPredicate().
// Parity with the TS list: scripts/tests/conflict-reasons-parity.test.mjs.
//
// Item 9 fix (PR #989): the nightly audit runs main's scripts against the PROD database, which
// can lag main's migrations (34 applied vs main's 58 when this predicate started literally
// emitting `document_id IS NULL`). A predicate that references a column the audited DB does not
// yet have makes every later check in audit-detection-floor.mjs's main() skip, silently, every
// night, until a release ships the missing migration. The fix: probe the column's existence once
// per process (cached), and emit the document_id clause only when it is actually there — when
// it's absent there can be no suggestion rows to exclude, so omitting the clause is exact, not a
// guess. Callers MUST await `ensureDocumentIdProbe(query)` once before building any predicate or
// SQL that depends on it; every SQL that depends on the column is a function of the cached state,
// never a value frozen at import time.

export const SOURCE_CHANGED_OWN_VALUE = 'SOURCE_CHANGED_OWN_VALUE';
export const ADMIN_ONLY_CONFLICT_REASONS = Object.freeze([SOURCE_CHANGED_OWN_VALUE]);

// Cached probe result for this process: undefined = not yet probed (treated as "present" —
// the pre-probe/legacy-safe default, matching behaviour before this fix), true/false once probed.
let _hasDocumentIdColumn;

/**
 * Probe whether data_conflicts.document_id exists on the DB `query` reads from, once per
 * process. Idempotent — a second call is a no-op that returns the cached result.
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query e.g. `pool.query.bind(pool)`
 * @returns {Promise<boolean>}
 */
export async function ensureDocumentIdProbe(query) {
  if (_hasDocumentIdColumn !== undefined) return _hasDocumentIdColumn;
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'data_conflicts' AND column_name = 'document_id'`
  );
  _hasDocumentIdColumn = rows.length > 0;
  return _hasDocumentIdColumn;
}

/** Test-only: force the cached probe result (or reset with `undefined`). Never call in prod code. */
export function _setDocumentIdProbeForTests(value) {
  _hasDocumentIdColumn = value;
}

/**
 * SQL predicate: this data_conflicts row is a real dispute (not an admin-only record).
 * `IS DISTINCT FROM` keeps rows whose resolution_reason is NULL.
 * The document_id clause (OD-90) is included only when `ensureDocumentIdProbe` found the column,
 * or when the probe has never run (pre-probe default: assume present, the historical behaviour).
 * @param {string} [alias] table alias, e.g. 'dc'
 */
export function behaviourConflictPredicate(alias) {
  const col = alias ? `${alias}.resolution_reason` : 'resolution_reason';
  const list = ADMIN_ONLY_CONFLICT_REASONS.map((r) => `'${r}'`).join(', ');
  const base = `(${col} IS NULL OR ${col} NOT IN (${list}))`;
  if (_hasDocumentIdColumn === false) return base;
  const doc = alias ? `${alias}.document_id` : 'document_id';
  // OD-90: a corrigendum suggestion (document_id set) is admin review work, never a dispute.
  return `(${base} AND ${doc} IS NULL)`;
}

/** Unresolved real-dispute rows — the backlog the ratchet (check f) counts. */
export const unresolvedConflictCountSql = () =>
  `SELECT count(*)::int total FROM data_conflicts WHERE resolved_at IS NULL AND ${behaviourConflictPredicate()}`;

/** Unresolved real-dispute rows that are noise (check f's ratio numerator). */
export const unresolvedConflictNoiseSql = () =>
  `SELECT count(*)::int noise FROM data_conflicts WHERE resolved_at IS NULL AND (value2 IS NULL OR value2 = '' OR value1 = value2) AND ${behaviourConflictPredicate()}`;

/** Real-dispute rows detected in the last 24h (check g: is the detector inert?). */
export const conflictsInserted24hSql = () =>
  `SELECT count(*)::int inserted FROM data_conflicts WHERE detected_at > now() - interval '24 hours' AND ${behaviourConflictPredicate()}`;
