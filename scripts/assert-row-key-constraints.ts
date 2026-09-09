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

import { Client } from 'pg';

export interface ExpectedConstraint {
  tableName: string;
  constraintName: string;
}

export const EXPECTED_ROW_KEY_CONSTRAINTS: ExpectedConstraint[] = [
  { tableName: 'promoters', constraintName: 'unique_promoters_ipo_id_normalized_name' },
  { tableName: 'peer_companies', constraintName: 'unique_peer_companies_ipo_id_normalized_name' },
  {
    tableName: 'ipo_intermediaries',
    constraintName: 'unique_ipo_intermediaries_ipo_id_role_normalized_name',
  },
];

export interface ConstraintStatus extends ExpectedConstraint {
  present: boolean;
}

/**
 * Read-only check: for each expected constraint, is it present on the live
 * database? A single query against `information_schema.table_constraints`
 * (never `pg_constraint` alone, to stay consistent with the read style
 * `assert-schema-drift.ts` already uses for this database).
 */
export async function checkRowKeyConstraints(
  client: Client,
  expected: ExpectedConstraint[] = EXPECTED_ROW_KEY_CONSTRAINTS
): Promise<ConstraintStatus[]> {
  const names = expected.map((e) => e.constraintName);
  const { rows } = await client.query<{ constraint_name: string }>(
    `SELECT constraint_name
     FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND constraint_type = 'UNIQUE'
       AND constraint_name = ANY($1::text[])`,
    [names]
  );
  const liveNames = new Set(rows.map((r) => r.constraint_name));

  return expected.map((e) => ({ ...e, present: liveNames.has(e.constraintName) }));
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
    const missing = statuses.filter((s) => !s.present);

    console.log(`Row-key UNIQUE constraints on slot "${slot}":`);
    for (const s of statuses) {
      console.log(`  [${s.present ? 'OK' : 'MISSING'}] ${s.tableName}.${s.constraintName}`);
    }

    if (missing.length > 0) {
      console.error(
        `FATAL: ${missing.length} of ${statuses.length} row-key UNIQUE constraint(s) missing on "${slot}": ` +
          missing.map((s) => `${s.tableName}.${s.constraintName}`).join(', ')
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
