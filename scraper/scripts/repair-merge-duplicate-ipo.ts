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
import { db, getRedisClient, IPORepository, type MergeDuplicateResult } from '@ipodhan/shared';
import { DatabaseError, ProdWriteRefusedError } from '@ipodhan/shared/errors/repository-errors';
import { verifyMergeReadback, type MergeReadbackCheck } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { openRepairDb, writeLedgerFile } from './lib/repair-tool.js';

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
  if (!KEEP || !DROP) {
    console.error('usage: --keep <uuid> --drop <uuid> [--apply --allow-prod] [--set-issue-size <rupees>]');
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

  const redis = getRedisClient();
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
  for (const { table, col } of [...plan.toDelete, ...plan.toRepoint]) {
    const r = await db.execute(
      sql`select * from ${sql.identifier(table)} where ${sql.identifier(col)} in (${KEEP}, ${DROP})`
    );
    const rows = (r as unknown as { rows: unknown[] }).rows;
    if (rows.length) backup.children[table] = rows;
  }
  const backupFile = writeLedgerFile(
    `scripts/state/merge-backup-${DROP}-${Date.now()}.json`,
    backup
  );
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
    });
  } catch (err) {
    if (err instanceof DatabaseError || err instanceof ProdWriteRefusedError) {
      console.error(`refused: ${err.message}`);
      return 1;
    }
    throw err;
  }

  // --- post-apply readback (MAJOR-2, PR #433 review) ------------------------------------------
  // Re-query after commit — the predecessor script did this (git show
  // 9709f987:scripts/merge-duplicate-ipo.mjs ~L319) and this CLI had silently dropped it: an
  // "APPLIED." report with nothing that actually re-checked the write.
  const dropCountResult = await db.execute(sql`select count(*)::int as n from ipos where id = ${DROP}`);
  const dropRowCount = Number(
    (dropCountResult as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? -1
  );

  const survivorResult = await db.execute(sql`select * from ipos where id = ${KEEP}`);
  const survivor = (survivorResult as unknown as { rows: Record<string, unknown>[] }).rows?.[0];

  const redirectResult = await db.execute(
    sql`select 1 from ipo_slug_redirects where old_slug = ${plan.drop.slug} and ipo_id = ${KEEP} limit 1`
  );
  const redirectExists = ((redirectResult as unknown as { rows: unknown[] }).rows?.length ?? 0) > 0;

  const sameDayResult = await db.execute(
    sql`select slug from ipos where open_date = ${plan.keep.openDate} and id <> ${KEEP}`
  );
  const sameDaySiblingSlugs = (
    (sameDayResult as unknown as { rows: { slug: string }[] }).rows ?? []
  ).map((r) => r.slug);

  const readback: MergeReadbackCheck[] = verifyMergeReadback({
    dropRowCount,
    survivor,
    patch: applied.patch,
    redirectExists,
    sameDaySiblingSlugs,
    keepId: KEEP,
  });
  readback.forEach((c) => console.log(`VERIFY: ${c.pass ? 'PASS' : 'FAIL'} — ${c.name}: ${c.detail}`));
  const readbackOk = readback.every((c) => c.pass);

  writeLedgerFile(`scripts/state/merge-applied-${DROP}-${Date.now()}.json`, {
    appliedAt: new Date().toISOString(),
    keepId: KEEP,
    dropId: DROP,
    keepSlug: applied.keepSlug,
    droppedSlug: applied.droppedSlug,
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
