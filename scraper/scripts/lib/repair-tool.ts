/**
 * Shared guard module for every data-repair / backfill tool under
 * `scraper/scripts` (T-490).
 *
 * RCA (2026-09-07): three repair tools each re-implemented the same guard
 * pattern and each got a DIFFERENT part of it wrong —
 * `backfill-issue-size-chittorgarh-detail.ts` wrote `ipos` with no
 * `field_sources` provenance row; `backfill-band-provenance-t276.ts` derived
 * its prod guard from env vars while `initPool()` prefers `DATABASE_HOST`
 * (so the env name can read "ipodhan_staging" while the pool opens prod);
 * `repair-source-trust-batch-t292.ts` wrote `ipos` directly behind an
 * env-based guard. An adversarial review caught all three — detection after
 * the fact. This module is the prevention: ONE implementation of the things
 * every repair tool must get right, imported rather than retyped.
 *
 * What belongs here (and nothing else): the guards that are identical for
 * EVERY repair tool.
 *   1. `openRepairDb()` — asks the SAME pool that will do the writing which
 *      database it is in, prints it, and refuses a prod `--apply`.
 *   2. `decideProdWriteRefusal()` — the pure refusal decision (unit-testable
 *      without a DB; deleting it turns a named test red).
 *   3. `upsertFieldSource()` — the provenance row, keeping `previous_source`
 *      read from whatever is already stored and `previous_value` supplied by
 *      the CALLER's ledger (never the now-current value).
 *   4. `alreadyRepairedKey()` / `buildAlreadyRepairedSet()` — PER-FIELD
 *      idempotency, so a partially-completed run never re-upserts a field and
 *      overwrites its `previous_source` audit trail.
 *   5. `writeLedgerFile()` — the applied-ledger / backup artifact.
 *
 * What does NOT belong here: anything tool-specific — HTML/PDF parsing,
 * discovery, per-field business decisions, CLI flag parsing beyond the two
 * universal ones. Those stay in the tool.
 *
 * Enforced by `scripts/ci/require-repair-tool-module.mjs`: every
 * `scraper/scripts/{repair,backfill}-*.ts` must import this module or carry a
 * dated `// repair-tool-exempt: <YYYY-MM-DD> <reason>` comment.
 */
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

/** The one database name a repair tool refuses to WRITE to without --allow-prod. */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';

/** Minimal shape of the drizzle handle these helpers need (keeps them unit-testable). */
export interface ExecuteLike {
  execute: (query: any) => Promise<any>;
}
export interface SelectInsertLike {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
}

/**
 * Pure refusal decision, extracted so that DELETING the refusal turns a named
 * test red rather than silently allowing a prod write.
 *
 * `dbName` MUST come from `queryCurrentDatabase()` on the pool that is about
 * to be written through — never from `DATABASE_NAME`/`DATABASE_URL`. An
 * env-derived name trusts the caller's environment to honestly describe the
 * connection; `packages/shared/src/db/index.ts`'s `initPool()` prefers
 * `DATABASE_HOST` when it is set (the tunnel env sets both), so the env can
 * say "staging" while the socket is on prod.
 */
export function decideProdWriteRefusal(input: {
  apply: boolean;
  dbName: string;
  allowProd: boolean;
  toolName?: string;
}): { refuse: boolean; reason?: string } {
  if (!input.apply) return { refuse: false }; // a dry run writes nothing — nothing to refuse
  const isProdDb = (input.dbName ?? '').toLowerCase() === PRODUCTION_DATABASE_NAME;
  if (isProdDb && !input.allowProd) {
    const prefix = input.toolName ? `${input.toolName}: ` : '';
    return {
      refuse: true,
      reason:
        `${prefix}refusing to APPLY writes against the production database ` +
        `"${PRODUCTION_DATABASE_NAME}" (current_database() = "${input.dbName}") — pass --allow-prod to override.`,
    };
  }
  return { refuse: false };
}

/** Ask the SAME pool that will do the writing which database it is connected to. */
export async function queryCurrentDatabase(dbLike: ExecuteLike): Promise<string> {
  const result = await dbLike.execute(sql`SELECT current_database() AS name`);
  const rows = Array.isArray(result) ? result : (result as { rows?: { name: string }[] })?.rows;
  const name = rows?.[0]?.name;
  if (!name) {
    throw new Error(
      'repair-tool: SELECT current_database() returned no row — cannot verify which database this pool is writing to.'
    );
  }
  return String(name);
}

export interface OpenRepairDbResult {
  dbName: string;
  isProd: boolean;
}

/**
 * The universal opening move of every repair tool: resolve the REAL database
 * name from the writing pool, print it, and refuse a prod `--apply` that was
 * not explicitly authorized. Prints `current_database(): <name>` — the line
 * the ops recipes and the staging dry-run proofs read.
 *
 * `onRefuse` defaults to `process.exit(1)` after printing the reason; tests
 * pass their own so the refusal is observable without killing the runner.
 */
export async function openRepairDb(
  dbLike: ExecuteLike,
  options: {
    apply: boolean;
    allowProd: boolean;
    toolName: string;
    log?: (line: string) => void;
    error?: (line: string) => void;
    onRefuse?: (reason: string) => void;
  }
): Promise<OpenRepairDbResult> {
  const log = options.log ?? ((l: string) => console.log(l));
  const err = options.error ?? ((l: string) => console.error(l));
  const dbName = await queryCurrentDatabase(dbLike);
  log(`current_database(): ${dbName}`);
  const decision = decideProdWriteRefusal({
    apply: options.apply,
    dbName,
    allowProd: options.allowProd,
    toolName: options.toolName,
  });
  const isProd = dbName.toLowerCase() === PRODUCTION_DATABASE_NAME;
  if (decision.refuse) {
    err(decision.reason!);
    (options.onRefuse ?? ((): void => process.exit(1)))(decision.reason!);
    return { dbName, isProd };
  }
  if (options.apply && isProd && options.allowProd) {
    log(`ALLOW-PROD: writing against "${PRODUCTION_DATABASE_NAME}" (--allow-prod given).`);
  }
  return { dbName, isProd };
}

/** Read the currently-stored provenance source for one (ipo, table, field), or null. */
export async function readFieldSource(
  txLike: SelectInsertLike,
  params: { ipoId: string; tableName?: string; fieldName: string }
): Promise<string | null> {
  const rows = await txLike
    .select({ source: schema.fieldSources.source })
    .from(schema.fieldSources)
    .where(
      and(
        eq(schema.fieldSources.ipoId, params.ipoId),
        eq(schema.fieldSources.tableName, params.tableName ?? 'ipos'),
        eq(schema.fieldSources.fieldName, params.fieldName)
      )
    )
    .limit(1);
  return rows[0]?.source ?? null;
}

export interface UpsertFieldSourceParams {
  ipoId: string;
  tableName?: string;
  fieldName: string;
  source: string;
  confidence?: number;
  /**
   * The value that was there BEFORE this repair, taken from the CALLER's
   * ledger. Never the now-current value: recording the corrected value as
   * "previous" destroys the only record of what was wrong.
   */
  previousValue: string | number | null;
  dataLineage: unknown;
  updatedBy: string;
}

/**
 * Same-transaction upsert on `unique_field_source_per_ipo`, mirroring
 * `FieldSourcesRepository.trackFieldUpdate`.
 *
 * `previousSource` is READ from whatever row already exists and carried
 * through — never fabricated, never replaced by the new source. That carry is
 * the audit trail of which source told the lie; the per-field idempotency
 * check below is what stops a re-run from erasing it. `dataLineage` is ALWAYS
 * set, so a prior source's stale lineage never survives an upsert this module
 * performs.
 */
export async function upsertFieldSource(
  txLike: SelectInsertLike,
  params: UpsertFieldSourceParams
): Promise<{ previousSource: string | null }> {
  const tableName = params.tableName ?? 'ipos';
  const previousSource = await readFieldSource(txLike, {
    ipoId: params.ipoId,
    tableName,
    fieldName: params.fieldName,
  });
  const previousValue = params.previousValue === null ? null : String(params.previousValue);
  const row = {
    source: params.source as never,
    confidence: params.confidence ?? 100,
    previousValue,
    previousSource: previousSource as never,
    dataLineage: params.dataLineage as never,
    updatedAt: new Date(),
    updatedBy: params.updatedBy,
  };

  await txLike
    .insert(schema.fieldSources)
    .values({
      ipoId: params.ipoId,
      tableName,
      fieldName: params.fieldName,
      ...row,
    })
    .onConflictDoUpdate({
      target: [schema.fieldSources.ipoId, schema.fieldSources.tableName, schema.fieldSources.fieldName],
      set: row,
    });

  return { previousSource };
}

/** Stable key for the per-field idempotency set. */
export function alreadyRepairedKey(ipoId: string, fieldName: string): string {
  return `${ipoId}::${fieldName}`;
}

/**
 * Build the PER-FIELD "already repaired by this tool" set.
 *
 * Per FIELD, not per row: a partially-completed prior run may have repaired
 * `priceRangeMin` but not `priceRangeMax`. Re-upserting the repaired one
 * would read its own stamp as `previous_source` and overwrite the ORIGINAL
 * wrong source — the audit trail — with the repair source.
 */
export function buildAlreadyRepairedSet<T extends { ipoId: string; fieldName: string }>(
  rows: T[],
  isRepairedByThisTool: (row: T) => boolean
): Set<string> {
  return new Set(rows.filter(isRepairedByThisTool).map((r) => alreadyRepairedKey(r.ipoId, r.fieldName)));
}

/** Write an applied-ledger / backup artifact, creating its directory. */
export function writeLedgerFile(filePath: string, payload: unknown): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 1));
  return filePath;
}
