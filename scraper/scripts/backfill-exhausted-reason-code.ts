/**
 * Backfill `reason_code`/`cause` for `ipo_field_plan` rows that landed in a
 * terminal no-value state with `reason_code IS NULL` (A1, OD-62/OD-77,
 * #1108).
 *
 * RCA (measured on `ipodhan_staging` 2026-09-28): every `NOT_AVAILABLE_YET`
 * and `CHECK_FAILED` plan row already carries a code; the only uncoded rows
 * are `EXHAUSTED` — the all-`NOT_PRINTED` fallthrough in
 * `field-plan-walk.ts`'s `classifyFailure([])` returned `null` before this
 * fix, because an empty `failures[]` (every rank answered NOT_PRINTED, which
 * pushes nothing) has no cause to classify. `field-plan-walk.ts` now writes
 * `NOT_SOURCED` going forward; this tool repairs the rows it already wrote
 * `NULL` for.
 *
 *     npx tsx scripts/backfill-exhausted-reason-code.ts --expect-db <name> [--apply]
 *
 * SCOPE IS COMPUTED, NEVER TYPED (defect-fix-contract.md item 4): every row
 * with `state IN ('NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED') AND
 * reason_code IS NULL`, on this database, not a hand-typed IPO/field list.
 * For an `EXHAUSTED` row this is exactly the RCA class above, so it is
 * mapped to `NOT_SOURCED` with a cause naming the mechanism. Any other
 * no-value state found with a null code (none are expected by the RCA, but
 * the class is defined by the filter, not by what is known to exist today)
 * is mapped to `UNCLASSIFIED` with a cause saying no code was recorded —
 * never guessed into a more specific code with no evidence.
 *
 * Dry run by default; `--apply` writes (guarded, per row, one UPDATE per
 * row so each gets its own before/after in the ledger), refused against
 * production unless `--allow-prod` is also given (`lib/repair-tool.ts`).
 * `--expect-db <name>` is MANDATORY. A readback after `--apply` asserts 0
 * rows remain in the class this run targeted.
 */
// Item 1 slice s14 -- FIRST import on purpose (see lib/repair-tool.ts).
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openRepairDb,
  queryCurrentDatabase,
  updateRowsReturningChanges,
  writeLedgerFile,
  type ExecuteLike,
  type RepairLedgerFieldChange,
} from './lib/repair-tool';

/** The terminal no-value states a plan row can settle in without SUPPLIED. */
export const NO_VALUE_STATES = ['NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED'] as const;

export interface UncodedPlanRow {
  id: string;
  ipoId: string;
  ipoSlug: string | null;
  ipoName: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  state: string;
  reasonCode: string | null;
}

export interface BackfillDecision {
  row: UncodedPlanRow;
  reasonCode: string;
  cause: string;
}

/**
 * Pure on purpose (defect-fix-contract.md item 3): unit-tested without a
 * database. The RCA class (EXHAUSTED with no code) maps to NOT_SOURCED; any
 * other state this filter could in principle surface maps to UNCLASSIFIED
 * rather than a guessed specific code.
 */
export function decideBackfill(row: UncodedPlanRow): BackfillDecision {
  if (row.state === 'EXHAUSTED') {
    return {
      row,
      reasonCode: 'NOT_SOURCED',
      cause: 'backfill: all ranked sources NOT_PRINTED (pre-A1 fallthrough)',
    };
  }
  return {
    row,
    reasonCode: 'UNCLASSIFIED',
    cause: 'backfill: no code recorded',
  };
}

/** One printable identity line per row — never a bare count (signal-ownership R1). */
export function formatDecision(d: BackfillDecision): string {
  const row = d.row;
  const who = row.ipoSlug ?? row.ipoName ?? row.ipoId;
  return `${row.state} ${who} :: ${row.tableName}.${row.fieldName}${row.rowKey ? `[${row.rowKey}]` : ''} -> ${d.reasonCode}`;
}

interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
}

export function parseArgs(argv: readonly string[]): Cli {
  const at = argv.indexOf('--expect-db');
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    expectDb: at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null,
  };
}

const TOOL = 'backfill-exhausted-reason-code';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every column the backfill UPDATE sets — each ledgered with its true before/after. */
export const BACKFILL_COLUMNS = ['reason_code', 'cause', 'updated_at'] as const;

/**
 * Written only while the row STILL has the shape the read decided on
 * (same state, still `reason_code IS NULL`) — a row that changed since the
 * read (e.g. re-walked and given a real code) is left for the next run.
 */
export async function backfillReasonCodes(
  dbx: ExecuteLike,
  decisions: ReadonlyArray<BackfillDecision>
): Promise<{ writtenIds: string[]; changes: RepairLedgerFieldChange[] }> {
  const writtenIds: string[] = [];
  const changes: RepairLedgerFieldChange[] = [];
  for (const d of decisions) {
    const out = await updateRowsReturningChanges(dbx, {
      table: 'ipo_field_plan',
      ids: [d.row.id],
      guard: sql`state::text = ${d.row.state} AND reason_code IS NULL`,
      set: sql`reason_code = ${d.reasonCode}, cause = ${d.cause}, updated_at = now()`,
      columns: BACKFILL_COLUMNS,
    });
    writtenIds.push(...out.writtenIds);
    changes.push(...out.changes);
  }
  return { writtenIds, changes };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    process.exit(1);
  }

  const actual = await queryCurrentDatabase(db as ExecuteLike);
  console.log(`${TOOL}: connected to "${actual}" (current_database()).`);
  if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
    console.error(`${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    process.exit(1);
  }

  await openRepairDb(db as ExecuteLike, { apply: cli.apply, allowProd: cli.allowProd, toolName: TOOL });

  const rows = await (db as any)
    .select({
      id: schema.ipoFieldPlan.id,
      ipoId: schema.ipoFieldPlan.ipoId,
      ipoSlug: schema.ipos.slug,
      ipoName: schema.ipos.companyName,
      tableName: schema.ipoFieldPlan.tableName,
      rowKey: schema.ipoFieldPlan.rowKey,
      fieldName: schema.ipoFieldPlan.fieldName,
      state: schema.ipoFieldPlan.state,
      reasonCode: schema.ipoFieldPlan.reasonCode,
    })
    .from(schema.ipoFieldPlan)
    .leftJoin(schema.ipos, eq(schema.ipos.id, schema.ipoFieldPlan.ipoId))
    .where(and(inArray(schema.ipoFieldPlan.state, NO_VALUE_STATES as unknown as any[]), isNull(schema.ipoFieldPlan.reasonCode)));

  const decisions = (rows as UncodedPlanRow[]).map(decideBackfill);
  for (const d of decisions) console.log(formatDecision(d));

  // Counts per (state, table, field) — signal-ownership R1: identities above, a summary here.
  const byBucket = new Map<string, number>();
  for (const d of decisions) {
    const key = `${d.row.state}|${d.row.tableName}|${d.row.fieldName}`;
    byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
  }
  console.log(`\n${TOOL}: counts per (state, table, field) in "${actual}":`);
  for (const [key, count] of [...byBucket.entries()].sort()) {
    console.log(`  ${key} :: ${count}`);
  }
  console.log(`${TOOL}: ${decisions.length} uncoded no-value plan rows total in "${actual}".`);

  const written = cli.apply && decisions.length > 0 ? await backfillReasonCodes(db as ExecuteLike, decisions) : null;
  const writtenSet = new Set(written?.writtenIds ?? []);
  const ledger = {
    tool: TOOL,
    mode: (cli.apply ? 'apply' : 'dry-run') as 'apply' | 'dry-run',
    generatedAt: new Date().toISOString(),
    changes: cli.apply
      ? written?.changes ?? []
      : decisions.map((d) => ({ table: 'ipo_field_plan', rowKey: d.row.id, field: 'reason_code', before: null, after: d.reasonCode })),
    database: actual,
    apply: cli.apply,
    at: new Date().toISOString(),
    backfilled: decisions
      .filter((d) => !cli.apply || writtenSet.has(d.row.id))
      .map((d) => ({
        planRowId: d.row.id,
        ipoId: d.row.ipoId,
        ipoSlug: d.row.ipoSlug,
        ipoName: d.row.ipoName,
        tableName: d.row.tableName,
        rowKey: d.row.rowKey,
        fieldName: d.row.fieldName,
        state: d.row.state,
        reasonCode: d.reasonCode,
        cause: d.cause,
      })),
  };
  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    ledger
  );
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);

  if (!cli.apply) {
    console.log(`${TOOL}: DRY RUN — nothing was written. Re-run with --apply to backfill the ${decisions.length} rows listed above.`);
    return;
  }
  if (decisions.length === 0) {
    console.log(`${TOOL}: nothing to backfill.`);
    return;
  }

  console.log(`${TOOL}: backfilled ${writtenSet.size} of ${decisions.length} plan rows (a row changed since the read is left alone).`);

  // Readback: the class this run targeted must be 0 after an apply.
  const [{ remaining }] = (await (db as any)
    .select({ remaining: sql<number>`count(*)::int` })
    .from(schema.ipoFieldPlan)
    .where(
      and(
        inArray(schema.ipoFieldPlan.state, decisions.map((d) => d.row.state) as unknown as any[]),
        isNull(schema.ipoFieldPlan.reasonCode)
      )
    )) as Array<{ remaining: number }>;
  console.log(`${TOOL}: readback — ${remaining} row(s) among the targeted states still have reason_code IS NULL.`);
  if (remaining > 0) {
    console.error(`${TOOL}: readback found ${remaining} row(s) still uncoded after apply — investigate before trusting this run.`);
    process.exit(1);
  }
}

// Only run when invoked directly, so the unit test can import the pure parts.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    console.error(`${TOOL}: ${e?.message ?? e}`);
    process.exit(1);
  });
}
