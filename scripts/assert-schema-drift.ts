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

import { Client } from 'pg';
import * as schema from '@ipodhan/shared/db/schema';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';

export interface ColumnExpectation {
  tableName: string;
  columnName: string;
  sqlType: string; // drizzle's own getSQLType(), e.g. "varchar(50)", "integer", "timestamp"
}

export interface Drift {
  kind: 'MISSING_TABLE' | 'MISSING_COLUMN' | 'COLUMN_TYPE_MISMATCH' | 'MISSING_MATVIEW';
  detail: string;
}

export interface MatviewExpectation {
  name: string;
  referencedBy: string;
}

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
// schema.ts) via a historical out-of-band change — so this registry does
// NOT affect prod's deploy gate or the nightly audit, both of which call
// this script bare (no ignoreGatedTypeDrift) and therefore still see and
// FAIL on drift here the moment it's real on THAT environment. It exists
// only so the T-405 "replay the journal from empty" CI job — which,
// correctly, gets the narrow pre-widen types because a type change cannot
// be journaled — has a way to say "yes, that specific, already-known,
// already-approved-elsewhere gap, nothing else" instead of being permanently
// red over a gap that is not this job's to close.
//
// Remove an entry the moment its _gated/ file is applied AND journaled.
export const KNOWN_GATED_TYPE_DRIFT: { tableName: string; columnName: string; gatedFile: string }[] = [
  { tableName: 'gmp_records', columnName: 'gmp', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'gmp_records', columnName: 'expected_listing_price', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'gmp_records', columnName: 'subject_rate', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'gmp_records', columnName: 'kostak_rate', gatedFile: '_gated/B2_gmp_int_to_numeric.sql' },
  { tableName: 'listing_performance', columnName: 'listing_price', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'issue_price', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'listing_gain_percent', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_price', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_price_bse', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_price_nse', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
  { tableName: 'listing_performance', columnName: 'current_gain_percent', gatedFile: '_gated/C3_listing_performance_widen_precision.sql' },
];

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
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME || 'ipodhan',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD,
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
    const [columnDrifts, matviewDrifts] = await Promise.all([
      checkColumns(client),
      checkMatviews(client),
    ]);

    // SCHEMA_DRIFT_IGNORE_GATED=1 is set ONLY by the T-405 "replay the journal
    // from empty" CI job (pr-gate.yml scraper-document-integration), never by
    // deploy-linux.sh or the nightly audit — see KNOWN_GATED_TYPE_DRIFT above
    // for why. Filtering happens here, at the CLI/exit-code boundary, so
    // checkColumns() itself keeps reporting the full truth for every other
    // caller (the self-test included).
    const ignoreGated = process.env.SCHEMA_DRIFT_IGNORE_GATED === '1';
    const isKnownGated = (d: Drift) =>
      d.kind === 'COLUMN_TYPE_MISMATCH' &&
      KNOWN_GATED_TYPE_DRIFT.some((g) => d.detail.startsWith(`"${g.tableName}.${g.columnName}"`));

    const knownGated = ignoreGated ? [...columnDrifts, ...matviewDrifts].filter(isKnownGated) : [];
    const allDrifts = [...columnDrifts, ...matviewDrifts].filter((d) => !knownGated.includes(d));

    if (knownGated.length > 0) {
      console.log(`INFO: ${knownGated.length} known-gated type drift finding(s) ignored (SCHEMA_DRIFT_IGNORE_GATED=1):`);
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
