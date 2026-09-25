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
// Item 1 slice s14 -- FIRST import on purpose. ESM evaluates imported modules in
// source order, so this runs (and prints which checkout @ipodhan/shared resolves
// to) before any module below can read the wrong tree.
import '../../../scripts/lib/alias-preflight-auto.mjs';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

/** The one database name a repair tool refuses to WRITE to without --allow-prod. */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';

/**
 * The one database name where the shared Redis client's localhost:6379
 * fallback (packages/shared/src/cache/redis-client.ts) is actually correct —
 * a local/tunnelled test run has no separate "real" Redis to miss.
 */
export const LOCAL_TEST_DATABASE_NAME = 'ipodhan_test';

/**
 * #1045: shared `--ipo <uuid>` scope for every repair tool that spawns a
 * DB-wide process against the shared `ipodhan_test` database from an
 * integration test — see the class RCA in issue #1045. One implementation,
 * imported rather than retyped, same rationale as the rest of this module.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every value following one or more occurrences of a repeatable CLI flag, plus
 * the `--flag=value` form. Review round 2 (#1053, MAJOR-1): `--ipo=<uuid>` is
 * the common single-token form and must be PARSED, not silently ignored.
 */
export function collectFlagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  const eqPrefix = `${flag}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      values.push(argv[i + 1]);
    } else if (argv[i].startsWith(eqPrefix)) {
      values.push(argv[i].slice(eqPrefix.length));
    }
  }
  return values;
}

/**
 * True when `flag` appears ANYWHERE in argv, in either the bare (`--ipo`) or
 * `--ipo=value` form — regardless of whether `collectFlagValues` was able to
 * extract a usable value from it. Needed because `collectFlagValues` silently
 * drops a flag with no following non-flag token (`--ipo --apply`, a trailing
 * `--ipo`), which is otherwise indistinguishable from "the flag was never
 * given at all" once you only look at the collected values (#1053 MAJOR-1).
 */
export function flagIsPresent(argv: readonly string[], flag: string): boolean {
  const eqPrefix = `${flag}=`;
  return argv.some((a) => a === flag || a.startsWith(eqPrefix));
}

export interface IpoScopeParseResult {
  /** Deduped, validated uuids. Empty = unscoped (today's DB-wide default, unchanged). */
  ipoIds: string[];
  /** Any `--ipo` value that failed uuid validation — the caller refuses (exit 2), never silently drops it. */
  invalid: string[];
}

/**
 * Parse repeatable (`--ipo a --ipo b`) and/or comma-separated (`--ipo a,b`)
 * `--ipo` values, validating each as a uuid. A value that is not a uuid is
 * reported in `invalid`, never silently ignored or silently included.
 */
export function parseIpoScope(rawValues: readonly string[]): IpoScopeParseResult {
  const all = rawValues
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const invalid = all.filter((v) => !UUID_RE.test(v));
  const ipoIds = [...new Set(all.filter((v) => UUID_RE.test(v)))];
  return { ipoIds, invalid };
}

export interface IpoScopeResolution extends IpoScopeParseResult {
  /**
   * True when `flag` is PRESENT in argv but produced zero valid ids AND zero
   * invalid tokens — the five measured forms from #1053's review: `--ipo
   * --apply` (next token is another flag), a trailing `--ipo` (no next
   * token), `--ipo ""`, `--ipo ,` (only empty/comma tokens), and previously
   * `--ipo=<uuid>` before this fix parsed it. Without this check every one of
   * those forms silently fell back to `ipoIds: []` — unscoped, DB-wide — which
   * for a `--apply` repair tool means "every candidate row in the database",
   * the opposite of what `--ipo` asked for. The caller MUST refuse (exit 2)
   * rather than run unscoped when this is true.
   */
  unusable: boolean;
}

/**
 * The one call every repair tool's `parseArgs` should make for `--ipo`:
 * combines presence detection with value parsing so a present-but-unusable
 * flag can never be silently read as "not given".
 */
export function resolveIpoScope(argv: readonly string[], flag = '--ipo'): IpoScopeResolution {
  const present = flagIsPresent(argv, flag);
  const { ipoIds, invalid } = parseIpoScope(collectFlagValues(argv, flag));
  return { ipoIds, invalid, unusable: present && ipoIds.length === 0 && invalid.length === 0 };
}

/** Human-readable scope line for the tool's header — printed so a run always states what it will touch. */
export function describeIpoScope(ipoIds: readonly string[]): string {
  return ipoIds.length === 0 ? 'ALL IPOs (unscoped, DB-wide)' : `${ipoIds.length} IPO(s): ${ipoIds.join(', ')}`;
}

/**
 * The candidate-row filter every repair tool ANDs into its SELECT / DELETE /
 * UPDATE when scoped to specific IPOs, so a test spawning the tool with
 * `--ipo <its fixture id>` can only ever touch its own fixture rows even
 * while vitest runs other integration files in parallel against the same
 * shared database (#1045). Returns `null` when unscoped — today's DB-wide
 * behaviour, unchanged. Binds the ids as ONE array parameter via
 * `sql.param()`, never a JS array interpolated directly into the template
 * (drizzle expands that into a parenthesized tuple, which `ANY()` rejects —
 * the #1042 finding). `column` lets a caller qualify the column with its
 * table alias (e.g. `p.ipo_id`); it is always a fixed identifier from the
 * tool's own code, never user input.
 */
export function buildIpoScopeCondition(ipoIds: readonly string[], column = 'ipo_id'): SQL | null {
  if (ipoIds.length === 0) return null;
  return sql`${sql.raw(column)} = ANY(${sql.param([...ipoIds])}::uuid[])`;
}

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

/**
 * Pure refusal decision for the #715 Redis fail-closed guard: refusing to
 * APPLY writes against a REMOTE database (anything other than
 * `ipodhan_test`) when neither REDIS_URL nor REDIS_HOST is set.
 *
 * RCA (#715): every repair/backfill tool that invalidates cache goes through
 * `getRedisClient()` (packages/shared/src/cache/redis-client.ts), which SILENTLY
 * falls back to `redis://localhost:6379` — the LAPTOP's Redis — when neither
 * env var is set. A tool run over an SSH tunnel to a remote DB (staging,
 * prod) then deletes keys on the laptop's Redis, logs "Connected
 * successfully" / "Cache DEL ...", and reports success, while the real
 * slot's cache keeps serving the pre-repair value until the TTL expires. The
 * write itself lands correctly; only cache invalidation silently no-ops.
 *
 * `redisConfigured` MUST be measured from the SAME process env the shared
 * Redis client factory reads (`process.env.REDIS_URL` /
 * `process.env.REDIS_HOST`) — never assumed. `ipodhan_test` is exempt: it is
 * the one database a local/tunnelled dev run legitimately pairs with a local
 * Redis, so the existing localhost fallback is correct there, not a bug.
 */
export function decideRedisFailClosedRefusal(input: {
  apply: boolean;
  dbName: string;
  redisConfigured: boolean;
  toolName?: string;
}): { refuse: boolean; reason?: string } {
  if (!input.apply) return { refuse: false }; // a dry run invalidates nothing — nothing to refuse
  if (input.redisConfigured) return { refuse: false };
  const isLocalTestDb = (input.dbName ?? '').toLowerCase() === LOCAL_TEST_DATABASE_NAME;
  if (isLocalTestDb) return { refuse: false };
  const prefix = input.toolName ? `${input.toolName}: ` : '';
  return {
    refuse: true,
    reason:
      `${prefix}refusing to APPLY writes against "${input.dbName}" — neither REDIS_URL nor ` +
      'REDIS_HOST is set. Cache invalidation would silently fall back to redis://localhost:6379 ' +
      `(the LAPTOP's Redis, not this slot's), report success, and leave "${input.dbName}"'s real ` +
      'cache serving stale values until the TTL expires (#715). Set REDIS_URL/REDIS_HOST for this ' +
      `slot before running --apply, or target ${LOCAL_TEST_DATABASE_NAME}.`,
  };
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
    /**
     * Whether the shared Redis client (packages/shared/src/cache/redis-client.ts)
     * has a real target configured for this slot. Defaults to reading
     * `process.env.REDIS_URL` / `process.env.REDIS_HOST` directly — the SAME
     * env vars that client reads — so callers do not need to thread this
     * through; tests override it for determinism (#715).
     */
    redisConfigured?: boolean;
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
  const redisConfigured =
    options.redisConfigured ?? Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
  const redisDecision = decideRedisFailClosedRefusal({
    apply: options.apply,
    dbName,
    redisConfigured,
    toolName: options.toolName,
  });
  if (redisDecision.refuse) {
    err(redisDecision.reason!);
    (options.onRefuse ?? ((): void => process.exit(1)))(redisDecision.reason!);
    return { dbName, isProd };
  }
  if (options.apply && isProd && options.allowProd) {
    log(`ALLOW-PROD: writing against "${PRODUCTION_DATABASE_NAME}" (--allow-prod given).`);
  }
  return { dbName, isProd };
}

/**
 * Read the currently-stored provenance source for one (ipo, table, field), or null.
 *
 * CORRECT FOR NOW, NOT CORRECT IN GENERAL: this selects by the 3-column key and
 * takes the first row. Every row_key is '' today, so there is exactly one row to
 * find. Once slice s5b writes real row keys this will pick an ARBITRARY sibling.
 * Which row key a repair should read is a design question owned by s5b/s7a/s7b —
 * do not guess it here.
 */
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
      // MUST mirror unique_field_source_per_ipo (item 1 slice s18:
      // ipo_id, table_name, row_key, field_name). Postgres needs an arbiter
      // index matching this list EXACTLY, and the non-unique lookup index
      // idx_field_sources_ipo_table_field does not qualify — a 3-column target
      // here is 42P10 on the first write of EVERY repair tool, since
      // scripts/ci/require-repair-tool-module.mjs forces them all through this
      // module. rowKey is omitted from .values() above, so it defaults to ''.
      target: [
        schema.fieldSources.ipoId,
        schema.fieldSources.tableName,
        schema.fieldSources.rowKey,
        schema.fieldSources.fieldName,
      ],
      set: row,
    });

  return { previousSource };
}

/**
 * Pure refusal decision for the prod-schema-drift preflight (#713): a repair
 * tool must refuse its first WRITE, before opening a transaction, when the
 * connected database is missing a column the tool's own writes depend on
 * (`field_sources.row_key` for every tool that goes through
 * `upsertFieldSource`). #713 measured this live 2026-09-16: three repair
 * tools ran up to 12 of 13 planned writes on production before the 13th
 * crashed on a missing column mid-transaction — stopped safely (0 rows
 * changed, confirmed by read-back) but only by luck of transaction ordering,
 * not by a check. `probeColumn` is injected so this is unit-testable without
 * a live database (a mocked column probe) and mirrors
 * `assert-schema-drift.ts`'s own `information_schema.columns` query shape,
 * never a second implementation of that lookup.
 */
export function decideSchemaDriftRefusal(input: {
  apply: boolean;
  hasRowKeyColumn: boolean;
  toolName?: string;
}): { refuse: boolean; reason?: string } {
  if (!input.apply) return { refuse: false }; // a dry run never writes — nothing to refuse
  if (input.hasRowKeyColumn) return { refuse: false };
  const prefix = input.toolName ? `${input.toolName}: ` : '';
  return {
    refuse: true,
    reason:
      `${prefix}refusing to APPLY writes — the connected database is missing ` +
      `"field_sources.row_key", which every write through upsertFieldSource() depends on. ` +
      'This is the production schema-drift class tracked in issue #713 (migration ' +
      '20260910043758_salty_shen.sql has not run against this database); run db:migrate ' +
      'first, or point this tool at a database that already has it.',
  };
}

/**
 * Ask the SAME pool that will do the writing whether `field_sources.row_key`
 * exists live, via `information_schema.columns` — the identical lookup shape
 * `assert-schema-drift.ts` uses, never a second implementation of that query.
 */
export async function probeFieldSourcesRowKeyColumn(dbLike: ExecuteLike): Promise<boolean> {
  const result = await dbLike.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_sources' AND column_name = 'row_key'
    LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows;
  return Boolean(rows && rows.length > 0);
}

/**
 * Composed preflight: probe the live column, decide, and (by default) print
 * + exit on refusal — mirroring `openRepairDb`'s shape so every repair tool
 * calls one more line, not a hand-rolled probe. `onRefuse` is injectable for
 * tests, same pattern as `openRepairDb`.
 */
export async function assertNoSchemaDrift(
  dbLike: ExecuteLike,
  options: {
    apply: boolean;
    toolName: string;
    log?: (line: string) => void;
    error?: (line: string) => void;
    onRefuse?: (reason: string) => void;
  }
): Promise<{ refused: boolean }> {
  const log = options.log ?? ((l: string) => console.log(l));
  const err = options.error ?? ((l: string) => console.error(l));

  let hasRowKeyColumn: boolean;
  try {
    hasRowKeyColumn = await probeFieldSourcesRowKeyColumn(dbLike);
  } catch (probeError) {
    // The probe itself failing (connection drop, permission error, etc.) is
    // indistinguishable from "the column is missing" if swallowed — and
    // indistinguishable from "the column is present" if ignored. A dry run
    // never writes, so a probe failure has nothing to protect and is
    // reported but not refused (signal-ownership R6: the failure carries its
    // cause). An --apply run fails CLOSED: refuse, and print the #713
    // message PLUS the underlying error text, never a bare stack.
    const causeText = probeError instanceof Error ? probeError.message : String(probeError);
    log(`schema-drift preflight: probe FAILED (${causeText}) — treating as unknown, not as "column present"`);
    if (!options.apply) {
      return { refused: false };
    }
    const prefix = options.toolName ? `${options.toolName}: ` : '';
    const reason =
      `${prefix}refusing to APPLY writes — the schema-drift preflight probe for ` +
      '"field_sources.row_key" (issue #713) failed and could not confirm the column exists: ' +
      `${causeText}`;
    err(reason);
    (options.onRefuse ?? ((): void => process.exit(1)))(reason);
    return { refused: true };
  }

  log(`schema-drift preflight: field_sources.row_key present = ${hasRowKeyColumn}`);
  const decision = decideSchemaDriftRefusal({
    apply: options.apply,
    hasRowKeyColumn,
    toolName: options.toolName,
  });
  if (decision.refuse) {
    err(decision.reason!);
    (options.onRefuse ?? ((): void => process.exit(1)))(decision.reason!);
    return { refused: true };
  }
  return { refused: false };
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
