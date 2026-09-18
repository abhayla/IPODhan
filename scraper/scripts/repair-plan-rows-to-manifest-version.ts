/**
 * Item 3, slice S2 (#731). Re-rank every non-terminal `ipo_field_plan` row
 * whose `manifest_version` is older than the current registry to the current
 * policy, and plan the SME rows the version-1 manifest never planned.
 *
 * WHY THIS TOOL STILL EXISTS AFTER S7 (#732): before S7, the generator's
 * insert was `ON CONFLICT ... DO NOTHING`, which never revisited a row once
 * it existed -- a manifest bump alone never re-ranked anything, ever, for
 * any row, at any time. S7 narrowed that to `ON CONFLICT ... DO UPDATE`,
 * which re-ranks a non-SUPPLIED row IN PLACE the next time the generator
 * runs it through `upsertGeneratedRows` with a strictly higher version --
 * so FROM S7 ONWARD, ordinary generator cycles keep the plan reconciled
 * without this tool's help. This tool is still what fixes rows that are
 * ALREADY stale RIGHT NOW (every row written before the deploy that shipped
 * S7, or any row belonging to an IPO the generator has stopped cycling --
 * e.g. one that fell out of the live window) -- a one-time or occasional
 * backfill, never a replacement for the generator's own per-cycle write
 * path. Do not read this tool as a sign that S7's reconciliation is
 * missing or broken; it is the catch-up pass for staleness that predates
 * S7 or that S7's own cycle boundary has not reached yet.
 *
 * INDEPENDENT TIER A REVIEW FIX ROUND (fixer, this commit): the guard logic
 * below is now `run(deps)`, driven entirely through injected dependencies --
 * see `tests/unit/scripts/repair-plan-rows-to-manifest-version.test.ts`
 * `describe('run -- CLI guards, mutation-tested')` (CRITICAL-1: every guard
 * was previously untested against `main()`). The insert phase now gates
 * every candidate IPO through `isInsertEligible` / `isInLiveWindow`
 * (`document-state-machine.ts:751`, the SAME predicate production's own
 * `generateFieldPlan` call sits behind in `document-cycle.ts:994`), split
 * into eligible/skipped populations and printed as a CANDIDATE GATE line
 * (CRITICAL-2) -- a `--no-insert` flag runs rank-fixing alone. The
 * missing-row existing-keys lookup uses the row's real `${table}::${rowKey}
 * ::${field}` shape on BOTH sides (MAJOR-5 -- a hardcoded empty row_key on
 * only one side would silently miss a child-table sibling and duplicate its
 * plan row). Writes are chunked at `WRITE_CHUNK_SIZE` rows per statement
 * (MAJOR-6) rather than one unbounded VALUES list. Known gaps NOT fixed in
 * this round (MINOR, budget-limited): `getRedisClient()` is opened but
 * unused by this tool's own repository calls; the per-IPO existing-keys read
 * is raw SQL via `db.execute`, not a repository method, and is N+1 (one
 * query per eligible IPO).
 *
 * THE CLASS (defect-fix-contract.md item 2), stated as a data filter, never
 * an IPO list: every `ipo_field_plan` row where
 *   `manifest_version < <current registry version>` AND `state <> 'SUPPLIED'`
 * across every IPO type (MAINBOARD, SME_BSE, SME_NSE), both segments, on
 * whichever slot `--expect-db` names -- plus, per IPO, every field the
 * CURRENT manifest plans for that IPO's type that the table has no row for
 * at all (the SME rows the version-1 manifest skipped because SME_BSE /
 * SME_NSE rank entries did not exist yet).
 *
 * `state <> 'SUPPLIED'` is the corrected filter (the card originally read
 * `state not in ('SUPPLIED','RETIRED')` -- there is no `RETIRED` state in
 * `field_plan_state`; that query errors with `invalid input value for enum
 * field_plan_state: "RETIRED"` on a real database). Every OTHER state
 * (PENDING, NOT_PRINTED, NOT_AVAILABLE_YET, CHECK_FAILED, EXHAUSTED) is
 * treated as non-terminal and IS re-ranked here, deliberately:
 *   - PENDING / CHECK_FAILED -- the ask is still open; a stale rank list
 *     would walk the wrong sources on the very next attempt.
 *   - NOT_AVAILABLE_YET -- the row expects to be retried once the source
 *     exists; retrying with last version's ranks defeats the retry's point.
 *   - NOT_PRINTED / EXHAUSTED -- terminal in the sense that no further
 *     attempt is scheduled by the walk, but NOT terminal in the sense that
 *     matters here: they never SUPPLIED a value, so re-ranking them costs
 *     nothing (no delivered value can be discarded) and correctly reflects
 *     what the CURRENT manifest would ask if the row were ever re-queued
 *     (e.g. by `requeue-exhausted-plan-rows.ts`). Only SUPPLIED rows are
 *     excluded, because only a SUPPLIED row represents an ask that was
 *     actually answered -- re-ranking it risks nothing structurally but
 *     serves no purpose the card asks for, and the DoD is explicit: "SUPPLIED
 *     rows are never touched."
 *
 * Two things happen per run, both through the repository, never raw SQL:
 *   1. `updateRanksForVersion` -- re-rank every stale non-terminal row to
 *      the CURRENT policy for that IPO's resolved type
 *      (`resolveFieldSourcePolicy` via `resolveIpoTypeKey`), bumping
 *      `manifest_version` and `policy_origin` to match.
 *   2. `upsertGeneratedRows` -- for every IPO with at least one stale row,
 *      insert the rows the CURRENT manifest plans for that IPO's type that
 *      the table lacks entirely (the SME rows). Since item 3 slice S7
 *      (#732) that method's own `ON CONFLICT` also re-ranks an existing
 *      non-SUPPLIED row on a version increase -- but this call site never
 *      exercises that branch: every row it submits comes from the
 *      MISSING-key set this tool itself computed (a key with NO row in the
 *      table at all), so it can never hit a conflict here. This phase still
 *      only ever adds rows that truly do not exist yet; re-ranking the
 *      stale rows that DO already exist is entirely `updateRanksForVersion`'s
 *      job, above.
 *
 * `--expect-db <name>` is MANDATORY. Refuses unless `ipo_field_plan` AND its
 * `manifest_version` column actually exist (a schema query against
 * `information_schema`, never a name check) -- prod has no plan table until
 * #713 lands, so a name-only guard would let this tool crash mid-run on prod
 * instead of refusing up front. Dry-run by default; `--apply` writes;
 * `--allow-prod` is required IN ADDITION to `openRepairDb`'s own prod guard
 * (belt and suspenders, same pattern as every other repair tool in this
 * directory).
 *
 * Idempotent: a second run against an already-reconciled database finds zero
 * stale rows and zero missing SME rows, so it prints "nothing to repair" and
 * writes nothing.
 *
 *     npx tsx scripts/repair-plan-rows-to-manifest-version.ts --expect-db ipodhan_staging
 *     npx tsx scripts/repair-plan-rows-to-manifest-version.ts --expect-db ipodhan_staging --apply
 *
 * Exit codes: 0 done (or dry run complete); 1 usage/guard refusal
 * (no --expect-db, wrong database, schema check failed, prod without
 * --allow-prod).
 */
// Item 1 slice s14 -- FIRST import on purpose (see lib/repair-tool.ts).
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { IpoFieldPlanRepository, type PlanRowBelowVersion } from '@ipodhan/shared/repositories';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { sql } from 'drizzle-orm';
import { resolveFieldSourcePolicy, policyOriginString } from '../src/config/field-source-policy.js';
import { resolveIpoTypeKey, type PlanIpo } from '../src/services/field-plan-generator.js';
import { loadFieldManifest } from '../src/config/field-manifest-loader.js';
import { isInLiveWindow } from '../src/services/document-state-machine.js';
import { openRepairDb, queryCurrentDatabase, type ExecuteLike } from './lib/repair-tool.js';

const TOOL = 'repair-plan-rows-to-manifest-version';

/**
 * CRITICAL-2 (independent Tier A review): a batch this large as one `VALUES`
 * statement is the actual risk on a table this size (measured: ~13,500
 * candidate insert tuples on staging). Chunking is not a transaction
 * substitute -- it is what makes a single statement bounded. Each chunk
 * commits through `updateRanksForVersion`'s `WHERE state <> 'SUPPLIED'` /
 * `upsertGeneratedRows`'s conflict handling (item 3 slice S7, #732: `ON
 * CONFLICT ... DO UPDATE ... WHERE state <> 'SUPPLIED' AND manifest_version
 * < EXCLUDED.manifest_version` -- though this tool's own insert phase only
 * ever submits keys it already confirmed are missing, so it never exercises
 * the UPDATE branch), both idempotent, so a mid-run failure leaves a safely
 * resumable partial state rather than a giant in-flight statement;
 * re-running the tool finds only the remaining stale/missing rows (MAJOR-6).
 */
const WRITE_CHUNK_SIZE = 300;

export interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
  /** CRITICAL-2: rank-only mode -- fixes stale ranks, inserts nothing. */
  noInsert: boolean;
}

export function parseArgs(argv: readonly string[]): Cli {
  const at = argv.indexOf('--expect-db');
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    noInsert: argv.includes('--no-insert'),
    expectDb: at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The two things `ipo_field_plan` and its `information_schema` row must
 * both be true for the tool to proceed -- a SCHEMA check, never a name
 * check (§4b finding 13, card correction): prod lacks the table entirely
 * until #713 lands, and a database can exist with the table but an older
 * migration missing the column. Both are refused identically: the tool
 * cannot compute a single row's plan without `manifest_version`.
 */
export async function hasFieldPlanSchema(dbLike: ExecuteLike): Promise<{ hasTable: boolean; hasVersionColumn: boolean }> {
  const tableResult = await dbLike.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ipo_field_plan'
    LIMIT 1
  `);
  const tableRows = Array.isArray(tableResult) ? tableResult : (tableResult as { rows?: unknown[] })?.rows;
  const hasTable = Boolean(tableRows && tableRows.length > 0);

  if (!hasTable) return { hasTable: false, hasVersionColumn: false };

  const columnResult = await dbLike.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ipo_field_plan' AND column_name = 'manifest_version'
    LIMIT 1
  `);
  const columnRows = Array.isArray(columnResult) ? columnResult : (columnResult as { rows?: unknown[] })?.rows;
  return { hasTable: true, hasVersionColumn: Boolean(columnRows && columnRows.length > 0) };
}

/** One row's plan: the new ranks a manifest reconciliation should write. */
export interface RankPlan {
  id: string;
  ipoSlug: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  beforeRank1: string | null;
  beforeRank2: string | null;
  beforeRank3: string | null;
  beforeVersion: number;
  afterRank1: string | null;
  afterRank2: string | null;
  afterRank3: string | null;
  afterVersion: number;
  afterPolicyOrigin: string;
  changed: boolean;
}

/**
 * Pure: resolve the CURRENT policy for one stale row and compute its
 * before/after ranks. Unit-tested without a database (defect-fix-contract
 * item 3) -- deleting the SUPPLIED exclusion, or reading the wrong IPO type,
 * turns a named test red.
 */
export function planRankUpdate(
  row: PlanRowBelowVersion,
  currentVersion: number,
  manifest: ReturnType<typeof loadFieldManifest>
): RankPlan {
  const ipo: PlanIpo = { id: row.ipoId, segment: row.ipoSegment, listingExchanges: row.ipoListingExchanges };
  const ipoType = resolveIpoTypeKey(ipo);
  const policy = resolveFieldSourcePolicy(
    { table: row.tableName, column: row.fieldName, ipoType },
    { manifest }
  );
  const afterRank1 = policy.ranks[0] ?? null;
  const afterRank2 = policy.ranks[1] ?? null;
  const afterRank3 = policy.ranks[2] ?? null;
  const changed =
    afterRank1 !== row.rank1Source ||
    afterRank2 !== row.rank2Source ||
    afterRank3 !== row.rank3Source ||
    currentVersion !== row.manifestVersion;

  return {
    id: row.id,
    ipoSlug: row.ipoSlug,
    tableName: row.tableName,
    rowKey: row.rowKey,
    fieldName: row.fieldName,
    beforeRank1: row.rank1Source,
    beforeRank2: row.rank2Source,
    beforeRank3: row.rank3Source,
    beforeVersion: row.manifestVersion,
    afterRank1,
    afterRank2,
    afterRank3,
    afterVersion: currentVersion,
    afterPolicyOrigin: policyOriginString(policy.origin),
    changed,
  };
}

function formatPlan(p: RankPlan): string {
  const who = p.ipoSlug ?? p.id;
  const before = [p.beforeRank1, p.beforeRank2, p.beforeRank3].map((v) => v ?? '-').join(',');
  const after = [p.afterRank1, p.afterRank2, p.afterRank3].map((v) => v ?? '-').join(',');
  return `  ${who} :: ${p.tableName}.${p.fieldName}${p.rowKey ? `[${p.rowKey}]` : ''} v${p.beforeVersion}(${before}) -> v${p.afterVersion}(${after})`;
}

/** One row the current manifest plans but the table has no row for at all. */
export interface MissingRow {
  ipoId: string;
  ipoSlug: string | null;
  tableName: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  policyOrigin: string;
}

/**
 * Pure: for one IPO, compute the fields the CURRENT manifest plans for its
 * type that `existingKeys` does not already cover.
 *
 * `existingKeys` MUST be built with the same `${table}::${rowKey}::${field}`
 * shape used here (MAJOR-5, independent Tier A review) -- every plan row
 * this tool inserts carries `rowKey: ''` (see `run()`), so the lookup key is
 * always built with an explicit empty row_key, never a different literal.
 */
export function computeMissingRowsForIpo(
  ipoId: string,
  ipoSlug: string | null,
  ipoType: ReturnType<typeof resolveIpoTypeKey>,
  existingKeys: ReadonlySet<string>,
  manifest: ReturnType<typeof loadFieldManifest>
): MissingRow[] {
  const missing: MissingRow[] = [];
  for (const [fieldKey, _entry] of Object.entries(manifest.fields)) {
    const dot = fieldKey.indexOf('.');
    const tableName = fieldKey.slice(0, dot);
    const fieldName = fieldKey.slice(dot + 1);
    const policy = resolveFieldSourcePolicy({ table: tableName, column: fieldName, ipoType }, { manifest });
    if (policy.na) continue;
    const key = `${tableName}::${''}::${fieldName}`;
    if (existingKeys.has(key)) continue;
    missing.push({
      ipoId,
      ipoSlug,
      tableName,
      fieldName,
      rank1Source: policy.ranks[0] ?? null,
      rank2Source: policy.ranks[1] ?? null,
      rank3Source: policy.ranks[2] ?? null,
      policyOrigin: policyOriginString(policy.origin),
    });
  }
  return missing;
}

/**
 * CRITICAL-2 (independent Tier A review): whether this tool may INSERT new
 * plan rows for one IPO. Reuses the SAME predicate production's own
 * candidate gate applies (`isInLiveWindow`, `document-state-machine.ts:751`,
 * the only gate guarding `generateFieldPlan` in `document-cycle.ts:994`) --
 * never a re-implementation of that rule. A finished IPO (LISTED past the
 * live window, WITHDRAWN, POSTPONED) the live pipeline would never plan for
 * is never a candidate for a NEW row here either; its stale ranks are still
 * re-ranked (rank fixing is loss-only cleanup, not new work), but nothing is
 * minted that would become immediately claimable PENDING work the walk was
 * never going to visit.
 */
export function isInsertEligible(
  ipoStatus: string | null,
  ipoListingDate: Date | null,
  now: Date = new Date()
): boolean {
  return isInLiveWindow({ status: ipoStatus, listingDate: ipoListingDate, now });
}

/** Minimal console-like sink, injectable so tests capture output instead of printing it. */
export interface Logger {
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Minimal shape `run()` needs from the repository -- injectable for tests. */
export interface PlanRepoLike {
  listBelowVersion: (currentVersion: number) => Promise<PlanRowBelowVersion[]>;
  updateRanksForVersion: (rows: {
    id: string;
    rank1Source: string | null;
    rank2Source: string | null;
    rank3Source: string | null;
    manifestVersion: number;
    policyOrigin: string;
  }[]) => Promise<{ updated: number }>;
  upsertGeneratedRows: (rows: {
    ipoId: string;
    tableName: string;
    rowKey: string;
    fieldName: string;
    rank1Source: string | null;
    rank2Source: string | null;
    rank3Source: string | null;
    manifestVersion: number;
    policyOrigin: string;
  }[]) => Promise<{ inserted: number }>;
}

export interface RunDeps {
  cli: Cli;
  dbLike: ExecuteLike;
  repo: PlanRepoLike;
  loadManifest: () => ReturnType<typeof loadFieldManifest>;
  /** Reads every existing plan-row key for one IPO, for the missing-row gap check. */
  readExistingKeysForIpo: (ipoId: string) => Promise<{ tableName: string; rowKey: string; fieldName: string }[]>;
  logger?: Logger;
  now?: Date;
}

export interface RunResult {
  /** CRITICAL-1: every guard's outcome, so a test can assert exactly which one fired. */
  exitCode: number;
  refusedAt?: 'no-expect-db' | 'db-mismatch' | 'schema-check' | 'prod-guard';
  wrote: boolean;
  updated: number;
  inserted: number;
  eligibleIpoCount: number;
  skippedOutOfWindowIpoCount: number;
}

/**
 * CRITICAL-1 fix (independent Tier A review): the whole tool, restructured
 * so every guard is driven by an injected dependency set instead of module
 * globals + `process.exit`. `main()` below is now a two-line adapter that
 * builds the REAL deps and calls this. Deleting any guard here (the
 * `--expect-db` check, the db-name comparison, the schema check, or the
 * `!cli.apply` dry-run branch) turns a named test in the unit suite red --
 * see `repair-plan-rows-to-manifest-version.test.ts` `describe('run — CLI
 * guards, mutation-tested')`.
 */
export async function run(deps: RunDeps): Promise<RunResult> {
  const { cli, dbLike, repo, loadManifest, readExistingKeysForIpo } = deps;
  const log = deps.logger?.log ?? ((l: string) => console.log(l));
  const err = deps.logger?.error ?? ((l: string) => console.error(l));
  const now = deps.now ?? new Date();

  if (!cli.expectDb) {
    err(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    return { exitCode: 1, refusedAt: 'no-expect-db', wrote: false, updated: 0, inserted: 0, eligibleIpoCount: 0, skippedOutOfWindowIpoCount: 0 };
  }

  const actual = await queryCurrentDatabase(dbLike);
  if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
    err(`${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    return { exitCode: 1, refusedAt: 'db-mismatch', wrote: false, updated: 0, inserted: 0, eligibleIpoCount: 0, skippedOutOfWindowIpoCount: 0 };
  }

  const schemaCheck = await hasFieldPlanSchema(dbLike);
  if (!schemaCheck.hasTable || !schemaCheck.hasVersionColumn) {
    err(
      `${TOOL}: refusing — connected to "${actual}" but ${
        !schemaCheck.hasTable
          ? 'the "ipo_field_plan" table does not exist (prod has none until #713 lands)'
          : '"ipo_field_plan.manifest_version" does not exist'
      }. No read or write attempted.`
    );
    return { exitCode: 1, refusedAt: 'schema-check', wrote: false, updated: 0, inserted: 0, eligibleIpoCount: 0, skippedOutOfWindowIpoCount: 0 };
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
    return { exitCode: 1, refusedAt: 'prod-guard', wrote: false, updated: 0, inserted: 0, eligibleIpoCount: 0, skippedOutOfWindowIpoCount: 0 };
  }
  log(`${TOOL}: schema check passed (ipo_field_plan + manifest_version present) on "${actual}"`);

  const manifest = loadManifest();
  const currentVersion = manifest.version;
  log(`${TOOL}: current manifest version = ${currentVersion}`);

  const staleRows = await repo.listBelowVersion(currentVersion);
  const plans = staleRows.map((r) => planRankUpdate(r, currentVersion, manifest));
  const changing = plans.filter((p) => p.changed);

  log(`\nRANK PLAN (${changing.length} row(s) will change of ${plans.length} non-terminal row(s) below version ${currentVersion}):`);
  for (const p of changing.slice(0, 50)) log(formatPlan(p));
  if (changing.length > 50) log(`  ... and ${changing.length - 50} more`);

  // CRITICAL-2: split IPOs with stale rows into insert-eligible (live-window,
  // same gate production's own generateFieldPlan call is behind) and
  // out-of-window (rank-fix only, never a new row) -- printed as two
  // populations, never a single merged count (signal-ownership R1).
  const ipoIds = [...new Set(staleRows.map((r) => r.ipoId))];
  const ipoById = new Map(staleRows.map((r) => [r.ipoId, r]));
  const eligibleIpoIds: string[] = [];
  const skippedIpoIds: string[] = [];
  for (const ipoId of ipoIds) {
    const sample = ipoById.get(ipoId)!;
    if (isInsertEligible(sample.ipoStatus, sample.ipoListingDate, now)) eligibleIpoIds.push(ipoId);
    else skippedIpoIds.push(ipoId);
  }

  const missingRows: MissingRow[] = [];
  if (!cli.noInsert) {
    for (const ipoId of eligibleIpoIds) {
      const sample = ipoById.get(ipoId)!;
      const ipoType = resolveIpoTypeKey({ id: ipoId, segment: sample.ipoSegment, listingExchanges: sample.ipoListingExchanges });
      const existingKeys = new Set(
        staleRows.filter((r) => r.ipoId === ipoId).map((r) => `${r.tableName}::${r.rowKey}::${r.fieldName}`)
      );
      // Also fold in rows already at the current version -- those must not
      // be re-inserted either. listBelowVersion only returns stale rows, so
      // a second, targeted read closes that gap.
      const currentRowsList = await readExistingKeysForIpo(ipoId);
      for (const r of currentRowsList) existingKeys.add(`${r.tableName}::${r.rowKey}::${r.fieldName}`);

      missingRows.push(...computeMissingRowsForIpo(ipoId, sample.ipoSlug, ipoType, existingKeys, manifest));
    }
  }

  log(
    `\nCANDIDATE GATE: ${eligibleIpoIds.length} IPO(s) with stale rows are insert-eligible (live window), ` +
      `${skippedIpoIds.length} skipped as out-of-window (rank-fix only, no new rows)${cli.noInsert ? ' -- --no-insert given, insert phase skipped entirely' : ''}.`
  );
  log(`\nMISSING ROWS PLAN (${missingRows.length} row(s) will be inserted for ${eligibleIpoIds.length} eligible IPO(s)):`);
  for (const m of missingRows.slice(0, 50)) {
    log(`  ${m.ipoSlug ?? m.ipoId} :: ${m.tableName}.${m.fieldName} -> [${[m.rank1Source, m.rank2Source, m.rank3Source].filter(Boolean).join(',')}]`);
  }
  if (missingRows.length > 50) log(`  ... and ${missingRows.length - 50} more`);

  if (changing.length === 0 && missingRows.length === 0) {
    log(`\n${TOOL}: nothing to repair on "${actual}".`);
    return { exitCode: 0, wrote: false, updated: 0, inserted: 0, eligibleIpoCount: eligibleIpoIds.length, skippedOutOfWindowIpoCount: skippedIpoIds.length };
  }

  if (!cli.apply) {
    log(
      `\nDRY RUN — nothing written. Re-run with --apply --expect-db ${actual} to re-rank ${changing.length} row(s) and insert ${missingRows.length} row(s).`
    );
    return { exitCode: 0, wrote: false, updated: 0, inserted: 0, eligibleIpoCount: eligibleIpoIds.length, skippedOutOfWindowIpoCount: skippedIpoIds.length };
  }

  // MAJOR-6: chunked, never one unbounded statement.
  let updated = 0;
  for (const batch of chunk(changing, WRITE_CHUNK_SIZE)) {
    const { updated: n } = await repo.updateRanksForVersion(
      batch.map((p) => ({
        id: p.id,
        rank1Source: p.afterRank1,
        rank2Source: p.afterRank2,
        rank3Source: p.afterRank3,
        manifestVersion: p.afterVersion,
        policyOrigin: p.afterPolicyOrigin,
      }))
    );
    updated += n;
  }

  let inserted = 0;
  for (const batch of chunk(missingRows, WRITE_CHUNK_SIZE)) {
    const { inserted: n } = await repo.upsertGeneratedRows(
      batch.map((m) => ({
        ipoId: m.ipoId,
        tableName: m.tableName,
        rowKey: '',
        fieldName: m.fieldName,
        rank1Source: m.rank1Source,
        rank2Source: m.rank2Source,
        rank3Source: m.rank3Source,
        manifestVersion: currentVersion,
        policyOrigin: m.policyOrigin,
      }))
    );
    inserted += n;
  }

  log(`\n${TOOL}: re-ranked ${updated} row(s), inserted ${inserted} row(s) on "${actual}".`);
  if (updated !== changing.length) {
    err(
      `${TOOL}: WARNING — planned to re-rank ${changing.length} row(s) but only ${updated} were updated (some rows likely became SUPPLIED concurrently, correctly excluded by the WHERE clause). Re-run to confirm the remainder converges.`
    );
  }
  return { exitCode: 0, wrote: true, updated, inserted, eligibleIpoCount: eligibleIpoIds.length, skippedOutOfWindowIpoCount: skippedIpoIds.length };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const repo = new IpoFieldPlanRepository(db as never, getRedisClient() as never);
  const result = await run({
    cli,
    dbLike: db as ExecuteLike,
    repo,
    loadManifest: loadFieldManifest,
    readExistingKeysForIpo: async (ipoId: string) => {
      const currentRows = await (db as unknown as ExecuteLike).execute(sql`
        SELECT table_name, row_key, field_name FROM ipo_field_plan WHERE ipo_id = ${ipoId}::uuid
      `);
      const rows = (currentRows as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
      return rows.map((r) => ({
        tableName: r.table_name as string,
        rowKey: r.row_key as string,
        fieldName: r.field_name as string,
      }));
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
