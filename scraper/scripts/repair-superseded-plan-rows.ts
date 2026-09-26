/**
 * Item 6 repair (spec §2.5, F-164): reopen SUPPLIED plan rows whose chosen
 * document is outranked by a COMPLETED document of the same IPO — the rows
 * that existed before supersession was wired. The live path
 * (`reopenSupersededPlanRows` on every COMPLETED extraction) handles rows the
 * pipeline creates after the fix; this tool evaluates the SAME rule
 * (`evaluateSupersession` -> `findPlanRowSupersessor` -> `decidePlanRowSupersession`)
 * over the whole table.
 *
 * DRY RUN ONLY in this slice (see the --apply guard below).
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-superseded-plan-rows.ts --expect-db ipodhan_staging          # dry run
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';
import { evaluateSupersession, loadSupersessionInputs } from '../src/services/plan-supersession';

const TOOL = 'repair-superseded-plan-rows';
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
  if (!expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    process.exit(1);
  }
  const actual = await queryCurrentDatabase(db as ExecuteLike);
  if (actual.toLowerCase() !== expectDb.toLowerCase()) {
    console.error(`${TOOL}: --expect-db said "${expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    process.exit(1);
  }
  await openRepairDb(db as ExecuteLike, { apply, allowProd, toolName: TOOL });

  const evaluation = evaluateSupersession(await loadSupersessionInputs(db as ExecuteLike));
  console.log(
    `\n${TOOL}: ${evaluation.reopen.length} to reopen, ${evaluation.unordered.length} kept as unordered, of ${evaluation.examined} SUPPLIED rows with a chosen document in "${actual}".`
  );
  console.log('reopen (slug | table.field[row_key] | chosen type/id/filing -> by type/id/filing | reason):');
  for (const v of evaluation.reopen) {
    const r = v.row;
    console.log(
      `  ${r.ipoSlug} | ${r.tableName}.${r.fieldName}${r.rowKey ? `[${r.rowKey}]` : ''} | ` +
        `${r.chosen.docType}/${r.chosen.id}/${r.chosen.filingDate ?? '-'} -> ` +
        `${v.supersededBy.docType}/${v.supersededBy.id}/${v.supersededBy.filingDate ?? '-'} | ${v.reason}`
    );
  }
  if (evaluation.unordered.length > 0) {
    console.log('unordered (kept — same type, a filing_date missing):');
    for (const u of evaluation.unordered) {
      console.log(`  ${u.row.ipoSlug} | ${u.row.tableName}.${u.row.fieldName} | chosen ${u.row.chosen.id} vs ${u.documentIds.join(',')}`);
    }
  }

    if (apply) {
    // Not wired yet: the reopen write (and ipo_field_plan.superseded_by) is held
    // until the re-ask can credit the superseding document — see the PR/brief
    // report (20 of the 28 staging rows would be re-SUPPLIED from the same
    // PRICE_BAND_AD via field_sources lineage). Dry run only until then.
    console.error(`${TOOL}: --apply is not available yet — dry run only.`);
    process.exit(1);
  }
  const changed: string[] = [];
  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    {
      tool: TOOL,
      mode: apply ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      changes: evaluation.reopen
        .filter((v) => !apply || changed.includes(v.row.planRowId))
        .map((v) => ({
          // #457 round 2: `state` lives on the PLAN row (ipo_field_plan.id), not on the
          // data table the plan row targets.
          table: 'ipo_field_plan',
          rowKey: v.row.planRowId,
          field: 'state',
          before: 'SUPPLIED',
          after: 'PENDING',
        })),
      database: actual,
      apply,
      at: new Date().toISOString(),
      examined: evaluation.examined,
      reopen: evaluation.reopen
        .filter((v) => !apply || changed.includes(v.row.planRowId))
        .map((v) => ({
          planRowId: v.row.planRowId,
          ipoSlug: v.row.ipoSlug,
          field: `${v.row.tableName}.${v.row.fieldName}`,
          rowKey: v.row.rowKey,
          before: { state: 'SUPPLIED', chosenDocumentId: v.row.chosen.id, chosenType: v.row.chosen.docType },
          supersededBy: v.supersededBy.id,
          supersededByType: v.supersededBy.docType,
          reason: v.reason,
        })),
      unordered: evaluation.unordered.map((u) => ({ planRowId: u.row.planRowId, ipoSlug: u.row.ipoSlug, documentIds: u.documentIds })),
    }
  );
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);
  if (!apply) console.log(`${TOOL}: DRY RUN — nothing was written.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`${TOOL}: FAILED — ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
