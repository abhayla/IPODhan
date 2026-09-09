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

/** Pure decision: does this row need writing? Extracted for unit testing without a DB. */
export function needsRepair(row: { currentNormalizedName: string | null; nameValue: string }): {
  write: boolean;
  recomputed: string;
} {
  const recomputed = normalizeCompanyNameForMatching(row.nameValue);
  return { write: (row.currentNormalizedName ?? '') !== recomputed, recomputed };
}

interface TableResult {
  tableName: string;
  totalRows: number;
  changed: number;
  changedIds: string[];
}

async function backfillTable(spec: TableSpec, apply: boolean): Promise<TableResult> {
  const rows = (await db
    .select()
    .from(spec.table as never)) as unknown as Array<Record<string, unknown>>;

  const toWrite: RowToRepair[] = [];
  for (const row of rows) {
    const nameValue = String(row[spec.nameColumn] ?? '');
    const currentNormalizedName = (row.normalizedName as string | null) ?? '';
    const { write, recomputed } = needsRepair({ currentNormalizedName, nameValue });
    if (write) {
      toWrite.push({
        id: row.id as string,
        currentNormalizedName,
        recomputedNormalizedName: recomputed,
      });
    }
  }

  if (apply && toWrite.length > 0) {
    await db.transaction(async (tx) => {
      for (const r of toWrite) {
        await tx
          .update(spec.table as never)
          .set({ normalizedName: r.recomputedNormalizedName } as never)
          .where(eq((spec.table as never as { id: unknown }).id as never, r.id as never));
      }
    });
  }

  return {
    tableName: spec.tableName,
    totalRows: rows.length,
    changed: toWrite.length,
    changedIds: toWrite.map((r) => r.id),
  };
}

async function main(): Promise<void> {
  await openRepairDb(db as never, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'backfill-normalized-name',
  });

  const results: TableResult[] = [];
  for (const spec of TABLE_SPECS) {
    const result = await backfillTable(spec, APPLY);
    results.push(result);
  }

  console.log(`\nbackfill-normalized-name — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  console.log('table               total_rows  would_change');
  for (const r of results) {
    console.log(
      `${r.tableName.padEnd(19)} ${String(r.totalRows).padEnd(11)} ${r.changed}`
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
