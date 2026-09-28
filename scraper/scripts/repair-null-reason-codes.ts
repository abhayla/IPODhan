/**
 * A1 fix round 2 (#1108, RCA corrected 2026-09-28 on `ipodhan_staging`):
 * repairs `ipo_field_plan` rows in two classes, neither of them "missing
 * values" the admin queue should ever see.
 *
 * CLASS (a) — RANK-LESS PHANTOM ROWS. Every `ipo_field_plan` row whose
 * `rank1_source`, `rank2_source` AND `rank3_source` are all NULL or 'NONE',
 * in ANY state. These are pre-#865 (commit 956bd761d) plan rows for a field
 * the manifest ranks NO source for on that IPO's type (e.g.
 * `current_price_nse` for a BSE-only SME) — `generateFieldPlan` has never
 * planned such a row since #865 (`ranks.length === 0 -> continue`), and
 * `field-plan-walk.ts`'s walk-time guard (this same fix round) now releases
 * the claim unrecorded instead of writing EXHAUSTED for one. A row still on
 * disk in this shape is not a fact about the field; it is stale scaffolding.
 * #865's own repair (`repair-retire-manifest-removed-fields.ts`) only
 * catches a field the CURRENT manifest dropped entirely — a field the
 * manifest still carries, but never ranks for THIS IPO's type, is a
 * different, narrower key (ipo_id, table, field) that tool's `(table,
 * field)`-wide scan cannot see. Per #865: "the honest repair is deletion".
 * DELETED here (snapshot-then-delete, in transaction, ledgered before any
 * write — same approach as `repair-retire-manifest-removed-fields.ts`,
 * reused conceptually rather than by import: that tool's delete path is
 * keyed by `(table_name, field_name)` pairs missing from the whole
 * manifest, read once per run; this repair's rank-less filter is a
 * per-row predicate with no such batching, so extending it would have
 * meant bolting a second, differently-shaped query onto a tool whose
 * contract is "manifest-wide field removal" — a worse fit than this
 * tool, whose contract is already "repair a plan row with a bad/missing
 * reason_code").
 *
 * CLASS (b) — UNCODED TERMINAL NO-VALUE ROWS (the tool's original scope,
 * A1/OD-62/OD-77, #1108): every row with `state IN ('NOT_AVAILABLE_YET',
 * 'CHECK_FAILED', 'EXHAUSTED') AND reason_code IS NULL`, EXCLUDING rank-less
 * rows (class (a) already deletes those). An `EXHAUSTED` row here has AT
 * LEAST ONE ranked source, so the pre-fix all-`NOT_PRINTED` fallthrough
 * applies: mapped to `NOT_SOURCED`. Any other no-value state found with a
 * null code (none are expected — `NOT_AVAILABLE_YET`/`CHECK_FAILED` already
 * always write a code) maps to `UNCLASSIFIED`, never a guessed specific code.
 *
 * Renamed from `backfill-exhausted-reason-code.ts` (#1108 fix round 1) because
 * its purpose widened from "backfill a code" to "repair the row" (delete or
 * code). `decideBackfill`/`NO_VALUE_STATES`/`formatDecision`/`parseArgs` keep
 * their names for the smallest diff on the still-valid original test file
 * (`tests/unit/scripts/repair-null-reason-codes.test.ts`).
 *
 *     npx tsx scripts/repair-null-reason-codes.ts --expect-db <name> [--apply]
 *
 * Dry run by default; `--apply` writes ALL of class (a)'s deletes and class
 * (b)'s updates inside ONE database transaction, ledgered (snapshot + before/
 * after) BEFORE the first write in that transaction. Refused against
 * production unless `--allow-prod` is also given (`lib/repair-tool.ts`).
 * `--expect-db <name>` is MANDATORY. A readback after `--apply` asserts 0
 * rank-less rows and 0 null-coded terminal rows remain.
 */
// Item 1 slice s14 -- FIRST import on purpose (see lib/repair-tool.ts).
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
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

/** A rank column with nothing ranked at it — the schema stores NULL; 'NONE' is guarded defensively (class def, never observed). */
function isEmptyRank(v: string | null): boolean {
  return v === null || v === 'NONE';
}

export interface PlanRankRow {
  id: string;
  ipoId: string;
  ipoSlug: string | null;
  ipoName: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  state: string;
  reasonCode: string | null;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
}

export type UncodedPlanRow = Omit<PlanRankRow, 'rank1Source' | 'rank2Source' | 'rank3Source'>;

/** Class (a): no source ranked at all, in ANY state — pure predicate, unit tested without a database. */
export function isRanklessRow(row: Pick<PlanRankRow, 'rank1Source' | 'rank2Source' | 'rank3Source'>): boolean {
  return isEmptyRank(row.rank1Source) && isEmptyRank(row.rank2Source) && isEmptyRank(row.rank3Source);
}

export interface BackfillDecision {
  row: UncodedPlanRow;
  reasonCode: string;
  cause: string;
}

/**
 * Pure on purpose (defect-fix-contract.md item 3): unit-tested without a
 * database. Only ever called on a row that already passed `!isRanklessRow`
 * (class (a) is deleted, not classified) — an EXHAUSTED row here has at
 * least one ranked source, so the RCA class (NOT_SOURCED) applies; any other
 * no-value state maps to UNCLASSIFIED rather than a guessed specific code.
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

/** One printable identity line per rank-less row slated for deletion. */
export function formatRanklessLine(row: PlanRankRow): string {
  const who = row.ipoSlug ?? row.ipoName ?? row.ipoId;
  return `RANKLESS ${row.state} ${who} :: ${row.tableName}.${row.fieldName}${row.rowKey ? `[${row.rowKey}]` : ''} -> DELETE`;
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

const TOOL = 'repair-null-reason-codes';
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

/** Snapshot the exact rank-less rows about to be deleted, by id, inside the transaction that deletes them. */
async function snapshotRanklessByIds(dbx: ExecuteLike, ids: readonly string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const res = await dbx.execute(
    sql`SELECT row_to_json(t) AS j FROM ipo_field_plan t WHERE id = ANY(${sql.param([...ids])}::uuid[])`
  );
  const rows = (res as unknown as { rows: { j: Record<string, unknown> }[] }).rows ?? [];
  return rows.map((r) => r.j);
}

/** DELETE ... WHERE id = ANY(<the exact ids just snapshotted>) — never a re-derived predicate. */
async function deleteByIds(dbx: ExecuteLike, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const res = await dbx.execute(
    sql`DELETE FROM ipo_field_plan WHERE id = ANY(${sql.param([...ids])}::uuid[]) RETURNING id`
  );
  const rows = (res as unknown as { rows: { id: string }[] }).rows ?? [];
  return rows.map((r) => r.id);
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

  // Class (a) candidates: EVERY plan row with no ranked source, any state.
  const ranklessRows = (await (db as any)
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
      rank1Source: schema.ipoFieldPlan.rank1Source,
      rank2Source: schema.ipoFieldPlan.rank2Source,
      rank3Source: schema.ipoFieldPlan.rank3Source,
    })
    .from(schema.ipoFieldPlan)
    .leftJoin(schema.ipos, eq(schema.ipos.id, schema.ipoFieldPlan.ipoId))
    .where(
      and(
        or(isNull(schema.ipoFieldPlan.rank1Source), eq(schema.ipoFieldPlan.rank1Source, 'NONE')),
        or(isNull(schema.ipoFieldPlan.rank2Source), eq(schema.ipoFieldPlan.rank2Source, 'NONE')),
        or(isNull(schema.ipoFieldPlan.rank3Source), eq(schema.ipoFieldPlan.rank3Source, 'NONE'))
      )
    )) as PlanRankRow[];

  // Class (b) candidates: uncoded no-value rows, MINUS whatever class (a) already claims.
  const ranklessIdSet = new Set(ranklessRows.map((r) => r.id));
  const uncodedAll = (await (db as any)
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
    .where(and(inArray(schema.ipoFieldPlan.state, NO_VALUE_STATES as unknown as any[]), isNull(schema.ipoFieldPlan.reasonCode)))) as UncodedPlanRow[];
  const uncoded = uncodedAll.filter((r) => !ranklessIdSet.has(r.id));

  const decisions = uncoded.map(decideBackfill);

  console.log(`\n${TOOL}: class (a) rank-less phantom rows in "${actual}":`);
  for (const r of ranklessRows) console.log(formatRanklessLine(r));
  console.log(`${TOOL}: ${ranklessRows.length} rank-less row(s) to DELETE.`);

  console.log(`\n${TOOL}: class (b) uncoded no-value rows (excluding rank-less) in "${actual}":`);
  for (const d of decisions) console.log(formatDecision(d));

  const byBucket = new Map<string, number>();
  for (const d of decisions) {
    const key = `${d.row.state}|${d.row.tableName}|${d.row.fieldName}`;
    byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
  }
  console.log(`\n${TOOL}: counts per (state, table, field) in "${actual}":`);
  for (const [key, count] of [...byBucket.entries()].sort()) {
    console.log(`  ${key} :: ${count}`);
  }
  console.log(`${TOOL}: ${decisions.length} uncoded no-value plan row(s) to CODE.`);

  if (!cli.apply) {
    const ledger = {
      tool: TOOL,
      mode: 'dry-run' as const,
      generatedAt: new Date().toISOString(),
      changes: [
        ...ranklessRows.map((r) => ({ table: 'ipo_field_plan', rowKey: r.id, field: '(row)', before: r as unknown, after: null })),
        ...decisions.map((d) => ({ table: 'ipo_field_plan', rowKey: d.row.id, field: 'reason_code', before: null, after: d.reasonCode })),
      ],
      database: actual,
      apply: false,
      at: new Date().toISOString(),
      ranklessDeletes: ranklessRows.length,
      codedBackfills: decisions.length,
    };
    const ledgerPath = writeLedgerFile(path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-dryrun-${Date.now()}.json`), ledger);
    console.log(`${TOOL}: ledger written to ${ledgerPath}`);
    console.log(
      `${TOOL}: DRY RUN — nothing was written. Re-run with --apply to delete ${ranklessRows.length} rank-less row(s) and code ${decisions.length} row(s).`
    );
    return;
  }

  if (ranklessRows.length === 0 && decisions.length === 0) {
    console.log(`${TOOL}: nothing to repair.`);
    return;
  }

  // Item 3: ONE transaction around every write; snapshot/ledger written BEFORE the first write.
  const realDb = db as unknown as { transaction: <T>(fn: (tx: ExecuteLike) => Promise<T>) => Promise<T> };
  let ledgerPath = '';
  const applyResult = await realDb.transaction(async (tx) => {
    const snapshot = await snapshotRanklessByIds(tx, ranklessRows.map((r) => r.id));
    ledgerPath = writeLedgerFile(path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-applied-${Date.now()}.json`), {
      tool: TOOL,
      mode: 'apply' as const,
      generatedAt: new Date().toISOString(),
      changes: [
        ...snapshot.map((row) => ({
          table: 'ipo_field_plan',
          rowKey: String((row as Record<string, unknown>).id ?? ''),
          field: '(row)',
          before: row,
          after: null,
        })),
        ...decisions.map((d) => ({ table: 'ipo_field_plan', rowKey: d.row.id, field: 'reason_code', before: null, after: d.reasonCode })),
      ],
      database: actual,
      apply: true,
      at: new Date().toISOString(),
      ranklessRows: snapshot,
    });
    const deletedIds = await deleteByIds(tx, snapshot.map((row) => String((row as Record<string, unknown>).id)));
    const { writtenIds, changes } = await backfillReasonCodes(tx, decisions);
    return { deletedIds, writtenIds, changes };
  });
  console.log(`\n${TOOL}: before-image + change ledger written to ${ledgerPath} (transaction committed)`);
  console.log(`${TOOL}: deleted ${applyResult.deletedIds.length} rank-less row(s).`);
  console.log(
    `${TOOL}: backfilled ${applyResult.writtenIds.length} of ${decisions.length} plan row(s) (a row changed since the read is left alone).`
  );

  // Readback (outside the transaction, now committed): both targeted classes must be 0.
  const [{ ranklessRemaining }] = (await (db as any)
    .select({ ranklessRemaining: sql<number>`count(*)::int` })
    .from(schema.ipoFieldPlan)
    .where(
      and(
        or(isNull(schema.ipoFieldPlan.rank1Source), eq(schema.ipoFieldPlan.rank1Source, 'NONE')),
        or(isNull(schema.ipoFieldPlan.rank2Source), eq(schema.ipoFieldPlan.rank2Source, 'NONE')),
        or(isNull(schema.ipoFieldPlan.rank3Source), eq(schema.ipoFieldPlan.rank3Source, 'NONE'))
      )
    )) as Array<{ ranklessRemaining: number }>;
  const [{ uncodedRemaining }] = (await (db as any)
    .select({ uncodedRemaining: sql<number>`count(*)::int` })
    .from(schema.ipoFieldPlan)
    .where(and(inArray(schema.ipoFieldPlan.state, NO_VALUE_STATES as unknown as any[]), isNull(schema.ipoFieldPlan.reasonCode)))) as Array<{
    uncodedRemaining: number;
  }>;
  console.log(`${TOOL}: readback — ${ranklessRemaining} rank-less row(s) remain, ${uncodedRemaining} null-coded terminal row(s) remain.`);
  if (ranklessRemaining > 0 || uncodedRemaining > 0) {
    console.error(`${TOOL}: readback found rows still uncoded/rank-less after apply — investigate before trusting this run.`);
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
