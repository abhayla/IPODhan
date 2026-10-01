/**
 * #1304 M1 backfill (spec §2.9, clarified 2026-10-01): fill ipos.postponed_at for IPOs postponed before
 * the column existed, from the status provenance row; list the ones with no evidence for the admin.
 * Logic: scraper/src/services/postponed-at-backfill.ts. Dry run by default; re-runnable (only NULL rows).
 *
 * Usage (from scraper/):
 *   npx tsx scripts/backfill-postponed-at.ts --expect-db ipodhan_staging             # dry run
 *   npx tsx scripts/backfill-postponed-at.ts --expect-db ipodhan_staging --apply     # write
 *   ... --ipo <uuid>[,<uuid>]                                                        # scope to IPOs
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, resolveIpoScope, describeIpoScope, type ExecuteLike } from './lib/repair-tool';
import { planPostponedAtBackfill, applyPostponedAtBackfill } from '../src/services/postponed-at-backfill';

const TOOL = 'backfill-postponed-at';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function valueAfter(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const allowProd = argv.includes('--allow-prod');
  const expectDb = valueAfter(argv, '--expect-db');
  const scope = resolveIpoScope(argv);
  if (scope.invalid.length > 0 || scope.unusable) {
    console.error(`${TOOL}: --ipo needs one or more valid uuids (invalid: ${scope.invalid.join(', ') || 'none given'}); refusing to run unscoped.`);
    process.exit(2);
  }
  if (!expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    process.exit(1);
  }
  const actual = await queryCurrentDatabase(db as ExecuteLike);
  if (actual.toLowerCase() !== expectDb.toLowerCase()) {
    console.error(`${TOOL}: --expect-db said "${expectDb}" but this pool is connected to "${actual}" - refusing before any read or write.`);
    process.exit(1);
  }
  await openRepairDb(db as ExecuteLike, { apply, allowProd, toolName: TOOL, expectDb });

  console.log(`${TOOL}: scope ${describeIpoScope(scope.ipoIds)}`);
  const plan = await planPostponedAtBackfill(db as ExecuteLike, scope.ipoIds);
  console.log(`\n${TOOL}: ${plan.fill.length} to fill from the status provenance row, ${plan.unknown.length} unknown (listed for the admin), in "${actual}".`);
  for (const r of plan.fill) console.log(`  fill    ${r.slug} | postponed_at := ${r.evidenceAt} (field_sources ipos.status)`);
  for (const r of plan.unknown) console.log(`  unknown ${r.slug} | no status provenance row: no automatic relaunch clear; admin review`);

  const written = apply ? await applyPostponedAtBackfill(db as never, plan) : [];
  if (apply && written.length !== plan.fill.length) {
    console.log(`${TOOL}: ${plan.fill.length - written.length} planned row(s) changed since the plan and were skipped.`);
  }
  const ledgerPath = writeLedgerFile(path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${apply ? 'applied' : 'dryrun'}-${Date.now()}.json`), {
    tool: TOOL,
    mode: apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    changes: plan.fill
      .filter((r) => !apply || written.includes(r.ipoId))
      .map((r) => ({ table: 'ipos', rowKey: r.ipoId, field: 'postponed_at', before: null, after: r.evidenceAt })),
    database: actual,
    apply,
    unknown: plan.unknown,
  });
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);
  if (!apply) console.log(`${TOOL}: DRY RUN - nothing was written.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`${TOOL}: FAILED - ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
