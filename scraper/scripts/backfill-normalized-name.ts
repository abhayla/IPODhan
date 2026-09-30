/**
 * Backfill: `normalized_name` on `promoters`, `peer_companies` and
 * `ipo_intermediaries` — item 1 slice s1 (row-key prep, F-74).
 *
 * WHY: `docs/design/build-cards/item-01-child-table-consolidated-writer.md`
 * (Schema table) names the future `field_sources`/`data_conflicts` row key
 * for these three tables as the normalised company name (`role:normalizedName`
 * for `ipo_intermediaries`). Measured 2026-09-09 by
 * `docs/design/probes/duplicate-scan.mjs`: none of the three tables carries
 * that column at all (27 promoters, 326 peer_companies, 178 ipo_intermediaries
 * rows on production, per the decision-4 finding this slice implements).
 * This script recomputes `normalized_name` for every EXISTING row from the
 * row's own name column, using the SAME normaliser
 * (`normalizeCompanyNameForMatching`, packages/shared/src/utils/
 * company-name-normalizer.ts) the write paths now populate at insert time
 * (scraper/src/services/filing-persister.ts) — one normaliser, not a second
 * one invented for the backfill.
 *
 * Class: every row in all three tables, on every slot, regardless of IPO
 * status or segment — not a slug-scoped or segment-scoped subset.
 *
 * Usage (from scraper/, tunnel env exported per docs/ops/prod-ops-recipes.md §1):
 *   npx tsx scripts/backfill-normalized-name.ts                    # dry run
 *   npx tsx scripts/backfill-normalized-name.ts --apply             # write
 *   npx tsx scripts/backfill-normalized-name.ts --apply --allow-prod   (DATABASE_NAME=ipodhan)
 *
 * Idempotent: a row whose stored `normalized_name` already equals the
 * recomputed value is not touched (0 on a clean re-run, per the
 * repair-tool-module pattern's per-field idempotency intent — here per-row,
 * since there is exactly one column to repair per row).
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { lockAndReadListOwnership } from '@ipodhan/shared/services/admin-list-hold';
import { openRepairDb, writeLedgerFile } from './lib/repair-tool.js';

/** A minimal query surface both `db` and a `db.transaction` callback's `tx`
 * satisfy — the reads in `planTable` run against whichever is passed in, so
 * they can be moved inside the SAME transaction that later writes (Finding,
 * Tier A fix round: the reads previously ran via `Promise.all` BEFORE the
 * transaction opened, so a row a live scraper cycle inserted between the
 * plan and the write was silently missed while the ledger still reported
 * full coverage). */
type Queryable = { select: typeof db.select };

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');

interface TableSpec {
  tableName: 'promoters' | 'peer_companies' | 'ipo_intermediaries';
  table: typeof schema.promoters | typeof schema.peerCompanies | typeof schema.ipoIntermediaries;
  nameColumn: 'name' | 'companyName';
}

const TABLE_SPECS: TableSpec[] = [
  { tableName: 'promoters', table: schema.promoters, nameColumn: 'name' },
  { tableName: 'peer_companies', table: schema.peerCompanies, nameColumn: 'companyName' },
  { tableName: 'ipo_intermediaries', table: schema.ipoIntermediaries, nameColumn: 'name' },
];

export interface RowToRepair {
  id: string;
  ipoId: string;
  currentNormalizedName: string;
  recomputedNormalizedName: string;
}

/** Pure decision: does this row need writing? Extracted for unit testing without a DB.
 *
 * Tier A round-2 finding (2026-09-09): `rowKeyForName` is the SAME function
 * the four write paths now use — the backfill's `__empty__:<row id>` scheme
 * is gone entirely. A row whose key comes back `null` (name is null, empty,
 * or whitespace-only) carries no identity: it is NOT written with an
 * invented key, and it is NOT silently absent from the report — `nullKey:
 * true` on the result puts it in its own counted, clearly-labelled category
 * for a human to resolve (see `main()`).
 */
export function needsRepair(row: { currentNormalizedName: string | null; nameValue: string; id: string }): {
  write: boolean;
  recomputed: string | null;
  nullKey: boolean;
} {
  const key = rowKeyForName(row.nameValue);
  if (key === null) {
    return { write: false, recomputed: null, nullKey: true };
  }
  const current = row.currentNormalizedName ?? '';
  return { write: current !== key, recomputed: key, nullKey: false };
}

interface TableResult {
  tableName: string;
  totalRows: number;
  changed: number;
  changedIds: string[];
  /** #457: the per-row before/after that made the ledger a rollback artifact. */
  toWrite: RowToRepair[];
  skippedHeld: number;
  nullKeyCount: number;
  nullKeyIds: string[];
}

interface TablePlan {
  /** Rows left alone because their IPO's list is admin-owned (#1294 item 5). */
  skippedHeld: number;
  spec: TableSpec;
  toWrite: RowToRepair[];
  totalRows: number;
  nullKeyCount: number;
  nullKeyIds: string[];
}

async function planTable(queryable: Queryable, spec: TableSpec): Promise<TablePlan> {
  const rows = (await queryable
    .select()
    .from(spec.table as never)) as unknown as Array<Record<string, unknown>>;

  const toWrite: RowToRepair[] = [];
  let nullKeyCount = 0;
  const nullKeyIds: string[] = [];
  for (const row of rows) {
    const nameValue = String(row[spec.nameColumn] ?? '');
    const currentNormalizedName = (row.normalizedName as string | null) ?? '';
    const id = row.id as string;
    const { write, recomputed, nullKey } = needsRepair({
      currentNormalizedName,
      nameValue,
      id,
    });
    if (nullKey) {
      nullKeyCount += 1;
      nullKeyIds.push(id);
      continue;
    }
    if (write && recomputed !== null) {
      toWrite.push({
        id,
        ipoId: row.ipoId as string,
        currentNormalizedName,
        recomputedNormalizedName: recomputed,
      });
    }
  }

  return { spec, toWrite, totalRows: rows.length, nullKeyCount, nullKeyIds, skippedHeld: 0 };
}

function toResult(plan: TablePlan): TableResult {
  return {
    tableName: plan.spec.tableName,
    totalRows: plan.totalRows,
    changed: plan.toWrite.length,
    changedIds: plan.toWrite.map((r) => r.id),
    toWrite: plan.toWrite,
    skippedHeld: plan.skippedHeld,
    nullKeyCount: plan.nullKeyCount,
    nullKeyIds: plan.nullKeyIds,
  };
}

/**
 * Finding 6 (Tier A fix round): the backfill previously ran one transaction
 * PER TABLE, so a failure on `ipo_intermediaries` could leave `promoters`
 * and `peer_companies` repaired and the third table not — a partial
 * backfill. All three tables now write inside ONE transaction: either every
 * table's rows are repaired or none are.
 *
 * Tier A round-2 MINOR finding: the reads that PLAN the repair now run
 * INSIDE that same transaction (via `tx`, not the top-level `db`), which
 * narrows — but does NOT close — the window between planning and writing.
 * This transaction runs at the default READ COMMITTED isolation level, so a
 * row a live scraper cycle inserts (and commits) after this transaction's
 * SELECT snapshot but before it commits is still invisible to the plan and
 * is not repaired in this pass; the ledger's "full coverage" claim covers
 * only rows visible at plan time. Closing that window would require
 * REPEATABLE READ or SERIALIZABLE, which trades this gap for a new failure
 * mode (serialization aborts under concurrent writers) that this backfill
 * does not currently handle — not adopted here. The next scheduled backfill
 * run picks up any row missed this way.
 */
/**
 * Write one key repair unless the IPO's list is admin-owned. `normalized_name` is part of the row key
 * the list version token is built from, so rewriting it under an admin's open editor makes the admin's
 * save a false CONFLICT; and an admin-owned list is never changed by a scraper-side tool (OD-107). The
 * hold is read under the IPO row lock `writeAdminListChange` takes (#1294 item 5).
 */
export async function writeNormalizedNameUnlessHeld(
  tx: { execute: unknown; update: typeof db.update },
  tableName: TableSpec['tableName'],
  table: TableSpec['table'],
  row: RowToRepair
): Promise<'written' | 'held'> {
  if ((await lockAndReadListOwnership(tx as never, row.ipoId, tableName)).owned) return 'held';
  await tx
    .update(table as never)
    .set({ normalizedName: row.recomputedNormalizedName } as never)
    .where(eq((table as never as { id: unknown }).id as never, row.id as never));
  return 'written';
}

async function backfillAllTables(specs: TableSpec[], apply: boolean): Promise<TableResult[]> {
  return db.transaction(async (tx) => {
    const plans = await Promise.all(specs.map((spec) => planTable(tx as unknown as Queryable, spec)));

    if (apply) {
      const plansToWrite = plans.filter((p) => p.toWrite.length > 0);
      for (const plan of plansToWrite) {
        const written: RowToRepair[] = [];
        for (const r of plan.toWrite) {
          const outcome = await writeNormalizedNameUnlessHeld(tx as never, plan.spec.tableName, plan.spec.table, r);
          if (outcome === 'written') written.push(r);
          else plan.skippedHeld += 1;
        }
        plan.toWrite = written;
      }
    }

    return plans.map(toResult);
  });
}

async function main(): Promise<void> {
  await openRepairDb(db as never, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'backfill-normalized-name',
  });

  const results = await backfillAllTables(TABLE_SPECS, APPLY);

  console.log(`\nbackfill-normalized-name — ${APPLY ? 'APPLY' : 'DRY RUN'} (single transaction)\n`);
  console.log('table               total_rows  would_change  null_key (unresolved)');
  for (const r of results) {
    console.log(
      `${r.tableName.padEnd(19)} ${String(r.totalRows).padEnd(11)} ${String(r.changed).padEnd(13)} ${r.nullKeyCount}`
    );
  }
  const totalHeld = results.reduce((sum, r) => sum + r.skippedHeld, 0);
  if (totalHeld > 0) console.log(`
left alone (admin-owned list, OD-107): ${totalHeld} row(s)`);
  const totalNullKey = results.reduce((sum, r) => sum + r.nullKeyCount, 0);
  if (totalNullKey > 0) {
    console.log(
      `\n${totalNullKey} row(s) whose name has no identity (null/empty/whitespace-only) were LEFT ` +
        `UNTOUCHED and NOT assigned an invented key — for a human to resolve. See nullKeyCount / ` +
        `nullKeyIds per table above and in the ledger.`
    );
  }
  console.log('');

  const ledgerPath = writeLedgerFile(
    `scripts/state/backfill-normalized-name-${APPLY ? 'apply' : 'dry-run'}-${Date.now()}.json`,
    {
      tool: 'backfill-normalized-name',
      mode: APPLY ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      // #457: before this fix this ledger held only `changedIds` — a list of
      // rows touched, not a rollback artifact. Every plan carries the row's
      // prior `normalizedName` (`currentNormalizedName`), so the ledger can
      // now record before/after per row.
      changes: results.flatMap((r) =>
        r.toWrite.map((row) => ({
          table: r.tableName,
          rowKey: row.id,
          field: 'normalizedName',
          before: row.currentNormalizedName,
          after: row.recomputedNormalizedName,
        }))
      ),
      apply: APPLY,
      allowProd: ALLOW_PROD,
      ranAt: new Date().toISOString(),
      results: results.map((r) => ({
        tableName: r.tableName,
        skippedHeld: r.skippedHeld,
        totalRows: r.totalRows,
        changed: r.changed,
        changedIds: r.changedIds,
        nullKeyCount: r.nullKeyCount,
        nullKeyIds: r.nullKeyIds,
      })),
    }
  );
  console.log(`ledger written: ${ledgerPath}`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
      console.error(
        `[backfill-normalized-name] failed: ${err instanceof Error ? err.message : String(err)}`,
        cause ? `cause: ${cause}` : ''
      );
      process.exit(1);
    });
}
