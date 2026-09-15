// repair-tool-exempt: 2026-09-16 scripts/lib/repair-tool.ts does not exist yet — all four pre-T-490 tools carry this same exemption; this tool uses the shared FieldSourcesRepository write path rather than re-typing a raw DELETE, and migrates with the others when that module lands.
/**
 * #654. Delete the `field_sources` rows that claim a source supplied a value
 * which does not exist on the parent row.
 *
 * WHY THESE ROWS ARE A DEFECT, not just untidy. A provenance row says "this
 * source supplied this field". When the parent column is NULL that is a FALSE
 * CLAIM, and it is worse than no claim: an audit reading `field_sources`
 * reports the field as sourced and healthy. Two IPOs that were OPEN and
 * UPCOMING on 2026-09-15 got no NSE documents because their NSE symbol was
 * missing, while the ledger said CHITTORGARH had supplied it.
 *
 * THE CODE DEFECT IS FIXED IN THE SAME CHANGE as this tool:
 * `resolveFieldConflict` returned early only when the incoming value was
 * missing AND the stored value was NOT, so a field missing on BOTH sides fell
 * through to the provenance write. That guard now returns `NOTHING_TO_RECORD`
 * first. This tool repairs the rows written before it existed.
 *
 * SCOPE IS COMPUTED, NEVER TYPED. The first measurement of this class counted
 * `symbol` alone and reported 61 rows — a tenth of the truth. So the population
 * comes from `scripts/lib/repair-invariants/provenance-parent-not-null.mjs`,
 * which reads the column list out of `information_schema` and checks every
 * `field_name` present in `field_sources`. On ipodhan_staging: 650 rows across
 * 14 fields.
 *
 * NULL only, never falsiness: `0`, `false` and `''` are values a source
 * genuinely supplied, and a row naming one of them is TRUE. Deleting those
 * would destroy real provenance to fix a reporting bug.
 *
 * `--expect-db <name>` is MANDATORY with `--apply` (#640): the script asks the
 * server which database it is connected to and refuses, before any write, if it
 * does not match. A repair aimed at staging must never land on production
 * because an env var was stale.
 *
 * Deletes go through `FieldSourcesRepository.delete()`, never a raw DELETE:
 * that is the write path the ratchet knows about, and it invalidates the
 * field-source caches a raw DELETE would leave serving the row it removed.
 *
 * Idempotent: re-running after a partial failure deletes only what is left.
 *
 * dry-run by default; --apply writes.
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1
 * DATABASE_PORT=15432 + creds).
 *
 * Exit codes: 0 done (or dry run complete); 1 a delete failed or rows remain;
 * 2 usage/guard refusal (no --expect-db with --apply, the wrong database, or
 * the two population computations disagreeing).
 */
import { db } from '@ipodhan/shared';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { FieldSourcesRepository } from '@ipodhan/shared/repositories';
import { sql } from 'drizzle-orm';
import provenanceParentNotNullInvariant from '../../scripts/lib/repair-invariants/provenance-parent-not-null.mjs';

const APPLY = process.argv.includes('--apply');
const expectIdx = process.argv.indexOf('--expect-db');
const EXPECT_DB: string | undefined = expectIdx >= 0 ? process.argv[expectIdx + 1] : undefined;

/** camelCase -> snake_case, the convention `field_sources.field_name` uses. */
function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

interface RepairRow {
  ipoId: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  source: string;
  confidence: number | null;
  slug: string | null;
  status: string | null;
  column: string;
}

export async function findRowsToRepair(): Promise<RepairRow[]> {
  const out: RepairRow[] = [];

  for (const table of ['ipos', 'ipo_details']) {
    const cols = await db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`
    );
    const columns = new Set((cols.rows as Array<{ column_name: string }>).map((r) => r.column_name));
    if (columns.size === 0) continue;

    const fields = await db.execute(
      sql`SELECT DISTINCT field_name FROM field_sources WHERE table_name = ${table}`
    );

    for (const { field_name: field } of fields.rows as Array<{ field_name: string }>) {
      const column = columns.has(field)
        ? field
        : columns.has(toSnake(field))
          ? toSnake(field)
          : null;
      // A field_name with no matching column is a DIFFERENT defect (provenance
      // for a field the table does not have). Not touched here — deleting it
      // would be a judgement this change has not made. The invariant reports
      // it separately so it cannot hide inside a zero.
      if (!column) continue;

      // The identity columns (slug, status) live on `ipos`, NOT on every parent
      // table — `ipo_details` has neither. So the parent table is joined for
      // the null test and `ipos` separately for the identity. The first version
      // of this query read `slug` off the parent and died with
      // `column i.slug does not exist` the moment it reached `ipo_details`.
      const rows = await db.execute(
        sql`SELECT fs.ipo_id, fs.table_name, fs.row_key, fs.field_name, fs.source, fs.confidence,
                   ipo.slug, ipo.status
              FROM field_sources fs
              JOIN ${sql.identifier(table)} p ON p.id = fs.ipo_id
              JOIN ipos ipo ON ipo.id = fs.ipo_id
             WHERE fs.table_name = ${table} AND fs.field_name = ${field}
               AND p.${sql.identifier(column)} IS NULL
             ORDER BY ipo.status, ipo.slug`
      );
      for (const r of rows.rows as Array<Record<string, unknown>>) {
        out.push({
          ipoId: String(r.ipo_id),
          tableName: String(r.table_name),
          rowKey: (r.row_key as string) ?? '',
          fieldName: String(r.field_name),
          source: String(r.source),
          confidence: r.confidence === null ? null : Number(r.confidence),
          slug: (r.slug as string) ?? null,
          status: (r.status as string) ?? null,
          column,
        });
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  // Refused before anything runs, so a misconfigured apply cannot begin.
  if (APPLY && !EXPECT_DB) {
    console.error('REFUSED: --apply requires --expect-db <name> (#640). No write attempted.');
    process.exit(2);
  }

  const dbInfo = await db.execute(sql`SELECT current_database() AS db, inet_server_port() AS port`);
  const actualDb = String((dbInfo.rows[0] as { db: string }).db);
  console.log(`database: ${actualDb}  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (EXPECT_DB && EXPECT_DB !== actualDb) {
    console.error(`REFUSED: connected to "${actualDb}" but --expect-db said "${EXPECT_DB}". No write attempted.`);
    process.exit(2);
  }

  // The SAME invariant function the nightly floor check and assert-repair-held
  // use, so the repair cannot disagree with its own proof.
  const pool = (db as unknown as { $client: unknown }).$client;
  const before = await provenanceParentNotNullInvariant(pool);
  console.log(`\nBEFORE: ${before.count} provenance row(s) whose parent value is NULL`);
  for (const d of before.details) {
    if (!d.unmapped) console.log(`  ${String(d.rows).padStart(5)}  ${d.table}.${d.column}`);
  }

  const rows = await findRowsToRepair();
  if (rows.length !== before.count) {
    // Two independent computations of one population must agree; if they do
    // not, one is wrong and neither is safe to delete on.
    console.error(
      `REFUSED: the invariant counted ${before.count} rows but the delete plan found ${rows.length}. Not deleting on a disagreement.`
    );
    process.exit(2);
  }

  // The identities, never just a count (signal-ownership.md R1).
  console.log(`\nPLAN (${rows.length} row(s), first 20 shown):`);
  for (const r of rows.slice(0, 20)) {
    console.log(
      `  ${(r.status ?? '?').padEnd(9)} ${r.slug ?? '(no slug)'} — ${r.tableName}.${r.fieldName} (source ${r.source}, confidence ${r.confidence})`
    );
  }
  if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply --expect-db ${actualDb} to delete these rows.`);
    process.exit(0);
  }

  const repo = new FieldSourcesRepository(db as never, getRedisClient() as never);

  let deleted = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const ok = await repo.delete(r.ipoId, r.tableName, r.fieldName, r.rowKey);
      if (ok) deleted++;
      else console.error(`  no-op: ${r.slug} ${r.tableName}.${r.fieldName} — nothing matched`);
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${r.slug} ${r.tableName}.${r.fieldName} — ${(err as Error).message}`);
    }
  }

  const after = await provenanceParentNotNullInvariant(pool);
  console.log(`\nDELETED ${deleted} row(s); ${failed} failure(s)`);
  console.log(`AFTER: ${after.count} provenance row(s) whose parent value is NULL`);
  for (const d of after.details) {
    if (!d.unmapped) console.log(`  ${String(d.rows).padStart(5)}  ${d.table}.${d.column}`);
  }

  if (failed > 0 || after.count !== 0) {
    console.error(
      `\nFAILED: ${failed} delete failure(s), ${after.count} row(s) remaining. Re-run — this tool is idempotent.`
    );
    process.exit(1);
  }
  console.log(`\nOK: ${before.count} -> 0`);
  process.exit(0);
}

void main();
