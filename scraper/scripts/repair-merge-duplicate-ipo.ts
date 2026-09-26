/**
 * repair-merge-duplicate-ipo.ts — merge two `ipos` rows that are one IPO
 * (finding F-55), routed through the shared write path.
 *
 * WHY THIS EXISTS. On 2026-09-09 production carried TWO rows for Asset
 * Reconstruction Company (India) Limited — both opening 9 September, both
 * priced 132-139 — so the site showed one mainboard IPO twice with different
 * issue sizes. The shipped name normaliser folds "Limited"/"Ltd"/"Pvt Ltd"
 * but NOT "Company" against "Co.", so the two names never collided and no
 * tier of the identity check fired. Same class as the second "Rays of
 * Belief" row (2026-09-03). The normaliser is the class fix; this tool
 * repairs rows the gap already created — any pair, not just this one.
 *
 * This is the successor to `scripts/merge-duplicate-ipo.mjs`, which wrote
 * `ipos` with raw SQL from a bare `pg.Client` outside the shared write path
 * and failed the R0 write ratchet (config/write-ratchet-baseline.json is
 * shrink-only — a NEW raw-SQL writer of `ipos` is refused, not grandfathered).
 * All the actual merge logic (child-table discovery from information_schema,
 * reverse-dependency ordering, repoint-vs-delete classification, provenance
 * writes) now lives in `IPORepository.mergeDuplicateInto`
 * (packages/shared/src/repositories/ipo-repository.ts), which writes `ipos`
 * only through the drizzle query builder (`this.db.update(ipos)` /
 * `.delete(ipos)`) — the pattern the ratchet already allows for every
 * repository. This CLI is a thin wrapper: parse flags, open the guarded
 * connection, print the plan, apply if asked, write the backup + ledger.
 *
 *   npx tsx scripts/repair-merge-duplicate-ipo.ts --keep <uuid> --drop <uuid>              dry run (default)
 *   ... --apply                          write (refused on prod without --allow-prod)
 *   ... --allow-prod                     acknowledge the target is the production database
 *   ... --set-issue-size <rupees>        correct the survivor's issue size (source-backed only)
 *   ... --issue-size-note "<evidence>"   what proves that number; stored in the provenance row
 *   ... --force-different-name           proceed when the two names do not fold together
 *   ... --unmerge <merge-log-id> --expect-db <name> [--apply] [--partial] [--force-fields a,b]
 *                                        undo one logged merge (OD-92, spec §2.3.3.3; dry run by default)
 *
 * Target database: the tunnel env (DATABASE_HOST/DATABASE_PORT/... or
 * DATABASE_URL) that `@ipodhan/shared`'s `db` pool is built from — see
 * docs/ops/prod-ops-recipes.md §1 for the tunnel recipe. Point it at
 * ipodhan_staging to rehearse.
 *
 * EXIT CODES: 0 planned/applied cleanly · 1 refused (the reason is printed,
 * including the prod guard and every eligibility check) · 2 the script broke,
 * OR the write committed but a post-apply `VERIFY:` readback check failed.
 */
import { db, getRedisClient, IPORepository, type MergeDuplicateResult, type UnmergeResult } from '@ipodhan/shared';
import { DatabaseError, ProdWriteRefusedError } from '@ipodhan/shared/errors/repository-errors';
import {
  buildCarryFieldInputs,
  buildProvenanceMap,
  planCarryFields,
  verifyMergeReadback,
  type CarryFieldPatch,
  type MergeReadbackCheck,
  type ProvenanceRow,
} from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { createNoopRedisClient, guardCacheInvalidation, openRepairDb, writeLedgerFile } from './lib/repair-tool.js';
import { notifyOwner, flushOwnerNotify } from '../src/services/owner-notify.js';

const args = process.argv.slice(2);
const arg = (n: string): string | null => {
  const i = args.indexOf(n);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const APPLY = args.includes('--apply');
const ALLOW_PROD = args.includes('--allow-prod');
const FORCE_NAME = args.includes('--force-different-name');
const KEEP = arg('--keep');
const DROP = arg('--drop');
const SET_ISSUE_SIZE = arg('--set-issue-size');
const ISSUE_SIZE_NOTE = arg('--issue-size-note');
const REVERIFY_LEDGER = arg('--reverify');
const REVERIFY_BACKUP = arg('--reverify-from-backup');
const UNMERGE = arg('--unmerge');
const EXPECT_DB = arg('--expect-db');
const PARTIAL = args.includes('--partial');
const FORCE_FIELDS = (arg('--force-fields') ?? '').split(',').map((f) => f.trim()).filter(Boolean);

/**
 * §2.3.3.3 "a live merge is announced": the same holds for undoing one. Returns the Notifier
 * payload when either IPO was OPEN or UPCOMING, else null (nothing to announce).
 */
export function unmergeNotice(r: UnmergeResult): { title: string; body: string } | null {
  const live = new Set(['OPEN', 'UPCOMING']);
  if (!live.has(r.keepStatus) && !live.has(r.dropStatus)) return null;
  return {
    title: `IPO unmerge: /${r.dropSlug} restored from /${r.keepSlug}`,
    body:
      `merge ${r.mergeId} undone${r.partial ? ' (PARTIAL: ' + r.missing.join('; ') + ')' : ''}. ` +
      `statuses: ${r.keepSlug}=${r.keepStatus}, ${r.dropSlug}=${r.dropStatus}. ` +
      `rows restored: ${r.restoredRows.map((t) => `${t.table} ${t.count}`).join(', ') || 'none'}.`,
  };
}

/**
 * `--unmerge <merge-id>` (item 19, OD-92, spec §2.3.3.3): dry run by default; `--apply` writes;
 * `--expect-db <name>` must match the connected database; production needs `--allow-prod`.
 * `--partial` accepts a pre-OD-92 entry that the log can only partly restore; `--force-fields
 * a,b` overwrites survivor columns that changed after the merge (inferred rule, OD-92).
 */
export async function runUnmerge(mergeId: string): Promise<number> {
  if (!EXPECT_DB) {
    console.error('refused: --unmerge needs --expect-db <name> on every run (dry or applied)');
    return 1;
  }
  let refused = false;
  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-merge-duplicate-ipo --unmerge',
    onRefuse: () => {
      refused = true;
    },
  });
  if (refused) return 1;
  if (dbName !== EXPECT_DB) {
    console.error(`refused: --expect-db said "${EXPECT_DB}" but this connection is on "${dbName}"`);
    return 1;
  }
  // #715 class sweep: unmergeDuplicate() invalidates cache internally, so
  // the guard decides which Redis client the repository ever sees.
  const unmergeGuard = guardCacheInvalidation({
    dbName,
    toolName: 'repair-merge-duplicate-ipo --unmerge',
    keys: ['ipo:detail:*', 'ipo:list:*', 'ipo:search:*'],
  });
  const repo = new IPORepository(db, unmergeGuard.blocked ? (createNoopRedisClient() as unknown as ReturnType<typeof getRedisClient>) : getRedisClient());
  let r: UnmergeResult;
  try {
    r = await repo.unmergeDuplicate(mergeId, {
      apply: APPLY,
      allowProd: ALLOW_PROD,
      partial: PARTIAL,
      forceFields: FORCE_FIELDS,
      unmergedBy: 'repair-merge-duplicate-ipo.ts --unmerge',
    });
  } catch (err) {
    if (err instanceof DatabaseError || err instanceof ProdWriteRefusedError) {
      console.error(`refused: ${err.message}`);
      return 1;
    }
    throw err;
  }
  console.log(`${r.applied ? 'UNMERGED' : 'DRY RUN (pass --apply to write)'}: merge ${r.mergeId}`);
  console.log(`  restores /${r.dropSlug} (${r.dropId}) out of /${r.keepSlug} (${r.keepId})`);
  if (r.partial) console.log(`  PARTLY REVERSIBLE — not in the log: ${r.missing.join('; ')}`);
  if (r.drift.length) console.log(`  survivor columns overwritten (forced): ${r.drift.join(', ')}`);
  r.restoredRows.forEach((t) => console.log(`  re-insert ${t.table}: ${t.count}`));
  r.repointedBack.forEach((t) => console.log(`  moved back ${t.table}: ${t.count} of ${t.logged} logged`));
  if (r.applied) {
    const notice = unmergeNotice(r);
    if (notice) {
      notifyOwner('P1', notice.title, { body: notice.body });
      await flushOwnerNotify();
    }
  }
  return 0;
}


/**
 * Re-runs `verifyMergeReadback` against a FRESH read of the database, from a
 * ledger file the tool already wrote on a previous `--apply` run
 * (`scripts/state/merge-applied-*.json`). Writes nothing. Used to re-check a
 * merge whose apply-time VERIFY reported a FALSE FAIL (DEFECT 1: the
 * read-back used to compare the wrong key casing) — the 10 staging ledgers
 * from the 2026-09-16 run are exactly this case.
 */
export async function reverify(ledgerPath: string): Promise<number> {
  let ledgerRaw: string;
  try {
    ledgerRaw = fs.readFileSync(ledgerPath, 'utf8');
  } catch (err) {
    console.error(`refused: could not read ledger file "${ledgerPath}": ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  let ledger: {
    keepId?: unknown;
    dropId?: unknown;
    keepSlug?: unknown;
    droppedSlug?: unknown;
    patch?: unknown;
  };
  try {
    ledger = JSON.parse(ledgerRaw);
  } catch (err) {
    console.error(`refused: ledger file "${ledgerPath}" is not valid JSON: ${err instanceof Error ? err.message : err}`);
    return 1;
  }

  if (typeof ledger.keepId !== 'string' || typeof ledger.dropId !== 'string' || typeof ledger.droppedSlug !== 'string') {
    console.error(`refused: ledger file "${ledgerPath}" is missing keepId/dropId/droppedSlug`);
    return 1;
  }
  if (!Array.isArray(ledger.patch)) {
    console.error(
      `refused: ledger file "${ledgerPath}" has no "patch" array — it was written before the patch field was ` +
        `added to the ledger (2026-09-16), so there is nothing to re-verify a carried-field readback against. ` +
        `Re-run the original --apply is not an option (it already committed); this ledger cannot be re-verified.`
    );
    return 1;
  }

  const keepId = ledger.keepId as string;
  const dropId = ledger.dropId as string;
  const droppedSlug = ledger.droppedSlug as string;
  const patch = ledger.patch as MergeDuplicateResult['patch'];

  const readback = await readbackFromDb({ keepId, dropId, droppedSlug, patch });
  readback.forEach((c) => console.log(`VERIFY: ${c.pass ? 'PASS' : 'FAIL'} — ${c.name}: ${c.detail}`));
  return readback.every((c) => c.pass) ? 0 : 2;
}

/**
 * Re-derives the merge patch from a `scripts/state/merge-backup-*.json` file
 * (written BEFORE every apply — the pre-write snapshot, not the post-apply
 * ledger `--reverify` reads) and re-runs the read-back against a FRESH read
 * of the database. Writes nothing. Exists because the 10 staging
 * `merge-applied-*.json` ledgers from the 2026-09-16 run were lost
 * (untracked file in a worktree that was removed) — the backups are all that
 * survives, and a backup carries the full `keep`/`drop` rows plus the
 * dropped row's `field_sources` snapshot, so the SAME patch the apply path
 * would have computed can be rebuilt from it via `buildCarryFieldInputs` /
 * `planCarryFields` — the identical functions the apply path itself calls
 * (`IPORepository.mergeDuplicateInto`), not a re-implementation.
 */
export async function reverifyFromBackup(backupPath: string): Promise<number> {
  let backupRaw: string;
  try {
    backupRaw = fs.readFileSync(backupPath, 'utf8');
  } catch (err) {
    console.error(`refused: could not read backup file "${backupPath}": ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  let backup: {
    keep?: unknown;
    drop?: unknown;
    children?: unknown;
  };
  try {
    backup = JSON.parse(backupRaw);
  } catch (err) {
    console.error(`refused: backup file "${backupPath}" is not valid JSON: ${err instanceof Error ? err.message : err}`);
    return 1;
  }

  if (backup.keep == null || typeof backup.keep !== 'object') {
    console.error(`refused: backup file "${backupPath}" is missing "keep"`);
    return 1;
  }
  if (backup.drop == null || typeof backup.drop !== 'object') {
    console.error(`refused: backup file "${backupPath}" is missing "drop"`);
    return 1;
  }

  const keep = backup.keep as Record<string, unknown>;
  const drop = backup.drop as Record<string, unknown>;
  const keepId = keep.id;
  const dropId = drop.id;
  const droppedSlug = drop.slug;
  if (typeof keepId !== 'string' || typeof dropId !== 'string' || typeof droppedSlug !== 'string') {
    console.error(`refused: backup file "${backupPath}" is missing keep.id / drop.id / drop.slug`);
    return 1;
  }

  // `children.field_sources` rows were captured via `db.execute(sql...)` and so carry RAW
  // (snake_case) column names — ipo_id, field_name, previous_source — never the camelCase
  // drizzle field names `buildProvenanceMap` expects. Normalize before handing them in, exactly
  // as the live `.select({ ipoId: fieldSources.ipoId, ... })` query on the apply path would shape
  // them for the SAME dropped-row id.
  const childFieldSources = Array.isArray((backup.children as Record<string, unknown> | undefined)?.field_sources)
    ? ((backup.children as Record<string, unknown>).field_sources as Record<string, unknown>[])
    : [];
  const dropProvRows: (ProvenanceRow & { ipoId: string })[] = childFieldSources
    .filter((r) => r.table_name === 'ipos')
    .map((r) => ({
      ipoId: String(r.ipo_id),
      fieldName: String(r.field_name),
      source: String(r.source),
      confidence: Number(r.confidence),
    }));
  const dropProv = buildProvenanceMap(dropProvRows, dropId);

  const patch: CarryFieldPatch[] = planCarryFields(buildCarryFieldInputs(keep, drop, dropProv), dropId);

  const readback = await readbackFromDb({ keepId, dropId, droppedSlug, patch });
  readback.forEach((c) => console.log(`VERIFY: ${c.pass ? 'PASS' : 'FAIL'} — ${c.name}: ${c.detail}`));
  return readback.every((c) => c.pass) ? 0 : 2;
}

/**
 * Re-query after commit — the predecessor script did this (git show
 * 9709f987:scripts/merge-duplicate-ipo.mjs ~L319) and this CLI had silently dropped it: an
 * "APPLIED." report with nothing that actually re-checked the write. Shared by the apply path
 * (immediately after commit) and `--reverify` (from a ledger, any time later) — one place that
 * builds the readback inputs from the database, so the two paths cannot drift.
 */
export async function readbackFromDb(input: {
  keepId: string;
  dropId: string;
  droppedSlug: string;
  patch: MergeDuplicateResult['patch'];
}): Promise<MergeReadbackCheck[]> {
  const dropCountResult = await db.execute(sql`select count(*)::int as n from ipos where id = ${input.dropId}`);
  const dropRowCount = Number((dropCountResult as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? -1);

  const survivorResult = await db.execute(sql`select * from ipos where id = ${input.keepId}`);
  const survivor = (survivorResult as unknown as { rows: Record<string, unknown>[] }).rows?.[0];

  const redirectResult = await db.execute(
    sql`select 1 from ipo_slug_redirects where old_slug = ${input.droppedSlug} and ipo_id = ${input.keepId} limit 1`
  );
  const redirectExists = ((redirectResult as unknown as { rows: unknown[] }).rows?.length ?? 0) > 0;

  const sameDayResult = survivor
    ? await db.execute(
        sql`select slug from ipos where open_date = ${survivor.open_date} and id <> ${input.keepId}`
      )
    : { rows: [] };
  const sameDaySiblingSlugs = ((sameDayResult as unknown as { rows: { slug: string }[] }).rows ?? []).map(
    (r) => r.slug
  );

  return verifyMergeReadback({
    dropRowCount,
    survivor,
    patch: input.patch,
    redirectExists,
    sameDaySiblingSlugs,
    keepId: input.keepId,
  });
}

function printPlan(result: MergeDuplicateResult) {
  console.log(`\nKEEP   ${result.keep.slug}`);
  console.log(`       ${result.keep.companyName}   issue_size ${result.keep.issueSize}`);
  console.log(`DROP   ${result.drop.slug}`);
  console.log(`       ${result.drop.companyName}   issue_size ${result.drop.issueSize}`);
  console.log(`\ndiscovered ${result.descendantTableCount} descendant tables (${result.directTableCount} carry an ipo id directly)`);

  console.log('\nfields written onto the survivor:');
  if (!result.patch.length) console.log('   (none)');
  for (const p of result.patch) {
    console.log(`   ${p.column}: -> ${String(p.value).slice(0, 60)}  (source ${p.source}, ${p.confidence})`);
  }

  console.log('\nchild rows DELETED with the dropped row (scraper output, regenerable):');
  if (!result.toDelete.length) console.log('   (none)');
  result.toDelete.forEach((x) => console.log(`   ${x.table}: ${x.count}`));
  console.log('\nchild rows REPOINTED to the survivor (person-created, never deleted):');
  if (!result.toRepoint.length) console.log('   (none)');
  result.toRepoint.forEach((x) => console.log(`   ${x.table}: ${x.count}`));
  console.log(`\nslug redirect: /${result.drop.slug}  ->  /${result.keep.slug}`);
}

async function main(): Promise<number> {
  if (REVERIFY_LEDGER) {
    return reverify(REVERIFY_LEDGER);
  }
  if (REVERIFY_BACKUP) {
    return reverifyFromBackup(REVERIFY_BACKUP);
  }
  if (UNMERGE) {
    return runUnmerge(UNMERGE);
  }
  if (!KEEP || !DROP) {
    console.error(
      'usage: --keep <uuid> --drop <uuid> [--apply --allow-prod] [--set-issue-size <rupees>]\n' +
        '   or: --reverify <scripts/state/merge-applied-*.json>          (re-checks an already-applied merge from its ledger, writes nothing)\n' +
        '   or: --reverify-from-backup <scripts/state/merge-backup-*.json>  (re-derives the patch from the pre-write backup, writes nothing)\n' +
        '   or: --unmerge <merge-log-id> --expect-db <name> [--apply [--allow-prod]] [--partial] [--force-fields a,b]  (OD-92)'
    );
    return 1;
  }
  if (KEEP === DROP) {
    console.error('refused: --keep and --drop name the same row');
    return 1;
  }

  let refused = false;
  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-merge-duplicate-ipo',
    onRefuse: () => {
      refused = true;
    },
  });
  if (refused) return 1;

  // #715 class sweep: mergeDuplicateInto() invalidates cache internally, so
  // the guard decides which Redis client the repository ever sees.
  const mergeGuard = guardCacheInvalidation({
    dbName,
    toolName: 'repair-merge-duplicate-ipo',
    keys: ['ipo:detail:*', 'ipo:list:*', 'ipo:search:*'],
  });
  const redis = mergeGuard.blocked ? (createNoopRedisClient() as unknown as ReturnType<typeof getRedisClient>) : getRedisClient();
  const repo = new IPORepository(db, redis);

  // --- plan first, always — this is also the backup source: every direct child row is
  // snapshotted below BEFORE any write, keyed by the same table list the plan discovered.
  let plan: MergeDuplicateResult;
  try {
    plan = await repo.mergeDuplicateInto(KEEP, DROP, {
      apply: false,
      forceDifferentName: FORCE_NAME,
      setIssueSize: SET_ISSUE_SIZE ?? undefined,
      issueSizeNote: ISSUE_SIZE_NOTE ?? undefined,
    });
  } catch (err) {
    if (err instanceof DatabaseError || err instanceof ProdWriteRefusedError) {
      console.error(`refused: ${err.message}`);
      return 1;
    }
    throw err;
  }

  // Full-row backup of every child table the plan touches, taken BEFORE any write.
  const backup: { takenAt: string; database: string; keep: unknown; drop: unknown; children: Record<string, unknown[]> } = {
    takenAt: new Date().toISOString(),
    database: dbName,
    keep: plan.keep,
    drop: plan.drop,
    children: {},
  };
  const childChanges: { table: string; rowKey: string; field: string; before: unknown; after: unknown }[] = [];
  for (const { table, col } of plan.toDelete) {
    const r = await db.execute(
      sql`select * from ${sql.identifier(table)} where ${sql.identifier(col)} in (${KEEP}, ${DROP})`
    );
    const rows = (r as unknown as { rows: Record<string, unknown>[] }).rows;
    if (rows.length) backup.children[table] = rows;
    for (const row of rows.filter((rw) => rw[col] === DROP)) {
      childChanges.push({ table, rowKey: String(row.id ?? `${table}:${col}:${DROP}`), field: '(row)', before: row, after: null });
    }
  }
  for (const { table, col } of plan.toRepoint) {
    const r = await db.execute(
      sql`select * from ${sql.identifier(table)} where ${sql.identifier(col)} in (${KEEP}, ${DROP})`
    );
    const rows = (r as unknown as { rows: Record<string, unknown>[] }).rows;
    if (rows.length) backup.children[table] = rows;
    for (const row of rows.filter((rw) => rw[col] === DROP)) {
      childChanges.push({ table, rowKey: String(row.id ?? `${table}:${col}:${DROP}`), field: col, before: DROP, after: KEEP });
    }
  }
  const backupFile = writeLedgerFile(`scripts/state/merge-backup-${DROP}-${Date.now()}.json`, {
    tool: 'repair-merge-duplicate-ipo',
    mode: APPLY ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    changes: [
      { table: 'ipos', rowKey: DROP, field: '(row)', before: plan.drop, after: null },
      ...childChanges,
    ],
    ...backup,
  });
  console.log(`backup:    ${backupFile}`);

  printPlan(plan);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Re-run with --apply to execute.');
    return 0;
  }

  let applied: MergeDuplicateResult;
  try {
    applied = await repo.mergeDuplicateInto(KEEP, DROP, {
      apply: true,
      allowProd: ALLOW_PROD,
      forceDifferentName: FORCE_NAME,
      setIssueSize: SET_ISSUE_SIZE ?? undefined,
      issueSizeNote: ISSUE_SIZE_NOTE ?? undefined,
      // Item 19 / #807. Only the apply site needs this — the dry run above writes no log,
      // because a plan is not a merge.
      mergedBy: 'repair-merge-duplicate-ipo.ts',
    });
  } catch (err) {
    if (err instanceof DatabaseError || err instanceof ProdWriteRefusedError) {
      console.error(`refused: ${err.message}`);
      return 1;
    }
    throw err;
  }

  // --- post-apply readback (MAJOR-2, PR #433 review) ------------------------------------------
  const readback: MergeReadbackCheck[] = await readbackFromDb({
    keepId: KEEP,
    dropId: DROP,
    droppedSlug: plan.drop.slug,
    patch: applied.patch,
  });
  readback.forEach((c) => console.log(`VERIFY: ${c.pass ? 'PASS' : 'FAIL'} — ${c.name}: ${c.detail}`));
  const readbackOk = readback.every((c) => c.pass);

  writeLedgerFile(`scripts/state/merge-applied-${DROP}-${Date.now()}.json`, {
    tool: 'repair-merge-duplicate-ipo',
    mode: 'apply',
    generatedAt: new Date().toISOString(),
    changes: applied.patch.map((p) => ({
      table: 'ipos',
      rowKey: KEEP,
      field: p.column,
      before: (plan.keep as Record<string, unknown>)[p.column] ?? null,
      after: p.value,
    })),
    appliedAt: new Date().toISOString(),
    keepId: KEEP,
    dropId: DROP,
    keepSlug: applied.keepSlug,
    droppedSlug: applied.droppedSlug,
    patch: applied.patch,
    provenanceWritten: applied.provenanceWritten,
    readback,
  });

  if (!readbackOk) {
    console.error('\nVERIFY FAILED — the write committed but a post-apply check did not confirm it. See VERIFY lines above.');
    return 2;
  }

  console.log('\nAPPLIED.');
  console.log(`   provenance rows written: ${applied.provenanceWritten.length}`);
  applied.provenanceWritten.forEach((p) =>
    console.log(`      ${p.fieldName}: ${p.source} (was ${p.previousSource || 'none'})`)
  );
  console.log(`   survivor: ${applied.keepSlug}`);
  console.log(`   rollback: pre-merge snapshot at ${backupFile}`);
  console.log(
    '\n   Repository cache invalidation ran automatically (ipo:id/slug keys + list/search patterns dropped).'
  );
  return 0;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'repair-merge-duplicate-ipo crashed');
      console.error('repair-merge-duplicate-ipo failed:', err instanceof Error ? err.message : err);
      process.exit(2);
    });
}
