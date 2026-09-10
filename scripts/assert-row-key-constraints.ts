/**
 * Row-key UNIQUE constraints assert — Item 1 slice s2 fix round (F-2).
 *
 * WHY THIS EXISTS
 * ----------------
 * `web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql` is
 * deliberately kept OUT of `meta/_journal.json` (see that file's header and
 * `docs/ops/prod-ops-recipes.md` §8c) — an operator applies it BY HAND, per
 * slot, after the `normalized_name` backfill for that slot reports 0 rows
 * still at `''`. Nothing before this script verified whether that hand-apply
 * step actually happened on a given slot. `assert-schema-drift.ts` cannot
 * see it either — it reads only `data_type`, `character_maximum_length`,
 * `numeric_precision` and `numeric_scale` from `information_schema.columns`,
 * none of which say anything about a CONSTRAINT. If step 3 of §8c is skipped
 * on production, duplicate identities (the exact class this slice exists to
 * close) accrue silently and permanently, with nothing to say so.
 *
 * WHAT IT CHECKS
 * --------------
 * Queries `information_schema.table_constraints` for the three UNIQUE
 * constraint names the gated file adds:
 *   - promoters:          unique_promoters_ipo_id_normalized_name
 *   - peer_companies:     unique_peer_companies_ipo_id_normalized_name
 *   - ipo_intermediaries: unique_ipo_intermediaries_ipo_id_role_normalized_name
 *   - ipo_risk_factors:   unique_ipo_risk_factors_ipo_heading_hash (E2, slice s6)
 * and reports, per slot, which of the three exist and which are missing.
 * READ-ONLY — this script never writes to the database.
 *
 * USAGE
 * -----
 *   npx tsx scripts/assert-row-key-constraints.ts <DATABASE_URL>
 *   npm run audit:row-key-constraints             # against $DATABASE_URL
 *
 * Exit 0 = all three constraints present. Exit 1 = at least one missing (or
 * a connection failure — a database that cannot be reached is a hard fail,
 * never a silent skip, matching assert-schema-drift.ts's philosophy).
 *
 * WHERE IT IS REFERENCED
 * -----------------------
 * `docs/ops/prod-ops-recipes.md` §8c, as the verification step run
 * immediately after applying the gated file (step 3) — an operator's own
 * memory that "I ran it" is not proof; this script reads what the database
 * actually has. NOT wired into the nightly audit — see that file's note on
 * why, right above the reference.
 */

// Item 1 slice s14 -- FIRST import on purpose. ESM evaluates imported modules in
// source order, so this runs (and prints which checkout @ipodhan/shared resolves
// to) before any module below can read the wrong tree.
import './lib/alias-preflight-auto.mjs';
import { Client } from 'pg';

export interface ExpectedConstraint {
  tableName: string;
  constraintName: string;
  /** Column names, in the exact order the UNIQUE constraint covers them. */
  columns: string[];
}

export const EXPECTED_ROW_KEY_CONSTRAINTS: ExpectedConstraint[] = [
  {
    tableName: 'promoters',
    constraintName: 'unique_promoters_ipo_id_normalized_name',
    columns: ['ipo_id', 'normalized_name'],
  },
  {
    tableName: 'peer_companies',
    constraintName: 'unique_peer_companies_ipo_id_normalized_name',
    columns: ['ipo_id', 'normalized_name'],
  },
  {
    tableName: 'ipo_intermediaries',
    constraintName: 'unique_ipo_intermediaries_ipo_id_role_normalized_name',
    columns: ['ipo_id', 'role', 'normalized_name'],
  },
  // Item 1 slice s6, gated file E2 (docs/ops/prod-ops-recipes.md §8d). Without
  // this entry §8d step 6 would tell an operator to "verify" with a tool that
  // never looks at the constraint they just applied.
  {
    tableName: 'ipo_risk_factors',
    constraintName: 'unique_ipo_risk_factors_ipo_heading_hash',
    columns: ['ipo_id', 'heading_hash'],
  },
];

export interface ConstraintStatus extends ExpectedConstraint {
  /** A UNIQUE constraint with this name exists on this schema at all. */
  present: boolean;
  /** Correctly named, on the expected table, covering exactly the expected
   *  columns in the expected order. This — not `present` — is the field a
   *  caller should gate on. (F-2, Tier A follow-up round: a constraint can
   *  be `present` under the right name while sitting on the wrong table or
   *  the wrong columns, and the old name-only check reported that as OK.) */
  ok: boolean;
  actualTableName: string | null;
  actualColumns: string[] | null;
  /** null when ok; otherwise a human-readable reason naming what's wrong,
   *  distinguishing "missing" from "wrong table" from "wrong columns" so an
   *  operator knows which mistake they made. */
  mismatchReason: string | null;
}

/**
 * Read-only check: for each expected constraint, does a UNIQUE constraint
 * with that name exist on the expected TABLE, covering exactly the expected
 * COLUMNS in the expected order? A name match alone is not proof — a
 * constraint recreated under the same name on the wrong columns (or the
 * wrong table) must fail this check, not pass it (F-2).
 *
 * Joins `information_schema.key_column_usage` to `table_constraints` (never
 * `pg_constraint` alone, to stay consistent with the read style
 * `assert-schema-drift.ts` already uses for this database) so the actual
 * table and column list are read, not assumed from the name.
 */
export async function checkRowKeyConstraints(
  client: Client,
  expected: ExpectedConstraint[] = EXPECTED_ROW_KEY_CONSTRAINTS
): Promise<ConstraintStatus[]> {
  const names = expected.map((e) => e.constraintName);
  const { rows } = await client.query<{
    constraint_name: string;
    table_name: string;
    column_name: string;
    ordinal_position: number;
  }>(
    `SELECT tc.constraint_name, tc.table_name, kcu.column_name, kcu.ordinal_position
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

  const byName = new Map<string, { tableName: string; columns: string[] }>();
  for (const row of rows) {
    let entry = byName.get(row.constraint_name);
    if (!entry) {
      entry = { tableName: row.table_name, columns: [] };
      byName.set(row.constraint_name, entry);
    }
    entry.columns.push(row.column_name);
  }

  return expected.map((e) => {
    const actual = byName.get(e.constraintName);
    if (!actual) {
      return {
        ...e,
        present: false,
        ok: false,
        actualTableName: null,
        actualColumns: null,
        mismatchReason: 'missing',
      };
    }

    const tableMatch = actual.tableName === e.tableName;
    const columnsMatch =
      actual.columns.length === e.columns.length && actual.columns.every((c, i) => c === e.columns[i]);

    if (tableMatch && columnsMatch) {
      return {
        ...e,
        present: true,
        ok: true,
        actualTableName: actual.tableName,
        actualColumns: actual.columns,
        mismatchReason: null,
      };
    }

    const reasons: string[] = [];
    if (!tableMatch) {
      reasons.push(`on table "${actual.tableName}", expected "${e.tableName}"`);
    }
    if (!columnsMatch) {
      reasons.push(`covers columns (${actual.columns.join(', ')}), expected (${e.columns.join(', ')})`);
    }

    return {
      ...e,
      present: true,
      ok: false,
      actualTableName: actual.tableName,
      actualColumns: actual.columns,
      mismatchReason: reasons.join('; '),
    };
  });
}

/**
 * Resolves connection config the same way scripts/assert-schema-drift.ts
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
    const dbNameResult = await client.query<{ current_database: string }>('select current_database()');
    const slot = dbNameResult.rows[0]?.current_database ?? '(unknown)';

    const statuses = await checkRowKeyConstraints(client);
    const bad = statuses.filter((s) => !s.ok);

    console.log(`Row-key UNIQUE constraints on slot "${slot}":`);
    for (const s of statuses) {
      if (s.ok) {
        console.log(`  [OK] ${s.tableName}.${s.constraintName} (${s.columns.join(', ')})`);
      } else if (!s.present) {
        console.log(`  [MISSING] ${s.tableName}.${s.constraintName}`);
      } else {
        console.log(`  [WRONG] ${s.constraintName}: ${s.mismatchReason}`);
      }
    }

    if (bad.length > 0) {
      console.error(
        `FATAL: ${bad.length} of ${statuses.length} row-key UNIQUE constraint(s) not correct on "${slot}": ` +
          bad
            .map((s) => (s.present ? `${s.constraintName} (${s.mismatchReason})` : `${s.tableName}.${s.constraintName} (missing)`))
            .join('; ')
      );
      process.exit(1);
    }

    console.log(`OK: all ${statuses.length} row-key UNIQUE constraints present on "${slot}".`);
    process.exit(0);
  } catch (error) {
    console.error(
      `FATAL: row-key constraint check itself failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Only run when invoked directly (npx tsx scripts/assert-row-key-constraints.ts ...),
// never when imported by a test harness.
if (process.argv[1] && process.argv[1].endsWith('assert-row-key-constraints.ts')) {
  main();
}
