/**
 * OD-100 (#1022, review round 2): retire `ipo_field_plan` rows whose
 * (table_name, field_name) no longer appears in the current field manifest
 * at all — because the field is now `jobOwned` (MAJOR-1: gmp_records,
 * subscriptions, ipo_demand_graph, and the three listing_performance
 * quote columns the S5 post-listing price job owns; see
 * `docs/design/field-source-resolution.spec.mjs`'s `JOB_OWNED_TABLES` /
 * `JOB_OWNED_FIELDS`, the one declared list this tool never re-derives).
 *
 * WHY THIS EXISTS. `generateFieldPlan` (field-plan-generator.ts) only ever
 * iterates `manifest.fields` — a field the manifest stops carrying simply
 * stops being planned for NEW rows. It says nothing about rows ALREADY
 * written for that field before it left the manifest:
 * `repair-plan-rows-to-manifest-version.ts` only re-ranks/inserts rows for
 * fields the CURRENT manifest still plans, so an orphaned field's rows sit
 * forever, unreconciled by any ordinary cycle.
 *
 * THE CLASS (defect-fix-contract item 2), stated as a data filter, never a
 * table name: every `ipo_field_plan` row whose `(table_name, field_name)`
 * pair is not a key of the CURRENT manifest's `fields` map — whatever table,
 * any state, any IPO, any segment. The tool never hardcodes a pair; it reads
 * the manifest and the table's own distinct keys each run.
 *
 * WHAT --apply DOES (review round 2 MINOR-4, MAJOR-2). Inside ONE database
 * transaction: (1) SELECT a full JSON snapshot (`row_to_json`) of every row
 * whose `(table_name, field_name)` is in the removed set, capturing each
 * row's `id`; (2) the before-image ledger is written to disk from THAT
 * snapshot, before any delete; (3) DELETE ... WHERE id = ANY(<the exact ids
 * just snapshotted>) — never `WHERE table_name = ... AND field_name = ...`,
 * so a row the walk inserts for that key BETWEEN the snapshot and the delete
 * (a race this tool must not lose) is left alone, never deleted unsaved.
 * `--undo <ledger.json>` (review round 2 MINOR-5) refuses unless the
 * ledger's recorded `dbName` equals the CONNECTED database (never trusts the
 * operator to have picked the right ledger for the right box), then
 * re-INSERTs the exact rows inside one transaction
 * (`json_populate_record(null::ipo_field_plan, ...)`), skipping any row
 * whose `id` already exists (idempotent undo).
 *
 * MINOR-3 (review round 2, left as a note, not fixed here): a second
 * `--apply` run started while an earlier one is still writing its ledger
 * could in principle interleave. The before-image ledger is the mitigation —
 * every row this tool ever deletes is recoverable from disk by `--undo`
 * regardless of interleaving, so the residual risk is operational (two
 * operators running --apply at once), not data loss.
 *
 * Dry-run by default; `--expect-db <name>` is MANDATORY (refuses to guess the
 * target database); prod is refused without `--allow-prod` (`openRepairDb`).
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-retire-manifest-removed-fields.ts --expect-db ipodhan_staging
 *   npx tsx scripts/repair-retire-manifest-removed-fields.ts --expect-db ipodhan_staging --apply
 *   npx tsx scripts/repair-retire-manifest-removed-fields.ts --expect-db ipodhan_staging --apply \
 *     --undo scripts/state/repair-retire-manifest-removed-fields-<ts>.json
 *
 * `--ipo <uuid>` (#1045, repeatable or comma-separated) scopes the read/apply
 * to only the named IPO(s) — every row read, ledgered and deleted is filtered
 * by `ipo_id`. Omit it for today's DB-wide default. A test spawning this tool
 * against the shared `ipodhan_test` database MUST pass its own fixture's
 * `--ipo` so it cannot touch another integration file's rows running in
 * parallel (issue #1045).
 *
 * Exit codes: 0 done (or dry run / nothing to repair); 1 usage/guard refusal;
 * 2 an `--ipo` value failed uuid validation, or `--ipo`/`--ipo=` was present
 * but yielded no usable uuid (#1053 review round 2).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { sql, type SQL } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFieldManifest } from '../src/config/field-manifest-loader.js';
import {
  buildIpoScopeCondition,
  describeIpoScope,
  openRepairDb,
  queryCurrentDatabase,
  resolveIpoScope,
  writeLedgerFile,
  type ExecuteLike,
} from './lib/repair-tool.js';

const TOOL = 'repair-retire-manifest-removed-fields';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
  undoLedger: string | null;
  /** #1045: `--ipo <uuid>` (repeatable or comma-separated); empty = unscoped, today's DB-wide default. */
  ipoIds: string[];
  /** `--ipo` values that failed uuid validation; a non-empty list refuses the run (exit 2). */
  invalidIpo: string[];
  /** `--ipo`/`--ipo=` present in argv but yielded zero usable ids (#1053 MAJOR-1); refuses the run (exit 2). */
  unusableIpo: boolean;
}

export function parseArgs(argv: readonly string[]): Cli {
  const at = argv.indexOf('--expect-db');
  const undoAt = argv.indexOf('--undo');
  const ipoScope = resolveIpoScope(argv, '--ipo');
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    expectDb: at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null,
    undoLedger: undoAt >= 0 && argv[undoAt + 1] && !argv[undoAt + 1].startsWith('--') ? argv[undoAt + 1] : null,
    ipoIds: ipoScope.ipoIds,
    invalidIpo: ipoScope.invalid,
    unusableIpo: ipoScope.unusable,
  };
}

/**
 * Pure: which `table.field` keys currently written in `ipo_field_plan` are
 * absent from the current manifest — the class this tool retires. Unit
 * tested without a database.
 */
export function computeRemovedFieldKeys(
  existingKeys: readonly string[],
  manifestFieldKeys: ReadonlySet<string>
): string[] {
  return [...new Set(existingKeys)].filter((k) => !manifestFieldKeys.has(k)).sort();
}

export interface LedgerPayload {
  tool: string;
  at: string;
  dbName: string;
  removedFieldKeys: string[];
  rows: Record<string, unknown>[];
}

export interface RunDeps {
  cli: Cli;
  dbLike: ExecuteLike;
  loadManifest: () => ReturnType<typeof loadFieldManifest>;
  /** Every distinct `table.field` key currently present in `ipo_field_plan`. */
  readExistingFieldKeys: () => Promise<string[]>;
  /** Read-only snapshot of every row for the given field keys (dry-run reporting). */
  snapshotRows: (fieldKeys: readonly string[]) => Promise<Record<string, unknown>[]>;
  /**
   * MINOR-4: one transaction — snapshot the rows for `fieldKeys`, call
   * `onSnapshot` with them (the caller writes the ledger here, BEFORE any
   * delete), then DELETE ... WHERE id = ANY(<the snapshotted ids>), then
   * commit. Returns the snapshotted rows and how many were deleted.
   */
  snapshotAndDeleteInTransaction: (
    fieldKeys: readonly string[],
    onSnapshot: (rows: Record<string, unknown>[]) => void
  ) => Promise<{ rows: Record<string, unknown>[]; deleted: number }>;
  /** MINOR-5: restore ledger rows inside one transaction; skips ids already present. */
  restoreRowsInTransaction: (rows: Record<string, unknown>[]) => Promise<number>;
  readLedger: (filePath: string) => LedgerPayload;
  writeLedger?: (payload: LedgerPayload) => string;
  logger?: { log: (l: string) => void; error: (l: string) => void };
}

export interface RunResult {
  exitCode: number;
  refusedAt?: 'no-expect-db' | 'db-mismatch' | 'prod-guard' | 'undo-db-mismatch';
  wrote: boolean;
  deleted: number;
  restored: number;
  removedFieldKeys: string[];
}

export async function run(deps: RunDeps): Promise<RunResult> {
  const { cli, dbLike, loadManifest, readExistingFieldKeys, snapshotRows, snapshotAndDeleteInTransaction, restoreRowsInTransaction, readLedger } = deps;
  const log = deps.logger?.log ?? ((l: string) => console.log(l));
  const err = deps.logger?.error ?? ((l: string) => console.error(l));

  if (!cli.expectDb) {
    err(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    return { exitCode: 1, refusedAt: 'no-expect-db', wrote: false, deleted: 0, restored: 0, removedFieldKeys: [] };
  }

  const actual = await queryCurrentDatabase(dbLike);
  if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
    err(`${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    return { exitCode: 1, refusedAt: 'db-mismatch', wrote: false, deleted: 0, restored: 0, removedFieldKeys: [] };
  }

  let prodRefused = false;
  await openRepairDb(dbLike, {
    apply: cli.apply,
    allowProd: cli.allowProd,
    toolName: TOOL,
    log,
    error: err,
    onRefuse: () => {
      prodRefused = true;
    },
  });
  if (prodRefused) {
    return { exitCode: 1, refusedAt: 'prod-guard', wrote: false, deleted: 0, restored: 0, removedFieldKeys: [] };
  }
  log(`${TOOL}: schema/db check passed on "${actual}"`);
  log(`${TOOL}: scope = ${describeIpoScope(cli.ipoIds ?? [])}`);

  // --undo: restore from a prior ledger, never computed against the current manifest.
  if (cli.undoLedger) {
    const ledger = readLedger(cli.undoLedger);
    // MINOR-5: the ledger names the database it was captured from; refuse a
    // ledger captured elsewhere rather than trust the operator picked the
    // right file for the box this pool is connected to.
    if ((ledger.dbName ?? '').toLowerCase() !== actual.toLowerCase()) {
      err(
        `${TOOL}: refusing UNDO — ledger "${cli.undoLedger}" was captured from "${ledger.dbName}" but this pool is connected to "${actual}".`
      );
      return { exitCode: 1, refusedAt: 'undo-db-mismatch', wrote: false, deleted: 0, restored: 0, removedFieldKeys: ledger.removedFieldKeys ?? [] };
    }
    log(`\n${TOOL}: UNDO — ${ledger.rows.length} row(s) recorded in "${cli.undoLedger}" for field key(s) ${ledger.removedFieldKeys.join(', ')}.`);
    if (!cli.apply) {
      log(`\nDRY RUN — nothing written. Re-run with --apply to restore ${ledger.rows.length} row(s).`);
      return { exitCode: 0, wrote: false, deleted: 0, restored: 0, removedFieldKeys: ledger.removedFieldKeys };
    }
    const restored = await restoreRowsInTransaction(ledger.rows);
    log(`\n${TOOL}: restored ${restored} row(s) on "${actual}".`);
    return { exitCode: 0, wrote: true, deleted: 0, restored, removedFieldKeys: ledger.removedFieldKeys };
  }

  const manifest = loadManifest();
  const manifestFieldKeys = new Set(Object.keys(manifest.fields));
  const existingKeys = await readExistingFieldKeys();
  const removedFieldKeys = computeRemovedFieldKeys(existingKeys, manifestFieldKeys);

  if (removedFieldKeys.length === 0) {
    log(`\n${TOOL}: nothing to repair on "${actual}" — every ipo_field_plan (table, field) pair is still in the manifest.`);
    return { exitCode: 0, wrote: false, deleted: 0, restored: 0, removedFieldKeys: [] };
  }

  log(`\n${TOOL}: ${removedFieldKeys.length} field key(s) in ipo_field_plan are no longer in the manifest: ${removedFieldKeys.join(', ')}`);

  if (!cli.apply) {
    const rows = await snapshotRows(removedFieldKeys);
    log(`\n${TOOL}: ${rows.length} row(s) will be retired (deleted) across ${removedFieldKeys.length} field key(s).`);
    log(`\nDRY RUN — nothing written. Re-run with --apply --expect-db ${actual} to delete ${rows.length} row(s).`);
    return { exitCode: 0, wrote: false, deleted: 0, restored: 0, removedFieldKeys };
  }

  let ledgerPath = '';
  const { rows, deleted } = await snapshotAndDeleteInTransaction(removedFieldKeys, (snapshotted) => {
    // MAJOR-2 / MINOR-4: this runs INSIDE the transaction, strictly before
    // the delete executes — the ledger is the before-image of exactly the
    // rows the delete below is about to remove, never a separately-read set.
    ledgerPath = (deps.writeLedger ?? ((payload: LedgerPayload) =>
      writeLedgerFile(
        path.join(SCRAPER_ROOT, 'scripts', 'state', `${TOOL}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
        payload
      )))({
      tool: TOOL,
      at: new Date().toISOString(),
      dbName: actual,
      removedFieldKeys,
      rows: snapshotted,
    });
  });
  log(`\n${TOOL}: before-image ledger written to ${ledgerPath} (${rows.length} row(s))`);
  log(`\n${TOOL}: deleted ${deleted} row(s) on "${actual}". Undo: --undo ${ledgerPath} --apply`);
  return { exitCode: 0, wrote: true, deleted, restored: 0, removedFieldKeys };
}

function fieldKeyToTableField(key: string): { tableName: string; fieldName: string } {
  const dot = key.indexOf('.');
  return { tableName: key.slice(0, dot), fieldName: key.slice(dot + 1) };
}

/**
 * Pure (no DB) query builders, exported so review round 2's compiled-SQL
 * scope test can assert the `ipo_id = ANY(...)` clause is present when scoped
 * and absent when not, without executing against a database (#1053 MAJOR-2).
 */
export function buildSnapshotQuery(ipoScope: SQL | null, tableName: string, fieldName: string): SQL {
  return ipoScope
    ? sql`SELECT row_to_json(t) AS j FROM ipo_field_plan t WHERE table_name = ${tableName} AND field_name = ${fieldName} AND ${ipoScope}`
    : sql`SELECT row_to_json(t) AS j FROM ipo_field_plan t WHERE table_name = ${tableName} AND field_name = ${fieldName}`;
}

export function buildExistingFieldKeysQuery(ipoScope: SQL | null): SQL {
  return ipoScope
    ? sql`SELECT DISTINCT table_name, field_name FROM ipo_field_plan WHERE ${ipoScope}`
    : sql`SELECT DISTINCT table_name, field_name FROM ipo_field_plan`;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.invalidIpo.length > 0) {
    console.error(`${TOOL}: --ipo value(s) are not valid uuids, refusing: ${cli.invalidIpo.join(', ')}`);
    process.exit(2);
  }
  if (cli.unusableIpo) {
    console.error(
      `${TOOL}: --ipo was given but no usable uuid could be parsed from it (check quoting, placement or a missing value) — refusing rather than silently falling back to ALL IPOs DB-wide.`
    );
    process.exit(2);
  }
  const dbLike = db as unknown as ExecuteLike;
  const realDb = db as unknown as { transaction: <T>(fn: (tx: ExecuteLike) => Promise<T>) => Promise<T> };
  const ipoScope = buildIpoScopeCondition(cli.ipoIds);

  async function readSnapshot(tx: ExecuteLike, fieldKeys: readonly string[]): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (const key of fieldKeys) {
      const { tableName, fieldName } = fieldKeyToTableField(key);
      const res = await tx.execute(buildSnapshotQuery(ipoScope, tableName, fieldName));
      const resultRows = (res as unknown as { rows: { j: Record<string, unknown> }[] }).rows ?? [];
      rows.push(...resultRows.map((r) => r.j));
    }
    return rows;
  }

  const result = await run({
    cli,
    dbLike,
    loadManifest: loadFieldManifest,
    readExistingFieldKeys: async () => {
      const res = await dbLike.execute(buildExistingFieldKeysQuery(ipoScope));
      const rows = (res as unknown as { rows: { table_name: string; field_name: string }[] }).rows ?? [];
      return rows.map((r) => `${r.table_name}.${r.field_name}`);
    },
    snapshotRows: (fieldKeys) => readSnapshot(dbLike, fieldKeys),
    snapshotAndDeleteInTransaction: async (fieldKeys, onSnapshot) => {
      return realDb.transaction(async (tx) => {
        const rows = await readSnapshot(tx, fieldKeys);
        const ids = rows.map((r) => r.id as string);
        onSnapshot(rows); // ledger written here, strictly before the DELETE below
        let deleted = 0;
        if (ids.length > 0) {
          // NOTE (RCA, 2026-09-25): drizzle's sql`` expands a JS array interpolated as
          // `${ids}` into a parenthesized parameter LIST -- `ANY(($2, $3, ...))` -- which
          // Postgres rejects for `ANY()`. Bind it as ONE array parameter via sql.param(),
          // the same fix already applied in repair-not-extractable-documents.ts and
          // repair-readmit-stranded-documents.ts.
          const res = await tx.execute(sql`DELETE FROM ipo_field_plan WHERE id = ANY(${sql.param(ids)}::uuid[]) RETURNING id`);
          const resultRows = (res as unknown as { rows: { id: string }[] }).rows ?? [];
          deleted = resultRows.length;
        }
        return { rows, deleted };
      });
    },
    restoreRowsInTransaction: async (rows) => {
      return realDb.transaction(async (tx) => {
        let restored = 0;
        for (const row of rows) {
          const existing = await tx.execute(sql`SELECT 1 FROM ipo_field_plan WHERE id = ${row.id as string}`);
          const existingRows = (existing as unknown as { rows: unknown[] }).rows ?? [];
          if (existingRows.length > 0) continue; // idempotent: never duplicate a row that is already back
          await tx.execute(
            sql`INSERT INTO ipo_field_plan SELECT * FROM json_populate_record(null::ipo_field_plan, ${JSON.stringify(row)}::json)`
          );
          restored++;
        }
        return restored;
      });
    },
    readLedger: (filePath: string) => {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { tool: raw.tool ?? TOOL, at: raw.at ?? '', dbName: raw.dbName ?? '', removedFieldKeys: raw.removedFieldKeys ?? [], rows: raw.rows ?? [] };
    },
  });
  process.exit(result.exitCode);
}

const isMain = import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().catch((e) => {
    console.error(`${TOOL}: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  });
}
