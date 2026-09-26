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
// #968 (OD-95): an override's higher source answered and the priority matrix kept the settled value.
export const OVERRIDE_SOURCE_LOST_TO_PRIORITY = 'OVERRIDE_SOURCE_LOST_TO_PRIORITY';
export const ADMIN_ONLY_CONFLICT_REASONS = Object.freeze([SOURCE_CHANGED_OWN_VALUE, OVERRIDE_SOURCE_LOST_TO_PRIORITY]);

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
  const res = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'data_conflicts' AND column_name = 'document_id'`
  );
  // Callers pass either a raw pg-shaped query ({rows: any[]}) or a pre-unwrapped
  // one that already resolves to the row array itself (e.g. audit-detection-floor's
  // `q = (sql,p) => pool.query(sql,p).then(r => r.rows)`). Accept both shapes.
  const rows = Array.isArray(res) ? res : (res?.rows ?? []);
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

/**
 * #818 / F-181: twin of `WRITER_BOOKKEEPING_FIELDS` in packages/shared/src/utils/conflict-reasons.ts
 * (kept equal by scripts/tests/conflict-reasons-parity.test.mjs). Columns the writer stamps itself
 * (spec section 1 class I) — a data_conflicts row on one of them is writer noise, never a conflict.
 */
export const WRITER_BOOKKEEPING_FIELDS = Object.freeze([
  'id',
  'createdAt',
  'updatedAt',
  'lastScrapedAt',
  'scrapedAt',
  'lastUpdated',
  'lastVerifiedAt',
]);

/**
 * #818 fix round 1: the money columns a unit conversion (crore / lakh / million -> rupees or crore)
 * writes, all NUMERIC(..., 2) in packages/shared/src/db/schema.ts. Float residue (more than two
 * decimals) is judged ONLY on these fields — a subscription ratio or a percentage may legitimately
 * carry more decimals and is never flagged. The parity test checks every name is a scale-2 column.
 */
export const RUPEE_AMOUNT_FIELDS = Object.freeze([
  'issueSize',
  'freshIssue',
  'ofsIssue',
  'minInvestment',
  'marketCap',
  'totalBorrowings',
  'totalAmountRaised',
  'mcapAtFloor',
  'mcapAtCap',
]);

/** The float-residue test on a stored text value: a plain number with 3+ decimals. */
export const FLOAT_RESIDUE_PATTERN = '^-?[0-9]+[.][0-9]{3,}$';

const sqlList = (names) => names.map((f) => `'${f}'`).join(', ');

/**
 * #818 check f_conflict_writer_noise: data_conflicts rows written in the last 48h that the writer
 * must never produce — a bookkeeping field, or a RUPEE_AMOUNT_FIELDS value carrying binary-float
 * residue (e.g. issueSize 428400000.00000006). Identities, never a bare count. Reads no
 * document_id, so it runs on a DB that lags main's migrations (F-182).
 */
export const conflictWriterNoiseSql = () =>
  `SELECT i.slug, dc.field_name AS "fieldName", dc.source1, dc.value1, dc.source2, dc.value2
     FROM data_conflicts dc LEFT JOIN ipos i ON i.id = dc.ipo_id
    WHERE dc.detected_at > now() - interval '48 hours'
      AND (dc.field_name IN (${sqlList(WRITER_BOOKKEEPING_FIELDS)})
           OR (dc.field_name IN (${sqlList(RUPEE_AMOUNT_FIELDS)})
               AND (dc.value1 ~ '${FLOAT_RESIDUE_PATTERN}' OR dc.value2 ~ '${FLOAT_RESIDUE_PATTERN}')))
    ORDER BY dc.detected_at DESC`;

/** JS twin of the SQL predicate, for tests: would this row be flagged? */
export function isConflictWriterNoise(row) {
  if (WRITER_BOOKKEEPING_FIELDS.includes(row.fieldName)) return true;
  if (!RUPEE_AMOUNT_FIELDS.includes(row.fieldName)) return false;
  const re = new RegExp(FLOAT_RESIDUE_PATTERN);
  return [row.value1, row.value2].some((v) => v != null && re.test(String(v)));
}
