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

/** #671: the `--expect-db <name>` / `--expect-db=<name>` value, or null when not given. */
export function readExpectDbFlag(argv: readonly string[]): string | null {
  return collectFlagValues(argv, '--expect-db')[0] ?? null;
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
 * #1059 round 2 (MINOR-2): `--ipo` scopes the candidate SELECT a repair tool
 * runs when it is DECIDING what to repair; `--undo` restores rows the ledger
 * already names, and the ledger's own row ids are the only scope that means
 * anything there. Combining them silently would read as "restore only the
 * named IPOs' rows from this ledger", which none of the three `--undo`
 * implementations do (they replay every ledger row) — so a `--ipo` alongside
 * `--undo` is refused rather than silently ignored. One implementation,
 * imported by every repair tool's `main()`, same rationale as the rest of
 * this module.
 */
export function decideUndoIpoConflict(argv: readonly string[], undoGiven: boolean, ipoFlag = '--ipo'): boolean {
  return undoGiven && flagIsPresent(argv, ipoFlag);
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
 * #1070 round-2 redesign of the #715 Redis fail-closed guard.
 *
 * The #715 version (`decideRedisFailClosedRefusal`, retired here) was wired
 * into `openRepairDb()` and refused the ENTIRE tool run for any --apply
 * against a remote db with no Redis configured — even the ~27 of 42 repair
 * tools that never invalidate cache at all (no `getRedisClient()` /
 * `invalidateIPOCaches()` call anywhere in the tool). That is a refusal with
 * no defect behind it for those tools.
 *
 * It was ALSO wrong on its own terms: `redisConfigured` meant "REDIS_URL or
 * REDIS_HOST is set", but a set REDIS_URL pointing at localhost/127.0.0.1 is
 * STILL the laptop's Redis (the laptop cannot reach the VPS's own Redis over
 * an SSH tunnel opened only for Postgres) — so a configured-but-loopback
 * target passed the guard and silently invalidated the wrong Redis anyway.
 *
 * This version moves the check to the ACTUAL cache-invalidation call site
 * (`guardCacheInvalidation`, below) — tools that never invalidate are
 * unaffected — and checks the RESOLVED HOST, not merely "is something set".
 * The repair tool's write is never blocked, only its own cache-invalidation
 * step: on a block, the exact keys that would have been deleted are printed
 * with the on-box command to drop them (docs/ops/prod-ops-recipes.md §5),
 * and the tool's exit status is unaffected.
 */

/** Hosts that mean "this box's own Redis" — never a remote slot's (#1070). */
const LOCAL_REDIS_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * The Redis host a repair tool's cache invalidation would actually connect
 * to, resolved from the SAME env vars the shared Redis client factory reads
 * (`packages/shared/src/cache/redis-client.ts`): REDIS_URL first (its
 * hostname), REDIS_HOST otherwise. Returns null when neither is set — the
 * factory's own localhost:6379 fallback case. An unparseable REDIS_URL is
 * treated as "not configured" (null), never as "safe" — a malformed value is
 * closer to unset than to a verified remote target.
 */
export function resolveRedisTargetHost(input: { redisUrl?: string; redisHost?: string }): string | null {
  if (input.redisUrl) {
    try {
      return new URL(input.redisUrl).hostname || null;
    } catch {
      return null;
    }
  }
  return input.redisHost || null;
}

/**
 * Which slot a database name belongs to, for the printed on-box redis-cli
 * recipe (docs/ops/prod-ops-recipes.md §5): prod is Redis db 0, staging db 1.
 * `ipodhan_test` never reaches this (guardCacheInvalidation never blocks it).
 */
export function repairToolRedisSlot(dbName: string): { slot: 'prod' | 'staging' | 'unknown'; dbIndex: number | null } {
  const lower = (dbName ?? '').toLowerCase();
  if (lower === PRODUCTION_DATABASE_NAME) return { slot: 'prod', dbIndex: 0 };
  if (lower.includes('staging')) return { slot: 'staging', dbIndex: 1 };
  return { slot: 'unknown', dbIndex: null };
}

/**
 * Pure decision: should this cache invalidation CONNECT to Redis, or BLOCK
 * (never connect, caller prints the keys it would have deleted instead)?
 *
 * `ipodhan_test` is exempt — it is the one database a local/tunnelled dev
 * run legitimately pairs with local Redis. Every other database blocks
 * unless `redisHost` resolves to something OTHER than this box's own
 * loopback address.
 */
export function decideCacheInvalidationBlock(input: {
  dbName: string;
  redisHost: string | null;
}): { block: boolean; reason?: string } {
  const isLocalTestDb = (input.dbName ?? '').toLowerCase() === LOCAL_TEST_DATABASE_NAME;
  if (isLocalTestDb) return { block: false };
  if (input.redisHost && !LOCAL_REDIS_HOSTS.has(input.redisHost)) return { block: false };
  return {
    block: true,
    reason: input.redisHost
      ? `REDIS_URL/REDIS_HOST resolves to "${input.redisHost}" — this box's own loopback Redis, not "${input.dbName}"'s slot Redis`
      : 'neither REDIS_URL nor REDIS_HOST is set (falls back to the LAPTOP\'s redis://localhost:6379)',
  };
}

/** The block notice: the keys that would have been deleted, plus the on-box command to drop them. */
export function formatCacheInvalidationBlockNotice(input: {
  dbName: string;
  toolName: string;
  keys: readonly string[];
  reason: string;
}): string {
  const { slot, dbIndex } = repairToolRedisSlot(input.dbName);
  const slotLabel = slot === 'unknown' ? `"${input.dbName}" (slot unmeasured)` : `${slot} ("${input.dbName}")`;
  const dbFlag = dbIndex === null ? '-n <slot db index>' : `-n ${dbIndex}`;
  const delArgs = input.keys.map((k) => `'${k}'`).join(' ');
  return (
    `${input.toolName}: BLOCKED cache invalidation for ${slotLabel} — ${input.reason} (#1070). ` +
    'The repair write itself is NOT blocked — only this step. Keys that would have been deleted:\n' +
    input.keys.map((k) => `  - ${k}`).join('\n') +
    '\nRun this on the VPS to drop them (docs/ops/prod-ops-recipes.md §5):\n' +
    `  redis-cli ${dbFlag} DEL ${delArgs}`
  );
}

/**
 * The guard every repair-tool cache-invalidation call site uses INSTEAD of
 * calling `getRedisClient()` unconditionally (#1070). Only tools that
 * actually invalidate cache call this — a tool with no cache to invalidate
 * never calls it and is completely unaffected.
 *
 * `redisHost` is injectable for tests; production callers omit it and it is
 * resolved from `process.env.REDIS_URL` / `process.env.REDIS_HOST` — the
 * same env vars the shared Redis client factory reads.
 */
export function guardCacheInvalidation(input: {
  dbName: string;
  toolName: string;
  keys: readonly string[];
  redisHost?: string | null;
  log?: (line: string) => void;
}): { blocked: boolean } {
  const log = input.log ?? ((l: string) => console.log(l));
  const redisHost =
    input.redisHost !== undefined
      ? input.redisHost
      : resolveRedisTargetHost({ redisUrl: process.env.REDIS_URL, redisHost: process.env.REDIS_HOST });
  const decision = decideCacheInvalidationBlock({ dbName: input.dbName, redisHost });
  if (decision.block) {
    log(
      formatCacheInvalidationBlockNotice({
        dbName: input.dbName,
        toolName: input.toolName,
        keys: input.keys,
        reason: decision.reason!,
      })
    );
    return { blocked: true };
  }
  return { blocked: false };
}

/**
 * A Redis-shaped no-op for call sites where cache invalidation happens
 * INSIDE a repository method (`IPORepository`, etc.) rather than at an
 * explicit `invalidateIPOCaches()` call the tool can wrap directly (#715
 * class sweep). When `guardCacheInvalidation` blocks, the caller passes this
 * instead of the real `getRedisClient()` result so the repository's own
 * cache-aside writes go nowhere instead of hitting this box's loopback
 * Redis. Same method subset as the existing no-op in
 * `scraper/scripts/probe-doc-fetcher.ts`.
 */
export function createNoopRedisClient(): {
  get: () => Promise<null>;
  set: () => Promise<string>;
  setex: () => Promise<string>;
  del: () => Promise<number>;
  keys: () => Promise<string[]>;
} {
  return {
    get: async () => null,
    set: async () => 'OK',
    setex: async () => 'OK',
    del: async () => 0,
    keys: async (): Promise<string[]> => [],
  };
}

/**
 * Pure description of whether the CURRENT env gives `initPool()`
 * (`packages/shared/src/db/index.ts`) anything to connect to, for
 * `openRepairDb`'s pre-connect check (#481).
 *
 * `initPool()` picks the discrete form (`DATABASE_HOST`+`DATABASE_PORT`+
 * `DATABASE_USER`+`DATABASE_PASSWORD`+`DATABASE_NAME`) when BOTH
 * `DATABASE_HOST` and `DATABASE_PASSWORD` are set, and otherwise falls back
 * to `connectionString: process.env.DATABASE_URL` — which already works
 * correctly for a lone `DATABASE_URL` (confirmed by reading that file; #481's
 * own framing of "initPool ignores DATABASE_URL" does not hold for that
 * case). The one shape that is genuinely unusable is NEITHER form present:
 * `connectionString` is then `undefined`, `pg.Pool` falls back to its own
 * defaults (`PGHOST`/localhost), and — reaching nothing through a tunnel —
 * hangs until the full connection-timeout wait before failing anonymously.
 *
 * Never returns the password or the full `DATABASE_URL` in `target` — only
 * host:port/db, so a caller can safely log it (signal-ownership R6: a
 * failure carries its cause, without carrying a secret).
 */
export interface DbConnectionTargetDescription {
  usable: boolean;
  /** host:port/db (or a redacted placeholder) — never a password or full URL. */
  target: string;
  /** Named only when `usable` is false. */
  missing: string[];
}

export function describeDbConnectionTarget(env: NodeJS.ProcessEnv = process.env): DbConnectionTargetDescription {
  if (env.DATABASE_HOST && env.DATABASE_PASSWORD) {
    // Mirror `resolveDiscreteDbParams()` (packages/shared/src/db/index.ts)
    // exactly: it THROWS when DATABASE_NAME or DATABASE_USER is missing,
    // refusing to default to the production name ('ipodhan') or the
    // superuser ('postgres') (#640). This description must agree — labelling
    // an incomplete discrete env as a usable 'ipodhan' target here would tell
    // the operator the opposite of what initPool() will actually do.
    const missing: string[] = [];
    if (!env.DATABASE_NAME) missing.push('DATABASE_NAME');
    if (!env.DATABASE_USER) missing.push('DATABASE_USER');
    if (missing.length > 0) {
      return { usable: false, target: 'unset', missing };
    }
    const host = env.DATABASE_HOST;
    const port = env.DATABASE_PORT || '5432';
    const name = env.DATABASE_NAME;
    return { usable: true, target: `${host}:${port}/${name}`, missing: [] };
  }
  if (env.DATABASE_URL) {
    try {
      const parsed = new URL(env.DATABASE_URL);
      const name = parsed.pathname.replace(/^\//, '') || '(unnamed)';
      return { usable: true, target: `${parsed.hostname}:${parsed.port || '5432'}/${name}`, missing: [] };
    } catch {
      // Malformed but present: let the real connection attempt fail and
      // report its own cause, rather than guessing here.
      return { usable: true, target: 'DATABASE_URL (set, unparsable — host/db unknown)', missing: [] };
    }
  }
  return {
    usable: false,
    target: 'unset',
    missing: ['DATABASE_HOST+DATABASE_PORT+DATABASE_USER+DATABASE_PASSWORD+DATABASE_NAME (discrete form)', 'DATABASE_URL (connection-string form)'],
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
 *
 * #1070: this no longer touches Redis at all — the #715 fail-closed guard
 * that used to run here (`decideRedisFailClosedRefusal`) blocked EVERY
 * repair tool's --apply, including the ~27 of 42 that never invalidate cache
 * in the first place. That check moved to `guardCacheInvalidation`, called
 * only by the tools that actually invalidate, at the point they do it.
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
    /** Injectable for tests; production callers omit it (defaults to `process.env`). */
    env?: NodeJS.ProcessEnv;
    /**
     * #671: the database the operator says this run targets (`--expect-db`).
     * When given and it differs from current_database(), the run is refused
     * — dry or applied — before any read or write. Absent = no assertion.
     */
    expectDb?: string | null;
  }
): Promise<OpenRepairDbResult> {
  const log = options.log ?? ((l: string) => console.log(l));
  const err = options.error ?? ((l: string) => console.error(l));
  const onRefuse = options.onRefuse ?? ((): void => process.exit(1));
  const prefix = options.toolName ? `${options.toolName}: ` : '';

  // #481: describe the env's connection target up front — pure, no I/O — so a
  // CONNECTION FAILURE below can be reported with what it was actually trying
  // to reach, instead of an anonymous DrizzleQueryError/timeout. This does
  // NOT refuse pre-emptively on an unusable env: dozens of existing repair
  // tools' own unit tests call openRepairDb() with a mocked dbLike and no env
  // set at all (a connection that will never actually happen), and a
  // pre-connect refusal here would falsely refuse every one of them. The
  // refusal that matters — a REAL connection actually failing — is caught
  // below regardless of why it failed.
  const target = describeDbConnectionTarget(options.env ?? process.env);

  let dbName: string;
  try {
    dbName = await queryCurrentDatabase(dbLike);
  } catch (connectError) {
    // #481: name the target and the underlying cause instead of letting an
    // anonymous DrizzleQueryError/timeout surface (signal-ownership R6).
    const cause =
      connectError instanceof Error && connectError.cause instanceof Error
        ? connectError.cause.message
        : connectError instanceof Error
          ? connectError.message
          : String(connectError);
    const code =
      (connectError as { cause?: { code?: string }; code?: string } | undefined)?.cause?.code ??
      (connectError as { code?: string } | undefined)?.code;
    const targetDescription = target.usable
      ? target.target
      : `unset (neither ${target.missing.join(' nor ')} is usable — see docs/ops/prod-ops-recipes.md §4)`;
    const reason =
      `${prefix}failed to connect to ${targetDescription}: ${cause}${code ? ` (${code})` : ''} (#481)`;
    err(reason);
    onRefuse(reason);
    return { dbName: '', isProd: false };
  }
  log(`current_database(): ${dbName}`);
  if (options.expectDb && options.expectDb.toLowerCase() !== dbName.toLowerCase()) {
    const reason =
      `${prefix}--expect-db said "${options.expectDb}" but this pool is connected to "${dbName}" — refusing before any read or write.`;
    err(reason);
    onRefuse(reason);
    return { dbName, isProd: dbName.toLowerCase() === PRODUCTION_DATABASE_NAME };
  }
  const decision = decideProdWriteRefusal({
    apply: options.apply,
    dbName,
    allowProd: options.allowProd,
    toolName: options.toolName,
  });
  const isProd = dbName.toLowerCase() === PRODUCTION_DATABASE_NAME;
  if (decision.refuse) {
    err(decision.reason!);
    onRefuse(decision.reason!);
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

/**
 * #422: every repair tool that carries a hard-coded, dated correction table
 * (an array of `{ slug/ipoId, field, value, citation/date }` literals typed
 * from a one-time source read) re-proposes that same correction on EVERY
 * future run, regardless of whether the row's facts have since changed. A
 * prod dry run on 2026-09-08 proposed nulling Priority Jewels Limited's real
 * open/close dates (2026-08-28 / 2026-09-01) from a 2026-08-23 ipowatch
 * citation written when those dates were still "unannounced" — by the time
 * the tool ran again, the row had gone LISTED with real, correct dates.
 *
 * CLASS: every entry in a hard-coded correction table, in any repair tool,
 * on both prod and staging, at any run after the cited source's facts
 * change. This is the one guard every such table is filtered through before
 * a change is proposed or applied — imported, never retyped, same rationale
 * as the rest of this module.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['LISTED', 'CLOSED']);

export interface StaleCorrectionCheckInput {
  /** The row's current lifecycle status (`ipos.status`), or null/undefined if not applicable. */
  status?: string | null;
  /** ISO `YYYY-MM-DD` date the correction's citation was captured on. */
  citationDate: string;
  /**
   * ISO `YYYY-MM-DD` date of the most recent `field_sources` row for this
   * exact (ipoId, field) pair, or null when there is none / it is unknown.
   */
  latestSourceDate: string | null;
  /**
   * The value the correction's author recorded the field as holding AT THE
   * TIME the citation was captured. `undefined` (never supplied) means the
   * table entry carries no `from` — treated as "cannot verify", not as "ok".
   */
  assumedFromValue?: unknown;
  /** The row's CURRENT value for this field, read fresh at run time. */
  currentValue: unknown;
}

export interface StaleCorrectionDecision {
  skip: boolean;
  reason?: string;
}

/**
 * Format a value for the `from`-vs-current comparison as CALENDAR TEXT, never
 * via `toISOString()` (#422 round 2). A hard-coded correction's `from` is
 * always a plain 'YYYY-MM-DD' string, but the row's live current value can
 * arrive as a JS `Date` two different ways that both bite the same way: the
 * raw `pg` driver's own OID-1082 (DATE) type parser (used by every raw
 * `pool.query()` repair tool) and drizzle's default `date()` column mode
 * (`PgDateString`, whose `mapFromDriverValue` is a pass-through of that same
 * raw driver value) BOTH hand back whatever `pg-types` built for OID 1082 —
 * `new Date(year, month - 1, day)`, constructed from LOCAL date parts, not a
 * UTC instant. `.toISOString()` then converts that local midnight to UTC:
 * with the process on IST (UTC+5:30), 2026-02-16 local midnight becomes
 * `2026-02-15T18:30:00.000Z`, one calendar day EARLY — the exact class this
 * repo's `.claude/rules/ist-timezone.md` names for naive timestamps, now
 * shown to hit a plain DATE column too. The correct read of that Date object
 * is its own LOCAL calendar parts (`getFullYear`/`getMonth`/`getDate`) —
 * because that is exactly how it was constructed, the round-trip is exact.
 */
function toComparableCorrectionText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value);
}

/**
 * Pure decision (unit-testable without a DB): should this ONE field-level
 * correction from a hard-coded table be skipped as stale? Checks, in the
 * order given in issue #422:
 *   (a) the row's status is LISTED or CLOSED — a terminal row's own recorded
 *       facts outrank a dated citation, however well-corroborated at the time;
 *   (b) `field_sources` shows a source for this field newer than the
 *       citation — something has updated the field since the citation was
 *       captured, whether or not the row itself is terminal;
 *   (c) the current value differs from the value the citation was taken
 *       against (`assumedFromValue`) — the row has moved since. A table
 *       entry carrying no recorded `from` value can never pass this check:
 *       "unknown" is not evidence the citation still applies.
 */
export function decideStaleCorrectionSkip(input: StaleCorrectionCheckInput): StaleCorrectionDecision {
  const status = (input.status ?? '').toUpperCase();
  if (status && TERMINAL_STATUSES.has(status)) {
    return {
      skip: true,
      reason:
        `row status is ${status} — refusing a hard-coded correction citing ${input.citationDate} ` +
        'against a terminal-status row (#422)',
    };
  }
  if (input.latestSourceDate && input.latestSourceDate > input.citationDate) {
    return {
      skip: true,
      reason:
        `field_sources shows a newer source (${input.latestSourceDate}) than the correction's ` +
        `citation (${input.citationDate}) — the correction is stale (#422)`,
    };
  }
  if (input.assumedFromValue === undefined) {
    return {
      skip: true,
      reason:
        "correction table entry carries no recorded 'from' value to verify against the row's " +
        'current value — cannot confirm the citation still applies (#422)',
    };
  }
  const assumedText = toComparableCorrectionText(input.assumedFromValue);
  const currentText = toComparableCorrectionText(input.currentValue);
  if (assumedText !== currentText) {
    return {
      skip: true,
      reason:
        `current value (${JSON.stringify(input.currentValue)}) differs from the value ` +
        `(${JSON.stringify(input.assumedFromValue)}) the citation (${input.citationDate}) was taken ` +
        'against — the row has changed since (#422)',
    };
  }
  return { skip: false };
}

/**
 * The most recent `field_sources.updated_at` for one (ipoId, field), as an
 * ISO `YYYY-MM-DD` date string, or null when there is no such row. Feeds
 * `decideStaleCorrectionSkip`'s check (b); never a second implementation of
 * the `field_sources` lookup shape (`readFieldSource`, above).
 */
export async function queryLatestFieldSourceDate(
  txLike: SelectInsertLike,
  params: { ipoId: string; tableName?: string; fieldName: string }
): Promise<string | null> {
  const rows = await txLike
    .select({ updatedAt: schema.fieldSources.updatedAt })
    .from(schema.fieldSources)
    .where(
      and(
        eq(schema.fieldSources.ipoId, params.ipoId),
        eq(schema.fieldSources.tableName, params.tableName ?? 'ipos'),
        eq(schema.fieldSources.fieldName, params.fieldName)
      )
    )
    .limit(1);
  const updatedAt = rows[0]?.updatedAt;
  if (!updatedAt) return null;
  const asDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt as unknown as string);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toISOString().slice(0, 10);
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
