/**
 * Item 3, slice S2 (#731). Re-rank every non-terminal `ipo_field_plan` row
 * whose `manifest_version` is older than the current registry to the current
 * policy, and plan the SME rows the version-1 manifest never planned (the
 * generator's `ON CONFLICT ... DO NOTHING` insert never revisits a row once
 * it exists, so a manifest bump alone never re-ranks anything -- this tool
 * is the reconciliation step).
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
 *      the table lacks entirely (the SME rows). `ON CONFLICT ... DO NOTHING`
 *      means this can never touch an existing row -- it only adds rows that
 *      truly do not exist yet.
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
import { openRepairDb, queryCurrentDatabase, type ExecuteLike } from './lib/repair-tool.js';

const TOOL = 'repair-plan-rows-to-manifest-version';

export interface Cli {
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

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    process.exit(1);
    return;
  }

  const actual = await queryCurrentDatabase(db as ExecuteLike);
  if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
    console.error(`${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    process.exit(1);
    return;
  }

  const schemaCheck = await hasFieldPlanSchema(db as ExecuteLike);
  if (!schemaCheck.hasTable || !schemaCheck.hasVersionColumn) {
    console.error(
      `${TOOL}: refusing — connected to "${actual}" but ${
        !schemaCheck.hasTable
          ? 'the "ipo_field_plan" table does not exist (prod has none until #713 lands)'
          : '"ipo_field_plan.manifest_version" does not exist'
      }. No read or write attempted.`
    );
    process.exit(1);
    return;
  }

  await openRepairDb(db as ExecuteLike, { apply: cli.apply, allowProd: cli.allowProd, toolName: TOOL });
  console.log(`${TOOL}: schema check passed (ipo_field_plan + manifest_version present) on "${actual}"`);

  const manifest = loadFieldManifest();
  const currentVersion = manifest.version;
  console.log(`${TOOL}: current manifest version = ${currentVersion}`);

  const repo = new IpoFieldPlanRepository(db as never, getRedisClient() as never);

  const staleRows = await repo.listBelowVersion(currentVersion);
  const plans = staleRows.map((r) => planRankUpdate(r, currentVersion, manifest));
  const changing = plans.filter((p) => p.changed);

  console.log(`\nRANK PLAN (${changing.length} row(s) will change of ${plans.length} non-terminal row(s) below version ${currentVersion}):`);
  for (const p of changing.slice(0, 50)) console.log(formatPlan(p));
  if (changing.length > 50) console.log(`  ... and ${changing.length - 50} more`);

  // Every IPO that has at least one stale row is also checked for SME rows
  // the current manifest plans but the table lacks entirely -- the class
  // includes rows the generator never wrote, not only rows it wrote wrong.
  const ipoIds = [...new Set(staleRows.map((r) => r.ipoId))];
  const ipoById = new Map(staleRows.map((r) => [r.ipoId, r]));
  const missingRows: {
    ipoId: string;
    ipoSlug: string | null;
    tableName: string;
    fieldName: string;
    rank1Source: string | null;
    rank2Source: string | null;
    rank3Source: string | null;
    policyOrigin: string;
  }[] = [];

  for (const ipoId of ipoIds) {
    const sample = ipoById.get(ipoId)!;
    const ipoType = resolveIpoTypeKey({ id: ipoId, segment: sample.ipoSegment, listingExchanges: sample.ipoListingExchanges });
    const existingKeys = new Set(
      staleRows.filter((r) => r.ipoId === ipoId).map((r) => `${r.tableName}::${r.rowKey}::${r.fieldName}`)
    );
    // Also fold in rows already at the current version -- those must not be
    // re-inserted either. listBelowVersion only returns stale rows, so a
    // second, targeted read closes that gap.
    const currentRows = await (db as unknown as ExecuteLike).execute(sql`
      SELECT table_name, row_key, field_name FROM ipo_field_plan WHERE ipo_id = ${ipoId}::uuid
    `);
    const currentRowsList = (currentRows as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
    for (const r of currentRowsList) existingKeys.add(`${r.table_name}::${r.row_key}::${r.field_name}`);

    for (const [fieldKey, entry] of Object.entries(manifest.fields)) {
      const dot = fieldKey.indexOf('.');
      const tableName = fieldKey.slice(0, dot);
      const fieldName = fieldKey.slice(dot + 1);
      const policy = resolveFieldSourcePolicy({ table: tableName, column: fieldName, ipoType }, { manifest });
      if (policy.na) continue;
      const key = `${tableName}::::${fieldName}`;
      if (existingKeys.has(key)) continue;
      missingRows.push({
        ipoId,
        ipoSlug: sample.ipoSlug,
        tableName,
        fieldName,
        rank1Source: policy.ranks[0] ?? null,
        rank2Source: policy.ranks[1] ?? null,
        rank3Source: policy.ranks[2] ?? null,
        policyOrigin: policyOriginString(policy.origin),
      });
    }
  }

  console.log(`\nMISSING ROWS PLAN (${missingRows.length} row(s) will be inserted for ${ipoIds.length} IPO(s) with stale rows):`);
  for (const m of missingRows.slice(0, 50)) {
    console.log(`  ${m.ipoSlug ?? m.ipoId} :: ${m.tableName}.${m.fieldName} -> [${[m.rank1Source, m.rank2Source, m.rank3Source].filter(Boolean).join(',')}]`);
  }
  if (missingRows.length > 50) console.log(`  ... and ${missingRows.length - 50} more`);

  if (changing.length === 0 && missingRows.length === 0) {
    console.log(`\n${TOOL}: nothing to repair on "${actual}".`);
    process.exit(0);
    return;
  }

  if (!cli.apply) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply --expect-db ${actual} to re-rank ${changing.length} row(s) and insert ${missingRows.length} row(s).`
    );
    process.exit(0);
    return;
  }

  const { updated } = await repo.updateRanksForVersion(
    changing.map((p) => ({
      id: p.id,
      rank1Source: p.afterRank1,
      rank2Source: p.afterRank2,
      rank3Source: p.afterRank3,
      manifestVersion: p.afterVersion,
      policyOrigin: p.afterPolicyOrigin,
    }))
  );

  const { inserted } = await repo.upsertGeneratedRows(
    missingRows.map((m) => ({
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

  console.log(`\n${TOOL}: re-ranked ${updated} row(s), inserted ${inserted} row(s) on "${actual}".`);
  if (updated !== changing.length) {
    console.error(
      `${TOOL}: WARNING — planned to re-rank ${changing.length} row(s) but only ${updated} were updated (some rows likely became SUPPLIED concurrently, correctly excluded by the WHERE clause). Re-run to confirm the remainder converges.`
    );
  }
  process.exit(0);
}

const isMain = import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().catch((e) => {
    console.error(`${TOOL}: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  });
}
