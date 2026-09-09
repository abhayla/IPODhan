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
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { openRepairDb, writeLedgerFile } from './lib/repair-tool.js';

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
  currentNormalizedName: string;
  recomputedNormalizedName: string;
}

/**
 * Prefix for the fallback key minted when a row's own name normalises to the
 * empty string (junk/null/whitespace-only source name). This can never
 * collide with a real `normalizeCompanyNameForMatching` output — that
 * function only ever emits lowercase letters/digits/spaces — so it is safe
 * under the future `UNIQUE (ipo_id, normalized_name)` constraint (slice s2)
 * even when two such junk rows share one IPO.
 */
export const EMPTY_NORMALIZATION_PREFIX = '__empty__:';

/** Pure decision: does this row need writing? Extracted for unit testing without a DB.
 *
 * Finding 6 (Tier A fix round): a row whose name normalises to the empty
 * string used to keep the `''` column-default sentinel forever — `write`
 * came back `false` because the stored value already equalled the
 * recomputed value. Two such rows under one IPO would then collide on the
 * slice-s2 `UNIQUE (ipo_id, normalized_name)` constraint. Decision: derive a
 * stable, per-row, non-empty fallback key (`__empty__:<id>`) instead of
 * silently leaving `''` — the row's own id is already unique, so the
 * fallback key is guaranteed unique too, and it is loudly distinguishable
 * from a real match key (`emptyNormalization: true` on the result, counted
 * and printed as its own category — see `main()`).
 */
export function needsRepair(row: { currentNormalizedName: string | null; nameValue: string; id: string }): {
  write: boolean;
  recomputed: string;
  emptyNormalization: boolean;
} {
  const rawRecomputed = normalizeCompanyNameForMatching(row.nameValue);
  const emptyNormalization = rawRecomputed === '';
  const recomputed = emptyNormalization ? `${EMPTY_NORMALIZATION_PREFIX}${row.id}` : rawRecomputed;
  const current = row.currentNormalizedName ?? '';
  return { write: current !== recomputed, recomputed, emptyNormalization };
}

interface TableResult {
  tableName: string;
  totalRows: number;
  changed: number;
  changedIds: string[];
  emptyNormalizationCount: number;
}

interface TablePlan {
  spec: TableSpec;
  toWrite: RowToRepair[];
  totalRows: number;
  emptyNormalizationCount: number;
}

async function planTable(spec: TableSpec): Promise<TablePlan> {
  const rows = (await db
    .select()
    .from(spec.table as never)) as unknown as Array<Record<string, unknown>>;

  const toWrite: RowToRepair[] = [];
  let emptyNormalizationCount = 0;
  for (const row of rows) {
    const nameValue = String(row[spec.nameColumn] ?? '');
    const currentNormalizedName = (row.normalizedName as string | null) ?? '';
    const id = row.id as string;
    const { write, recomputed, emptyNormalization } = needsRepair({
      currentNormalizedName,
      nameValue,
      id,
    });
    if (emptyNormalization) emptyNormalizationCount += 1;
    if (write) {
      toWrite.push({
        id,
        currentNormalizedName,
        recomputedNormalizedName: recomputed,
      });
    }
  }

  return { spec, toWrite, totalRows: rows.length, emptyNormalizationCount };
}

function toResult(plan: TablePlan): TableResult {
  return {
    tableName: plan.spec.tableName,
    totalRows: plan.totalRows,
    changed: plan.toWrite.length,
    changedIds: plan.toWrite.map((r) => r.id),
    emptyNormalizationCount: plan.emptyNormalizationCount,
  };
}

/**
 * Finding 6 (Tier A fix round): the backfill previously ran one transaction
 * PER TABLE, so a failure on `ipo_intermediaries` could leave `promoters`
 * and `peer_companies` repaired and the third table not — a partial
 * backfill. All three tables now write inside ONE transaction: either every
 * table's rows are repaired or none are.
 */
async function backfillAllTables(specs: TableSpec[], apply: boolean): Promise<TableResult[]> {
  const plans = await Promise.all(specs.map((spec) => planTable(spec)));

  if (apply) {
    const plansToWrite = plans.filter((p) => p.toWrite.length > 0);
    if (plansToWrite.length > 0) {
      await db.transaction(async (tx) => {
        for (const plan of plansToWrite) {
          for (const r of plan.toWrite) {
            await tx
              .update(plan.spec.table as never)
              .set({ normalizedName: r.recomputedNormalizedName } as never)
              .where(
                eq((plan.spec.table as never as { id: unknown }).id as never, r.id as never)
              );
          }
        }
      });
    }
  }

  return plans.map(toResult);
}

async function main(): Promise<void> {
  await openRepairDb(db as never, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'backfill-normalized-name',
  });

  const results = await backfillAllTables(TABLE_SPECS, APPLY);

  console.log(`\nbackfill-normalized-name — ${APPLY ? 'APPLY' : 'DRY RUN'} (single transaction)\n`);
  console.log('table               total_rows  would_change  empty_normalization');
  for (const r of results) {
    console.log(
      `${r.tableName.padEnd(19)} ${String(r.totalRows).padEnd(11)} ${String(r.changed).padEnd(13)} ${r.emptyNormalizationCount}`
    );
  }
  const totalEmpty = results.reduce((sum, r) => sum + r.emptyNormalizationCount, 0);
  if (totalEmpty > 0) {
    console.log(
      `\n${totalEmpty} row(s) whose name normalises to '' were assigned a stable fallback key ` +
        `(${EMPTY_NORMALIZATION_PREFIX}<id>) instead of the '' sentinel — see emptyNormalizationCount per table above.`
    );
  }
  console.log('');

  const ledgerPath = writeLedgerFile(
    `scripts/state/backfill-normalized-name-${APPLY ? 'apply' : 'dry-run'}-${Date.now()}.json`,
    {
      apply: APPLY,
      allowProd: ALLOW_PROD,
      ranAt: new Date().toISOString(),
      results: results.map((r) => ({
        tableName: r.tableName,
        totalRows: r.totalRows,
        changed: r.changed,
        changedIds: r.changedIds,
        emptyNormalizationCount: r.emptyNormalizationCount,
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
