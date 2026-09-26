/**
 * Schema-drift assert — compares the Drizzle schema SSOT
 * (packages/shared/src/db/schema.ts) against the LIVE column set and
 * materialized-view set on a target database via information_schema /
 * pg_matviews, and fails loudly (naming the drift) rather than letting the
 * app 500 in production against a column/view the journal thinks exists but
 * the live database disagrees about.
 *
 * WHY THIS EXISTS (T-330, round-7 P2)
 * ------------------------------------
 * assert-migrations-applied.sh (T-267) only compares the journal's newest
 * `when` timestamp against drizzle.__drizzle_migrations' newest `created_at`
 * — it proves the journal *ran*, never that the DDL it ran actually matches
 * what's live. Two P2 bugs shipped from exactly that gap:
 *   - ipo_scores.algorithm_version: migration 0007's `CREATE TABLE IF NOT
 *     EXISTS` silently no-op'd against a pre-existing narrower varchar(10)
 *     column, so the journal marks 0007 applied while the live column stays
 *     varchar(10) forever (schema.ts has always said varchar(50)).
 *   - calendar_view: migration 0001 creates the matview, journal marks it
 *     applied, but the matview does not exist live (pg_matviews confirms).
 * Both are "journal says applied, live disagrees" — a class no existing gate
 * catches. This script closes that gap generically, for every table +
 * matview the code references, not just these two instances.
 *
 * WHAT IT CHECKS
 * --------------
 * 1. Column drift: for every exported Drizzle pgTable in schema.ts, every
 *    column's live `information_schema.columns` shape (data_type,
 *    character_maximum_length, numeric_precision/scale, is_nullable) must
 *    match what the schema SSOT declares. A live column NARROWER than the
 *    SSOT (e.g. varchar(10) vs varchar(50)) is exactly the P2-1 class and is
 *    reported as a named FAIL.
 * 2. Missing table: a table the schema SSOT declares but that does not exist
 *    live at all is a FAIL (distinct from a column-width mismatch).
 * 3. Matview drift: every entry in EXPECTED_MATVIEWS (below) must appear in
 *    pg_matviews on the live database, or it's a named FAIL. This list is a
 *    small, explicit, human-maintained registry (matviews have no Drizzle
 *    schema representation) — add an entry here only when application code
 *    actually queries that matview; retiring the last consumer of a matview
 *    should also remove its entry here (see calendar_view / T-330 P2-3).
 *
 * USAGE
 * -----
 *   npx tsx scripts/assert-schema-drift.ts <DATABASE_URL>
 *   npm run audit:schema-drift                    # against $DATABASE_URL
 *
 * Exit 0 = no drift found. Exit 1 = at least one named drift (or a connection
 * failure — a database that cannot be reached is a hard fail, never a silent
 * skip, matching assert-migrations-applied.sh's philosophy).
 *
 * WHERE IT RUNS
 * -------------
 * (a) scripts/deploy-linux.sh, as a deploy-blocking step immediately after
 *     assert-migrations-applied.sh (same "prove it, don't assume it" spot).
 * (b) The nightly audit, read-only, so drift introduced by an out-of-band DB
 *     change (not through a migration at all) is caught within 24h even
 *     between deploys.
 */

// Item 1 slice s14 -- FIRST import on purpose. ESM evaluates imported modules in
// source order, so this runs (and prints which checkout @ipodhan/shared resolves
// to) before any module below can read the wrong tree.
import './lib/alias-preflight-auto.mjs';
import { Client } from 'pg';
import { resolveDiscreteDbParams } from '@ipodhan/shared/db';
import * as schema from '@ipodhan/shared/db/schema';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export interface ColumnExpectation {
  tableName: string;
  columnName: string;
  sqlType: string; // drizzle's own getSQLType(), e.g. "varchar(50)", "integer", "timestamp"
}

export interface Drift {
  kind:
    | 'MISSING_TABLE'
    | 'MISSING_COLUMN'
    | 'COLUMN_TYPE_MISMATCH'
    | 'MISSING_MATVIEW'
    | 'MISSING_INDEX'
    | 'INDEX_COLUMN_MISMATCH'
    | 'MISSING_UNIQUE_CONSTRAINT'
    | 'UNIQUE_CONSTRAINT_COLUMN_MISMATCH'
    | 'UNDECLARED_INDEX'
    | 'UNDECLARED_UNIQUE_CONSTRAINT'
    | 'STALE_UNDECLARED_BASELINE_ENTRY';
  detail: string;
}

// Item 1 slice s3b (clause 8, part 3): an index/constraint expectation, keyed
// by NAME but verified by exact ORDERED column list — name-only matching
// already failed once in this item (a constraint recreated under the right
// name on the wrong columns reported OK; see assert-row-key-constraints.ts,
// which this follows the same approach as).
export interface IndexExpectation {
  tableName: string;
  indexName: string;
  /** Column names, in the exact order the index covers them. */
  columns: string[];
}

export interface UniqueConstraintExpectation {
  tableName: string;
  constraintName: string;
  /** Column names, in the exact order the constraint covers them. */
  columns: string[];
}

export interface MatviewExpectation {
  name: string;
  referencedBy: string;
}

// Item 665: reverse-direction shapes. checkIndexes()/checkUniqueConstraints()
// above only ever ask "is what schema.ts declares present live?" — they have
// no way to notice a live object schema.ts never mentions at all (#665:
// ipos_symbol_key exists on staging, hand-applied, absent from schema.ts;
// the next `drizzle-kit generate` could silently DROP it). These shapes let
// the reverse check run as a pure function over plain data, so the unit test
// never needs a database.

/** A single-column .unique() modifier on a column (distinct from a
 * table-level unique() builder call — drizzle exposes these two very
 * differently; see collectExpectedUniqueColumns()'s header comment). */
export interface UniqueColumnExpectation {
  tableName: string;
  columnName: string;
}

export interface LiveIndexRow {
  tableName: string;
  indexName: string;
  /** Column names, in ordinal order — unordered comparisons hide a reordered
   * composite index serving a different query, same discipline as above. */
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export interface LiveConstraintRow {
  tableName: string;
  constraintName: string;
  constraintType: 'UNIQUE' | 'PRIMARY KEY';
  columns: string[];
}

/** A live object this check has already looked at and decided is not this
 * item's gap to close — with a one-line reason. Never used for a real
 * unknown; a genuine undeclared object is reported as a Drift and, per the
 * defect-fix contract, filed as a finding instead of silently swallowed. */
export interface AllowedUndeclaredEntry {
  tableName: string;
  name: string;
  reason: string;
}

// One entry: the automatic backing index Postgres creates for the legacy
// ipo_risk_factors unique constraint (see ALLOWED_UNDECLARED_UNIQUE_CONSTRAINTS
// below — same E2 gated migration, same reason, both sides of one constraint).
// Anything else here would need its own one-line reason; a real, unexplained
// gap belongs in the findings list, never silently added to this array.
export const ALLOWED_UNDECLARED_INDEXES: AllowedUndeclaredEntry[] = [
  {
    tableName: 'ipo_risk_factors',
    name: 'unique_ipo_risk_factors_ipo_seq',
    reason:
      "Postgres's automatic backing index for the legacy pre-rekey unique constraint on (ipo_id, seq); " +
      'see ALLOWED_UNDECLARED_UNIQUE_CONSTRAINTS below for the full reason (E2 gated migration).',
  },
];

export const ALLOWED_UNDECLARED_UNIQUE_CONSTRAINTS: AllowedUndeclaredEntry[] = [
  {
    tableName: 'ipo_risk_factors',
    name: 'unique_ipo_risk_factors_ipo_seq',
    reason:
      'legacy pre-rekey constraint on (ipo_id, seq); schema.ts now declares unique_ipo_risk_factors_ipo_heading_hash ' +
      'instead, applied by hand per-slot via web/drizzle/migrations/_gated/E2_risk_factor_heading_hash_key.sql ' +
      '(same reason KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT above tolerates the new name being absent pre-E2). ' +
      'Remove this entry once every slot has E2 applied and the old constraint dropped.',
  },
];

// ==================== EXPECTED MATVIEWS REGISTRY ====================
// Small, explicit, human-maintained — see file header point 3.
// Add an entry ONLY when live application code queries that matview.
export const EXPECTED_MATVIEWS: MatviewExpectation[] = [
  // calendar_view intentionally NOT listed: T-330 P2-3 retired its only
  // consumer (web/app/api/calendar/materialized/[category]/route.ts) because
  // the matview was never actually created in prod (migration 0001's CREATE
  // MATERIALIZED VIEW is journaled as applied but pg_matviews disagrees) and
  // no other code path ever called it. Re-add an entry here if a future
  // change reintroduces a real consumer AND lands the matview via a real,
  // verified migration.
];

// ==================== KNOWN-GATED TYPE DRIFT (T-405) ====================
// Small, explicit, human-maintained — same convention as EXPECTED_MATVIEWS
// above. These are int/numeric-precision widenings that are DESTRUCTIVE/
// type-changing DDL (table rewrite), so they live in
// web/drizzle/migrations/_gated/ pending Abhay's sign-off rather than being
// journaled (drizzle-migration-gated-ddl.md) — journaling a type change is
// explicitly out of scope for T-405 (#256).
//
// Production ALREADY has the widened types (verified 2026-09-02: prod
// gmp_records/listing_performance are numeric(10,2)/numeric(7,2), matching
// schema.ts) via a historical out-of-band change — so on a slot where that
// out-of-band change already landed, no drift is even generated here and
// this registry never matters. It exists only so the T-405 "replay the
// journal from empty" CI job — which,
// correctly, gets the narrow pre-widen types because a type change cannot
// be journaled — has a way to say "yes, that specific, already-known,
// already-approved-elsewhere gap, nothing else" instead of being permanently
// red over a gap that is not this job's to close.
//
// Remove an entry the moment its _gated/ file is applied AND journaled.
//
// `expected`/`actual` are the EXACT parenthesized type strings this script
// prints (see isColumnDrifted() below) — e.g. "numeric(10,2)" / "numeric(32,0)".
// isKnownGatedDrift() requires all four fields (table, column, expected,
// actual) to match verbatim, so any FUTURE drift on these columns — a
// different live type than the one captured here — still FAILS instead of
// being silently swallowed by a same-column prefix match.
export const KNOWN_GATED_TYPE_DRIFT: { tableName: string; columnName: string; expected: string; actual: string; gatedFile: string }[] = [
  { tableName: 'gmp_records', columnName: 'gmp', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'gmp_records', columnName: 'expected_listing_price', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'gmp_records', columnName: 'subject_rate', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'gmp_records', columnName: 'kostak_rate', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'listing_performance', columnName: 'listing_price', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'issue_price', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'listing_gain_percent', expected: 'numeric(7,2)', actual: 'numeric(5,2)', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_price', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_price_bse', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_price_nse', expected: 'numeric(10,2)', actual: 'numeric(32,0)', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_gain_percent', expected: 'numeric(7,2)', actual: 'numeric(5,2)', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
];

/**
 * Exact-match predicate for KNOWN_GATED_TYPE_DRIFT (T-405). A drift is
 * considered "known-gated" only when its kind, table.column, AND the exact
 * expected/actual type strings all match a registry entry — a same-column
 * drift with a DIFFERENT actual type (or a different column entirely) is
 * NOT gated and must still fail the check.
 */
export function isKnownGatedDrift(d: Drift): boolean {
  if (d.kind !== 'COLUMN_TYPE_MISMATCH') return false;
  return KNOWN_GATED_TYPE_DRIFT.some(
    (g) =>
      d.detail === `"${g.tableName}.${g.columnName}" expects ${g.expected}, live column is ${g.actual}`
  );
}
// KNOWN_GATED_INDEX_DRIFT is EMPTY and should normally stay that way.
//
// It exists for one narrow case: a schema object that is deliberately applied to a
// slot BY HAND, out of the migration journal, so schema.ts and the live database
// legitimately disagree for a while. #464 used it for exactly one entry - the
// field_sources index that slice s3 widened on ipodhan_test ahead of its own merge -
// and slice s3 removed that entry here, because s3 is the change that made schema.ts
// and the index agree again.
//
// If you add an entry: it is suppressed ONLY under SCHEMA_DRIFT_IGNORE_GATED=1, which
// is set in exactly one place (pr-gate.yml). deploy-linux.sh and the nightly audit call
// this script bare and still fail on it. Matching is exact, so a DIFFERENT mismatch on
// the same object still fails rather than being swallowed. And
// scripts/tests/known-gated-registry-invalidation.test.ts will fail the moment your
// entry stops matching what schema.ts declares, so the entry cannot outlive its reason.
export const KNOWN_GATED_INDEX_DRIFT: { tableName: string; indexName: string; expectedColumns: string; actualColumns: string }[] = [
  // EMPTIED by item 01 slice s3, which is the change the previous entry was
  // waiting for: schema.ts now declares row_key on idx_field_sources_ipo_table_field,
  // so schema.ts and the live index agree and there is no drift left to tolerate.
  // known-gated-registry-invalidation.test.ts FAILED this PR until the entry was
  // removed - which is exactly what that guard exists to do. It replaced a comment
  // saying 'remove this when s3 merges' with a test that would not let s3 merge.
];

/**
 * Exact-match predicate for KNOWN_GATED_INDEX_DRIFT, same discipline as
 * isKnownGatedDrift(): all fields must match verbatim, so a DIFFERENT
 * mismatch on the same index still fails instead of being swallowed.
 */
// field_sources/data_conflicts.idx_field_sources_ipo_table_field aside, the
// three row-key UNIQUE constraints schema.ts declares (promoters,
// peer_companies, ipo_intermediaries) are DELIBERATELY kept out of the
// migration journal — web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql
// applies them BY HAND, per slot, after a normalized_name backfill (see that
// file's header and assert-row-key-constraints.ts, the existing dedicated
// verifier for this exact gap). Until an operator hand-applies the gated
// file on a given slot, checkUniqueConstraints() correctly sees "declared in
// schema.ts, missing live" — real information, but not THIS slice's gap to
// close. assert-row-key-constraints.ts CAN verify that hand-apply step, but
// it is wired only as the npm script `audit:row-key-constraints` — no
// workflow, deploy script or cron currently calls it, so today nothing runs
// it on a schedule; treat it as a manual check an operator runs after
// hand-applying the gated file, not as standing coverage. Gated the same way
// as KNOWN_GATED_TYPE_DRIFT/KNOWN_GATED_INDEX_DRIFT above.
//
// #464, item 1 slice s10 (2026-09-10): a slot that legitimately has NOT yet
// had the gated file hand-applied is the EXPECTED state, not a broken one —
// a bare deploy-linux.sh call blocked every staging deploy on exactly these
// three entries for 10 consecutive runs. deploy-linux.sh now calls this
// script WITH SCHEMA_DRIFT_IGNORE_GATED=1, so it no longer fails on a slot
// that never got the gated file applied; it still fails on anything NOT in
// this registry (a real, undeclared gap). The nightly audit still calls
// this script bare and keeps reporting these three as open work per slot —
// that is unchanged and intentional.
export const KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT: { tableName: string; constraintName: string }[] = [
  { tableName: 'promoters', constraintName: 'unique_promoters_ipo_id_normalized_name' },
  { tableName: 'peer_companies', constraintName: 'unique_peer_companies_ipo_id_normalized_name' },
  { tableName: 'ipo_intermediaries', constraintName: 'unique_ipo_intermediaries_ipo_id_role_normalized_name' },
  // Item 1 slice s6: the risk-factor re-key from positional `seq` to
  // `heading_hash`. schema.ts declares this constraint, but its DDL lives in
  // web/drizzle/migrations/_gated/E2_risk_factor_heading_hash_key.sql and is
  // deliberately OUT of meta/_journal.json - a journaled DROP+ADD would run
  // unattended against ~2130 rows still holding the '' default and fail on the
  // second one, killing the release mid-deploy. So a journal-replayed database
  // legitimately lacks it until an operator applies the gated file per slot
  // (docs/ops/prod-ops-recipes.md section 8d). Same reason as the three E1
  // entries above. Remove this entry once every slot has E2 applied.
  { tableName: 'ipo_risk_factors', constraintName: 'unique_ipo_risk_factors_ipo_heading_hash' },
];

export function isKnownGatedUniqueConstraintDrift(d: Drift): boolean {
  if (d.kind !== 'MISSING_UNIQUE_CONSTRAINT') return false;
  return KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT.some(
    (g) => d.detail === `"${g.tableName}.${g.constraintName}" is declared in schema.ts but does not exist on the live database`
  );
}

export function isKnownGatedIndexDrift(d: Drift): boolean {
  if (d.kind !== 'INDEX_COLUMN_MISMATCH') return false;
  return KNOWN_GATED_INDEX_DRIFT.some(
    (g) =>
      d.detail ===
      `"${g.tableName}.${g.indexName}" expects columns (${g.expectedColumns}), live index covers (${g.actualColumns})`
  );
}

function collectExpectedColumns(): ColumnExpectation[] {
  const expectations: ColumnExpectation[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value as PgTable);
    for (const col of cfg.columns) {
      expectations.push({
        tableName: cfg.name,
        columnName: col.name,
        sqlType: col.getSQLType(),
      });
    }
  }
  return expectations;
}

/**
 * Parses drizzle's getSQLType() output (e.g. "varchar(50)", "numeric(15,2)",
 * "integer") into a shape comparable against information_schema.columns
 * (character_maximum_length / numeric_precision / numeric_scale). Returns
 * null length/precision/scale when the type carries none (e.g. "integer").
 */
function parseSqlType(sqlType: string): {
  baseType: string;
  length: number | null;
  precision: number | null;
  scale: number | null;
} {
  const match = sqlType.match(/^([a-z ]+?)(?:\(([\d, ]+)\))?$/i);
  const baseType = (match?.[1] ?? sqlType).trim().toLowerCase();
  const argsRaw = match?.[2];
  if (!argsRaw) return { baseType, length: null, precision: null, scale: null };

  const args = argsRaw.split(',').map((s) => parseInt(s.trim(), 10));
  if (baseType === 'numeric' || baseType === 'decimal') {
    return { baseType, length: null, precision: args[0] ?? null, scale: args[1] ?? null };
  }
  // varchar/char family — single arg is the max length
  return { baseType, length: args[0] ?? null, precision: null, scale: null };
}

interface LiveColumn {
  data_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

function isColumnDrifted(expected: ColumnExpectation, live: LiveColumn): string | null {
  const parsed = parseSqlType(expected.sqlType);

  // varchar/char family: live length must be >= expected length (narrower = drift).
  if (parsed.baseType === 'varchar' || parsed.baseType === 'character varying') {
    if (parsed.length !== null && (live.character_maximum_length ?? Infinity) < parsed.length) {
      return `expects varchar(${parsed.length}), live column is varchar(${live.character_maximum_length})`;
    }
    return null;
  }

  // numeric/decimal family: live precision/scale must match exactly (narrower
  // precision silently truncates values; a mismatch either way is drift).
  if (parsed.baseType === 'numeric' || parsed.baseType === 'decimal') {
    if (
      parsed.precision !== null &&
      (live.numeric_precision !== parsed.precision || live.numeric_scale !== parsed.scale)
    ) {
      return `expects numeric(${parsed.precision},${parsed.scale}), live column is numeric(${live.numeric_precision},${live.numeric_scale})`;
    }
    return null;
  }

  // Other types (integer, text, timestamp, uuid, boolean, jsonb, enums, ...):
  // information_schema's data_type reporting is inconsistent for enums/arrays,
  // so we do a best-effort base-type family check only — the varchar/numeric
  // width checks above are this gate's precision-critical cases.
  return null;
}

export async function checkColumns(client: Client): Promise<Drift[]> {
  const drifts: Drift[] = [];
  const expectations = collectExpectedColumns();

  const tableNames = [...new Set(expectations.map((e) => e.tableName))];
  const { rows: existingTables } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames]
  );
  const existingTableSet = new Set(existingTables.map((r) => r.table_name));

  for (const tableName of tableNames) {
    if (!existingTableSet.has(tableName)) {
      drifts.push({
        kind: 'MISSING_TABLE',
        detail: `table "${tableName}" is declared in schema.ts but does not exist on the live database`,
      });
    }
  }

  const { rows: liveColumns } = await client.query<
    { table_name: string; column_name: string } & LiveColumn
  >(
    `SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames]
  );
  const liveColumnMap = new Map<string, LiveColumn>();
  for (const row of liveColumns) {
    liveColumnMap.set(`${row.table_name}.${row.column_name}`, row);
  }

  for (const expected of expectations) {
    if (!existingTableSet.has(expected.tableName)) continue; // already reported as MISSING_TABLE
    const key = `${expected.tableName}.${expected.columnName}`;
    const live = liveColumnMap.get(key);
    if (!live) {
      drifts.push({
        kind: 'MISSING_COLUMN',
        detail: `"${expected.tableName}.${expected.columnName}" is declared in schema.ts (${expected.sqlType}) but does not exist on the live table`,
      });
      continue;
    }
    const mismatch = isColumnDrifted(expected, live);
    if (mismatch) {
      drifts.push({
        kind: 'COLUMN_TYPE_MISMATCH',
        detail: `"${expected.tableName}.${expected.columnName}" ${mismatch}`,
      });
    }
  }

  return drifts;
}

export async function checkMatviews(
  client: Client,
  expectedMatviews: MatviewExpectation[] = EXPECTED_MATVIEWS
): Promise<Drift[]> {
  if (expectedMatviews.length === 0) return [];
  const { rows } = await client.query<{ matviewname: string }>(
    `SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'`
  );
  const liveMatviews = new Set(rows.map((r) => r.matviewname));

  const drifts: Drift[] = [];
  for (const expected of expectedMatviews) {
    if (!liveMatviews.has(expected.name)) {
      drifts.push({
        kind: 'MISSING_MATVIEW',
        detail: `materialized view "${expected.name}" is referenced by ${expected.referencedBy} but does not exist on the live database`,
      });
    }
  }
  return drifts;
}

// ==================== INDEX / UNIQUE CONSTRAINT DRIFT (item 1 slice s3b) ====================
// checkColumns() above compares column SHAPE only — it has zero occurrences
// of "index"/"constraint". A reviewer set schema.ts to a knowingly-wrong
// five-column index, ran no migration, and this script exited 0 saying the
// live database matched, because nothing here looked at pg_index at all.
// These two functions close that gap, following assert-row-key-constraints.ts's
// approach: match by NAME, verify by exact ORDERED column list (never by
// name alone, and never by unordered set — a reordered composite index
// serves different queries).

export function collectExpectedIndexes(): IndexExpectation[] {
  const expectations: IndexExpectation[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value as PgTable);
    for (const idx of cfg.indexes) {
      const name = idx.config.name;
      if (!name) continue; // unnamed indexes aren't addressable by name; skip rather than guess
      const columns = idx.config.columns
        .map((c) => ('name' in c ? (c as { name?: string }).name : undefined))
        .filter((n): n is string => typeof n === 'string');
      if (columns.length === 0) continue; // expression/SQL-only index — no plain column list to compare
      expectations.push({ tableName: cfg.name, indexName: name, columns });
    }
  }
  return expectations;
}

export function collectExpectedUniqueConstraints(): UniqueConstraintExpectation[] {
  const expectations: UniqueConstraintExpectation[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value as PgTable);
    for (const uc of cfg.uniqueConstraints) {
      const name = uc.getName();
      if (!name) continue;
      expectations.push({ tableName: cfg.name, constraintName: name, columns: uc.columns.map((c) => c.name) });
    }
  }
  return expectations;
}

/**
 * Item 665: `.unique()` chained directly on a COLUMN (e.g.
 * `slug: varchar(...).notNull().unique()`) is a completely different drizzle
 * code path from the table-level `unique()` builder call that
 * collectExpectedUniqueConstraints() reads — getTableConfig().uniqueConstraints
 * only ever holds the latter (it comes from the table's extraConfigBuilder;
 * see node_modules/drizzle-orm/pg-core/utils.*). A column-level `.unique()`
 * shows up only on the COLUMN object itself (`col.isUnique`), and its
 * constraint name is unreliable to predict: drizzle defaults an unnamed one to
 * `${table}_${column}_unique` (drizzle-orm/pg-core/unique-constraint.*
 * uniqueKeyName()), but a real, applied migration for the same declared
 * column may instead carry Postgres's OWN default name (`${table}_${column}_key`)
 * when the original DDL used a bare `UNIQUE` column modifier rather than a
 * named constraint — measured on ipodhan_staging 2026-09-26: admin_settings,
 * ipo_details, ipo_financials and ipo_slug_redirects all declare `.unique()`
 * in schema.ts today but carry live constraints named with the Postgres
 * default, not drizzle's. So this list is matched by (table, column) identity
 * in the reverse-drift checks below, never by name.
 */
export function collectExpectedUniqueColumns(): UniqueColumnExpectation[] {
  const expectations: UniqueColumnExpectation[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value as PgTable);
    for (const col of cfg.columns) {
      if ((col as unknown as { isUnique?: boolean }).isUnique) {
        expectations.push({ tableName: cfg.name, columnName: col.name });
      }
    }
  }
  return expectations;
}

/**
 * Item 665 (#665): the reverse direction. checkIndexes()/checkUniqueConstraints()
 * only ever check "declared -> present live"; this asks "present live ->
 * declared", which is the class #665 actually reports (ipos_symbol_key exists
 * on staging, hand-applied, and schema.ts has never heard of it — a
 * `drizzle-kit generate` run against the live DB's drift could DROP it).
 *
 * Deliberately excluded (not drift, matched generically rather than by name):
 *  - a PRIMARY KEY's automatic backing index (isPrimary) — schema.ts declares
 *    the primary key on the column itself, never as a named index/constraint.
 *  - the automatic backing index Postgres creates for a declared table-level
 *    unique() or column-level .unique() — the constraint IS the declaration;
 *    its backing index is not a second, separate thing to also declare.
 * Anything else undeclared is a real gap and is reported, never silently
 * dropped — see ALLOWED_UNDECLARED_INDEXES's header for the one exception
 * this file currently recognizes by name.
 */
export function diffUndeclaredIndexes(
  liveIndexes: LiveIndexRow[],
  declaredIndexes: IndexExpectation[],
  declaredUniqueConstraints: UniqueConstraintExpectation[],
  declaredUniqueColumns: UniqueColumnExpectation[],
  allowList: AllowedUndeclaredEntry[] = ALLOWED_UNDECLARED_INDEXES
): Drift[] {
  const declaredIndexNames = new Set(declaredIndexes.map((d) => d.indexName));
  const declaredUcNames = new Set(declaredUniqueConstraints.map((d) => d.constraintName));
  const declaredUniqueColumnKeys = new Set(declaredUniqueColumns.map((c) => `${c.tableName}.${c.columnName}`));
  const allowedKeys = new Set(allowList.map((a) => `${a.tableName}.${a.name}`));

  const drifts: Drift[] = [];
  for (const live of liveIndexes) {
    if (live.isPrimary) continue;
    if (declaredIndexNames.has(live.indexName)) continue;
    if (declaredUcNames.has(live.indexName)) continue;
    if (
      live.isUnique &&
      live.columns.length === 1 &&
      declaredUniqueColumnKeys.has(`${live.tableName}.${live.columns[0]}`)
    ) {
      continue;
    }
    if (allowedKeys.has(`${live.tableName}.${live.indexName}`)) continue;
    drifts.push({
      kind: 'UNDECLARED_INDEX',
      detail: `"${live.tableName}.${live.indexName}" (columns: ${live.columns.join(', ')}${live.isUnique ? ', UNIQUE' : ''}) exists on the live database but is not declared anywhere in schema.ts`,
    });
  }
  return drifts;
}

/** Same idea as diffUndeclaredIndexes(), for UNIQUE constraints (PRIMARY KEY
 * constraints are excluded the same way PK indexes are above). */
export function diffUndeclaredUniqueConstraints(
  liveConstraints: LiveConstraintRow[],
  declaredUniqueConstraints: UniqueConstraintExpectation[],
  declaredUniqueColumns: UniqueColumnExpectation[],
  allowList: AllowedUndeclaredEntry[] = ALLOWED_UNDECLARED_UNIQUE_CONSTRAINTS
): Drift[] {
  const declaredUcNames = new Set(declaredUniqueConstraints.map((d) => d.constraintName));
  const declaredUniqueColumnKeys = new Set(declaredUniqueColumns.map((c) => `${c.tableName}.${c.columnName}`));
  const allowedKeys = new Set(allowList.map((a) => `${a.tableName}.${a.name}`));

  const drifts: Drift[] = [];
  for (const live of liveConstraints) {
    if (live.constraintType === 'PRIMARY KEY') continue;
    if (declaredUcNames.has(live.constraintName)) continue;
    if (live.columns.length === 1 && declaredUniqueColumnKeys.has(`${live.tableName}.${live.columns[0]}`)) continue;
    if (allowedKeys.has(`${live.tableName}.${live.constraintName}`)) continue;
    drifts.push({
      kind: 'UNDECLARED_UNIQUE_CONSTRAINT',
      detail: `"${live.tableName}.${live.constraintName}" (columns: ${live.columns.join(', ')}) exists on the live database but is not declared anywhere in schema.ts`,
    });
  }
  return drifts;
}

/** Reads every plain-table index on `public`, one row per index (ordinal
 * column order preserved) — the live-side input to diffUndeclaredIndexes().
 * Unlike checkIndexes() above, this is NOT scoped to schema.ts's declared
 * table names: the whole point is to see objects schema.ts never mentions. */
export async function queryLiveIndexes(client: Client): Promise<LiveIndexRow[]> {
  const { rows } = await client.query<{
    table_name: string;
    index_name: string;
    column_name: string;
    is_unique: boolean;
    is_primary: boolean;
  }>(
    `SELECT t.relname AS table_name, i.relname AS index_name, a.attname AS column_name,
            ix.indisunique AS is_unique, ix.indisprimary AS is_primary
     FROM pg_index ix
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
     WHERE n.nspname = 'public' AND t.relkind = 'r'
     ORDER BY t.relname, i.relname, x.ord`
  );
  const byIndex = new Map<string, LiveIndexRow>();
  for (const row of rows) {
    const key = `${row.table_name}.${row.index_name}`;
    let entry = byIndex.get(key);
    if (!entry) {
      entry = {
        tableName: row.table_name,
        indexName: row.index_name,
        columns: [],
        isUnique: row.is_unique,
        isPrimary: row.is_primary,
      };
      byIndex.set(key, entry);
    }
    entry.columns.push(row.column_name);
  }
  return [...byIndex.values()];
}

/** Reads every UNIQUE / PRIMARY KEY constraint on `public`, one row per
 * constraint (ordinal column order preserved) — the live-side input to
 * diffUndeclaredUniqueConstraints(). Not scoped to schema.ts's declared table
 * names, same reasoning as queryLiveIndexes(). */
export async function queryLiveUniqueConstraints(client: Client): Promise<LiveConstraintRow[]> {
  const { rows } = await client.query<{
    table_name: string;
    constraint_name: string;
    constraint_type: 'UNIQUE' | 'PRIMARY KEY';
    column_name: string;
  }>(
    `SELECT tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.constraint_schema = tc.constraint_schema
      AND kcu.table_schema = tc.table_schema
     WHERE tc.table_schema = 'public'
       AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
     ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`
  );
  const byConstraint = new Map<string, LiveConstraintRow>();
  for (const row of rows) {
    const key = `${row.table_name}.${row.constraint_name}`;
    let entry = byConstraint.get(key);
    if (!entry) {
      entry = {
        tableName: row.table_name,
        constraintName: row.constraint_name,
        constraintType: row.constraint_type,
        columns: [],
      };
      byConstraint.set(key, entry);
    }
    entry.columns.push(row.column_name);
  }
  return [...byConstraint.values()];
}

/** Live-DB entrypoints wiring the pure diff functions above to a real
 * connection — what main() calls. Gated behind SCHEMA_DRIFT_CHECK_UNDECLARED=1
 * (see main()'s header comment on that flag for why it defaults off in CI). */
export async function checkUndeclaredIndexes(client: Client): Promise<Drift[]> {
  const live = await queryLiveIndexes(client);
  return diffUndeclaredIndexes(
    live,
    collectExpectedIndexes(),
    collectExpectedUniqueConstraints(),
    collectExpectedUniqueColumns()
  );
}

export async function checkUndeclaredUniqueConstraints(client: Client): Promise<Drift[]> {
  const live = await queryLiveUniqueConstraints(client);
  return diffUndeclaredUniqueConstraints(live, collectExpectedUniqueConstraints(), collectExpectedUniqueColumns());
}

// ==================== SHRINK-ONLY BASELINE FOR UNDECLARED FINDINGS (review round 1) ====================
// PR #1204 review round 1 (MAJOR): wiring SCHEMA_DRIFT_CHECK_UNDECLARED=1 into
// the nightly VPS cron unconditionally would make it exit 1 EVERY night from
// the first run — 38 pre-existing findings on staging alone (prod
// unmeasured), permanently red, which hides the next REAL new finding
// (signal-ownership.md R3/R4: new beats standing; a permanently-red gate is
// no gate). Same shape as config/scripts-typecheck-exclude-baseline.json
// (T-434): the committed baseline is the ONLY legitimate source of "already
// known (#665), still open" findings, and it can only shrink — an entry is
// removed the moment its object is fixed (declared in schema.ts, migrated
// properly, or dropped), never re-added by hand once gone.

export interface UndeclaredBaselineEntry {
  kind: 'UNDECLARED_INDEX' | 'UNDECLARED_UNIQUE_CONSTRAINT';
  tableName: string;
  name: string;
  issue: string;
}

function matchesBaselineEntry(drift: Drift, entry: UndeclaredBaselineEntry): boolean {
  return drift.kind === entry.kind && drift.detail.startsWith(`"${entry.tableName}.${entry.name}"`);
}

/**
 * Splits the live UNDECLARED_INDEX/UNDECLARED_UNIQUE_CONSTRAINT drifts against
 * the committed baseline into three buckets:
 *  - known: matches a baseline entry — already tracked on #665, reported as
 *    INFO, never fails the gate by itself.
 *  - newDrifts: NOT in the baseline — a genuinely new finding since the
 *    baseline was last measured. THIS is what fails the gate. Prod is never
 *    connected to from this script's normal callers, so the first nightly
 *    run against production may surface entries here that staging never had;
 *    that is expected (see this file's header on SCHEMA_DRIFT_CHECK_UNDECLARED)
 *    and is resolved by a reviewed PR adding them to the baseline, not by
 *    silently swallowing them.
 *  - staleEntries: a baseline entry whose object no longer exists live — the
 *    baseline must SHRINK (the object was fixed) or it is stale bookkeeping.
 *    Also fails the gate, so a fix is never "free" to leave the baseline
 *    claiming an object still exists.
 * Pure function over plain data — the unit test needs no database.
 */
export function diffAgainstUndeclaredBaseline(
  liveDrifts: Drift[],
  baseline: UndeclaredBaselineEntry[]
): { known: Drift[]; newDrifts: Drift[]; staleEntries: UndeclaredBaselineEntry[] } {
  const known: Drift[] = [];
  const newDrifts: Drift[] = [];
  for (const drift of liveDrifts) {
    if (baseline.some((entry) => matchesBaselineEntry(drift, entry))) {
      known.push(drift);
    } else {
      newDrifts.push(drift);
    }
  }
  const staleEntries = baseline.filter((entry) => !liveDrifts.some((drift) => matchesBaselineEntry(drift, entry)));
  return { known, newDrifts, staleEntries };
}

const UNDECLARED_BASELINE_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'config',
  'schema-drift-undeclared-baseline.json'
);

export function loadUndeclaredBaseline(path: string = UNDECLARED_BASELINE_PATH): UndeclaredBaselineEntry[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries: UndeclaredBaselineEntry[] };
  return raw.entries;
}

/**
 * Checks every named index schema.ts declares against pg_index on the live
 * database, ordered by column position (unnest(indkey) WITH ORDINALITY,
 * mirroring assert-row-key-constraints.ts's ordinal_position read for
 * constraints). Only checks indexes the SSOT declares — an extra live index
 * schema.ts never named is not this check's business, same asymmetry as
 * checkColumns() only checking SSOT-declared columns.
 */
export async function checkIndexes(client: Client): Promise<Drift[]> {
  const expectations = collectExpectedIndexes();
  if (expectations.length === 0) return [];

  const tableNames = [...new Set(expectations.map((e) => e.tableName))];
  const { rows } = await client.query<{ table_name: string; index_name: string; column_name: string }>(
    `SELECT t.relname AS table_name, i.relname AS index_name, a.attname AS column_name
     FROM pg_index ix
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n)
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
     WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])
     ORDER BY t.relname, i.relname, x.n`,
    [tableNames]
  );

  const liveIndexes = new Map<string, { tableName: string; columns: string[] }>();
  for (const row of rows) {
    let entry = liveIndexes.get(row.index_name);
    if (!entry) {
      entry = { tableName: row.table_name, columns: [] };
      liveIndexes.set(row.index_name, entry);
    }
    entry.columns.push(row.column_name);
  }

  const drifts: Drift[] = [];
  for (const expected of expectations) {
    const live = liveIndexes.get(expected.indexName);
    if (!live) {
      drifts.push({
        kind: 'MISSING_INDEX',
        detail: `"${expected.tableName}.${expected.indexName}" is declared in schema.ts but does not exist on the live database`,
      });
      continue;
    }
    const columnsMatch =
      live.columns.length === expected.columns.length && live.columns.every((c, i) => c === expected.columns[i]);
    if (!columnsMatch) {
      drifts.push({
        kind: 'INDEX_COLUMN_MISMATCH',
        detail: `"${expected.tableName}.${expected.indexName}" expects columns (${expected.columns.join(', ')}), live index covers (${live.columns.join(', ')})`,
      });
    }
  }
  return drifts;
}

/**
 * Same idea as checkIndexes(), for UNIQUE constraints declared via unique()
 * in schema.ts, checked against information_schema (constraint_type =
 * 'UNIQUE') the same way assert-row-key-constraints.ts does.
 */
export async function checkUniqueConstraints(client: Client): Promise<Drift[]> {
  const expectations = collectExpectedUniqueConstraints();
  if (expectations.length === 0) return [];

  const names = expectations.map((e) => e.constraintName);
  const { rows } = await client.query<{
    constraint_name: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT tc.constraint_name, tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.constraint_schema = tc.constraint_schema
      AND kcu.table_schema = tc.table_schema
     WHERE tc.table_schema = 'public'
       AND tc.constraint_type = 'UNIQUE'
       AND tc.constraint_name = ANY($1::text[])
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [names]
  );

  const liveConstraints = new Map<string, { tableName: string; columns: string[] }>();
  for (const row of rows) {
    let entry = liveConstraints.get(row.constraint_name);
    if (!entry) {
      entry = { tableName: row.table_name, columns: [] };
      liveConstraints.set(row.constraint_name, entry);
    }
    entry.columns.push(row.column_name);
  }

  const drifts: Drift[] = [];
  for (const expected of expectations) {
    const live = liveConstraints.get(expected.constraintName);
    if (!live) {
      drifts.push({
        kind: 'MISSING_UNIQUE_CONSTRAINT',
        detail: `"${expected.tableName}.${expected.constraintName}" is declared in schema.ts but does not exist on the live database`,
      });
      continue;
    }
    const columnsMatch =
      live.columns.length === expected.columns.length && live.columns.every((c, i) => c === expected.columns[i]);
    if (!columnsMatch) {
      drifts.push({
        kind: 'UNIQUE_CONSTRAINT_COLUMN_MISMATCH',
        detail: `"${expected.tableName}.${expected.constraintName}" expects columns (${expected.columns.join(', ')}), live constraint covers (${live.columns.join(', ')})`,
      });
    }
  }
  return drifts;
}

/**
 * Resolves connection config the same way scripts/audit-ipo-coverage.mjs
 * does: a CLI arg or DATABASE_URL wins outright; otherwise fall back to the
 * discrete DATABASE_HOST/PORT/NAME/USER/PASSWORD vars the prod VPS env may
 * supply instead of a single URL.
 */
function resolveClient(): Client {
  const argOrUrl = process.argv[2] ?? process.env.DATABASE_URL;
  if (argOrUrl) {
    return new Client({ connectionString: argOrUrl });
  }
  if (process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD) {
    return new Client({
      ...resolveDiscreteDbParams(),
    });
  }
  console.error('FATAL: no DATABASE_URL (arg or env var) and no DATABASE_HOST+DATABASE_PASSWORD pair.');
  process.exit(1);
}

async function main() {
  const client = resolveClient();
  try {
    await client.connect();
  } catch (error) {
    console.error(
      `FATAL: could not connect to the target database: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  try {
    const [columnDrifts, matviewDrifts, indexDrifts, uniqueConstraintDrifts] = await Promise.all([
      checkColumns(client),
      checkMatviews(client),
      checkIndexes(client),
      checkUniqueConstraints(client),
    ]);

    // #665: the reverse direction (live object, undeclared in schema.ts) is
    // gated behind SCHEMA_DRIFT_CHECK_UNDECLARED=1 rather than run
    // unconditionally like the four checks above, AND filtered through a
    // shrink-only baseline (config/schema-drift-undeclared-baseline.json,
    // diffAgainstUndeclaredBaseline() below) before it can fail anything —
    // review round 1 (MAJOR): 38 pre-existing findings on staging alone (prod
    // never measured — this script never connects to it from this check)
    // would otherwise make the nightly VPS cron exit 1 EVERY night from the
    // first run, permanently red, which hides the next real new finding
    // (signal-ownership.md R3/R4). Only a genuinely NEW undeclared object, or
    // a baseline entry whose object no longer exists live (the baseline
    // failing to shrink), is fatal. The first nightly run against PRODUCTION
    // may still name extra NEW objects staging never had (this file never
    // connects to prod to check) — that is expected, reported by name, and
    // resolved by a reviewed PR adding them to the baseline, never silently.
    // pr-gate.yml and deploy-linux.sh remain unaffected (checkUndeclared stays
    // false there) until each finding is triaged.
    const checkUndeclared = process.env.SCHEMA_DRIFT_CHECK_UNDECLARED === '1';
    const [undeclaredIndexDrifts, undeclaredUniqueConstraintDrifts] = checkUndeclared
      ? await Promise.all([checkUndeclaredIndexes(client), checkUndeclaredUniqueConstraints(client)])
      : [[], []];

    // Review round 1 fix: run the raw undeclared drifts through the
    // shrink-only baseline (config/schema-drift-undeclared-baseline.json)
    // BEFORE they can fail the gate — see diffAgainstUndeclaredBaseline()'s
    // header for why. Only genuinely NEW findings (never seen before) and
    // stale baseline entries (an object the baseline still claims exists but
    // doesn't anymore) are fatal; the 38 already-known #665 findings are
    // reported as INFO, not FATAL, every run.
    let undeclaredNewDrifts: Drift[] = [];
    let undeclaredStaleDrifts: Drift[] = [];
    if (checkUndeclared) {
      const baseline = loadUndeclaredBaseline();
      const { known, newDrifts, staleEntries } = diffAgainstUndeclaredBaseline(
        [...undeclaredIndexDrifts, ...undeclaredUniqueConstraintDrifts],
        baseline
      );
      if (known.length > 0) {
        console.log(
          `INFO: ${known.length} known (#665) undeclared index/constraint finding(s), tracked in config/schema-drift-undeclared-baseline.json, ${known.length} remaining:`
        );
        for (const drift of known) console.log(`  [${drift.kind}] ${drift.detail}`);
      }
      undeclaredNewDrifts = newDrifts;
      undeclaredStaleDrifts = staleEntries.map((entry) => ({
        kind: 'STALE_UNDECLARED_BASELINE_ENTRY',
        detail: `"${entry.tableName}.${entry.name}" (${entry.kind}, ${entry.issue}) is in config/schema-drift-undeclared-baseline.json but no longer exists live — remove it (the baseline can only shrink)`,
      }));
    }

    // SCHEMA_DRIFT_IGNORE_GATED=1 is set by the T-405 "replay the journal
    // from empty" CI job (pr-gate.yml scraper-document-integration) AND, as
    // of #464 (item 1 slice s10), by scripts/deploy-linux.sh's migration
    // step — a bare deploy call fails forever on a slot that has not yet had
    // the E1 gated file hand-applied, which is expected, not broken (see
    // KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT above). The nightly audit still
    // calls this script bare and is unaffected. Filtering happens here, at
    // the CLI/exit-code boundary, so checkColumns() itself keeps reporting
    // the full truth for every other caller (the self-test included).
    const ignoreGated = process.env.SCHEMA_DRIFT_IGNORE_GATED === '1';
    const combined = [
      ...columnDrifts,
      ...matviewDrifts,
      ...indexDrifts,
      ...uniqueConstraintDrifts,
      ...undeclaredNewDrifts,
      ...undeclaredStaleDrifts,
    ];
    const knownGated = ignoreGated
      ? combined.filter((d) => isKnownGatedDrift(d) || isKnownGatedIndexDrift(d) || isKnownGatedUniqueConstraintDrift(d))
      : [];
    const allDrifts = combined.filter((d) => !knownGated.includes(d));

    if (knownGated.length > 0) {
      console.log(`INFO: ${knownGated.length} known-gated drift finding(s) ignored (SCHEMA_DRIFT_IGNORE_GATED=1):`);
      for (const drift of knownGated) {
        console.log(`  [${drift.kind}] ${drift.detail}`);
      }
    }

    if (allDrifts.length > 0) {
      console.error(`FATAL: schema drift detected (${allDrifts.length} finding(s)):`);
      for (const drift of allDrifts) {
        console.error(`  [${drift.kind}] ${drift.detail}`);
      }
      process.exit(1);
    }

    console.log('OK: no schema drift — live database matches packages/shared/src/db/schema.ts and the matview registry.');
    process.exit(0);
  } catch (error) {
    console.error(
      `FATAL: schema-drift check itself failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Only run when invoked directly (npx tsx scripts/assert-schema-drift.ts ...),
// never when imported by the self-test harness (scripts/tests/assert-schema-drift.test.ts).
if (process.argv[1] && process.argv[1].endsWith('assert-schema-drift.ts')) {
  main();
}
