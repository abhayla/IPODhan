/**
 * #982 follow-up (F-161, item 6): reopen DOC-ranked plan rows the buggy fetcher
 * answered "no document yet" before the fix, on an IPO that already held the
 * offer document.
 *
 * RCA: before #982, the DOC fetcher's `documentType` family for a field held
 * only `PRICE_BAND_AD` (never RHP/DRHP/PROSPECTUS), so any field whose only
 * mapped document type was one of those answered NOT_AVAILABLE_YET forever,
 * even after the offer document was extracted. #982 fixed the fetcher
 * (deployed on staging 2026-09-24 22:38 IST). A NOT_AVAILABLE_YET row is only
 * re-asked at the next data-job slot boundary after its `last_attempt_at`
 * (`ipo-field-plan-repository.ts` claim query) or, for a closed/listed IPO,
 * never again once the ask caps out (OD-56, §2.5.1) — so every row the buggy
 * fetcher answered before the fix stays wrong until something re-opens it.
 *
 * Selection — the floor check's population (`pull_doc_nay_with_offer_doc`,
 * scripts/audit-detection-floor.mjs, item 6 / F-161: rank1_source = 'DOC',
 * cause starting `rank1:DOC:NOT_AVAILABLE_YET`, IPO holds a COMPLETED, active
 * offer document — RHP / DRHP / PROSPECTUS / PRICE_BAND_AD — extracted
 * BEFORE that attempt, `last_attempt_at > d.extracted_at`), NARROWED by one
 * explicit `state = 'NOT_AVAILABLE_YET'` clause the class description in the
 * brief also states, so the tool is idempotent: once a row is reopened to
 * PENDING its `cause` column is left as-is (audit trail — the walk's own
 * next attempt overwrites it), and without the state clause the SAME row
 * would match again on every re-run before the walk revisits it (found
 * red-then-green in this tool's own integration test). Any IPO status,
 * staging and prod. Rows answered AFTER the fix deployed are right by
 * construction and are naturally excluded once their next attempt no longer
 * records that cause.
 *
 * Writes ONLY the reopen the walk itself performs on a superseding document
 * (`IpoFieldPlanRepository.reopenSuperseded`): state -> PENDING, next_due_at
 * = now, claimed_at/claim_token cleared, reason_code cleared, cause
 * preserved (audit trail — this tool marks it in the ledger, not the row).
 * Guarded on the row still holding the exact state/cause it was read with,
 * so a row the walk has since re-asked is left alone. An applied ledger
 * lists exactly the rows the UPDATE changed; `--undo` restores only those,
 * and only while each still holds the post-image.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-reopen-stale-doc-nay.ts --expect-db ipodhan_test            # dry run
 *   npx tsx scripts/repair-reopen-stale-doc-nay.ts --expect-db ipodhan_test --apply
 *   npx tsx scripts/repair-reopen-stale-doc-nay.ts --expect-db ipodhan_test --undo evidence/<ledger>.json --apply
 * Prod is refused without --allow-prod (openRepairDb).
 *
 * No detection change: pull_doc_nay_with_offer_doc already detects this class by IPO identity.
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';

const TOOL = 'repair-reopen-stale-doc-nay';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The same offer-document family the DOC fetcher and the floor check both use. */
export const OFFER_DOCUMENT_TYPES = ['RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD'] as const;

export interface StaleDocNayRow {
  id: string;
  ipoId: string;
  ipoSlug: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  state: string;
  reasonCode: string | null;
  cause: string | null;
  lastAttemptAt: string | null;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}

/**
 * Same SQL as `checkPullDocNayWithOfferDoc` in scripts/audit-detection-floor.mjs
 * (item 6 / F-161) — one population definition, read here rather than retyped.
 */
async function readStaleRows(): Promise<StaleDocNayRow[]> {
  const result = await (db as any).execute(sql`
    SELECT p.id, p.ipo_id, i.slug, p.table_name, p.row_key, p.field_name, p.state::text AS state,
           p.reason_code, p.cause, p.last_attempt_at::text AS last_attempt_at
      FROM ipo_field_plan p
      JOIN ipos i ON i.id = p.ipo_id
     WHERE p.rank1_source = 'DOC'
       AND p.state = 'NOT_AVAILABLE_YET'
       AND left(p.cause, 27) = 'rank1:DOC:NOT_AVAILABLE_YET'
       AND EXISTS (SELECT 1 FROM documents d
                    WHERE d.ipo_id = p.ipo_id
                      AND d.extraction_status = 'COMPLETED'
                      AND d.is_active IS NOT FALSE
                      AND d.type IN ('RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD')
                      AND d.extracted_at IS NOT NULL
                      AND p.last_attempt_at > d.extracted_at)
     ORDER BY i.slug, p.table_name, p.field_name, p.row_key
  `);
  return rowsOf(result).map((r) => ({
    id: String(r.id),
    ipoId: String(r.ipo_id),
    ipoSlug: (r.slug as string) ?? null,
    tableName: String(r.table_name),
    rowKey: String(r.row_key ?? ''),
    fieldName: String(r.field_name),
    state: String(r.state),
    reasonCode: (r.reason_code as string) ?? null,
    cause: (r.cause as string) ?? null,
    lastAttemptAt: (r.last_attempt_at as string) ?? null,
  }));
}

export function breakdownBySlug(rows: readonly StaleDocNayRow[]): Array<{ slug: string; rows: number }> {
  const byIpo = new Map<string, number>();
  for (const r of rows) byIpo.set(r.ipoSlug ?? r.ipoId, (byIpo.get(r.ipoSlug ?? r.ipoId) ?? 0) + 1);
  return [...byIpo.entries()].map(([slug, n]) => ({ slug, rows: n })).sort((a, b) => b.rows - a.rows);
}

interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
  undo: string | null;
}

function valueAfter(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
}

export function parseArgs(argv: readonly string[]): Cli {
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    expectDb: valueAfter(argv, '--expect-db'),
    undo: valueAfter(argv, '--undo'),
  };
}

async function runUndo(cli: Cli, actual: string, ledgerPath: string): Promise<void> {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
    tool: string;
    database: string;
    apply: boolean;
    reopened: Array<{ planRowId: string; before: { state: string; reasonCode: string | null; cause: string | null } }>;
  };
  if (ledger.tool !== TOOL) throw new Error(`--undo ledger was written by "${ledger.tool}", not ${TOOL}`);
  if (ledger.database !== actual) throw new Error(`--undo ledger is for "${ledger.database}", this pool is "${actual}"`);
  if (!ledger.apply) throw new Error('--undo ledger is a DRY RUN ledger — nothing was written, nothing to undo');
  console.log(`${TOOL} --undo: ${ledger.reopened.length} row(s) in the before-image`);
  if (!cli.apply) {
    console.log(`${TOOL} --undo: DRY RUN — re-run with --apply to restore rows still holding the post-image.`);
    return;
  }
  let restored = 0;
  for (const r of ledger.reopened) {
    const res = await (db as any).execute(sql`
      UPDATE ipo_field_plan
         SET state = ${r.before.state}::field_plan_state, reason_code = ${r.before.reasonCode},
             cause = ${r.before.cause}, next_due_at = NULL, updated_at = now()
       WHERE id = ${r.planRowId}::uuid
         AND state = 'PENDING'
         AND claimed_at IS NULL
      RETURNING id
    `);
    restored += rowsOf(res).length;
  }
  console.log(`${TOOL} --undo: restored ${restored} of ${ledger.reopened.length} (a row re-attempted since the repair is left as it is).`);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    process.exit(1);
  }
  const actual = await queryCurrentDatabase(db as ExecuteLike);
  if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
    console.error(`${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    process.exit(1);
  }
  await openRepairDb(db as ExecuteLike, { apply: cli.apply, allowProd: cli.allowProd, toolName: TOOL });

  if (cli.undo) {
    await runUndo(cli, actual, path.resolve(cli.undo));
    return;
  }

  const rows = await readStaleRows();
  const breakdown = breakdownBySlug(rows);

  console.log(`\n${TOOL}: ${rows.length} stale DOC NOT_AVAILABLE_YET row(s) on ${breakdown.length} IPO(s) in "${actual}".`);
  console.log('breakdown (slug | rows):');
  for (const b of breakdown.slice(0, 30)) {
    console.log(`  ${b.slug} | ${b.rows}`);
  }
  if (breakdown.length > 30) console.log(`  ... and ${breakdown.length - 30} more IPO(s)`);

  const ledgerFor = (applied: boolean, changed: readonly StaleDocNayRow[]) =>
    writeLedgerFile(
      path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${applied ? 'applied' : 'dryrun'}-${Date.now()}.json`),
      {
        tool: TOOL,
        database: actual,
        apply: applied,
        at: new Date().toISOString(),
        planned: rows.length,
        byIpo: breakdown,
        // Dry run: the rows that WOULD be reopened. Applied: EXACTLY the rows the
        // guarded UPDATE changed — the only rows --undo may touch.
        reopened: changed.map((r) => ({
          planRowId: r.id,
          ipoId: r.ipoId,
          ipoSlug: r.ipoSlug,
          tableName: r.tableName,
          rowKey: r.rowKey,
          fieldName: r.fieldName,
          before: { state: r.state, reasonCode: r.reasonCode, cause: r.cause, lastAttemptAt: r.lastAttemptAt },
        })),
      }
    );

  if (!cli.apply) {
    const ledgerPath = ledgerFor(false, rows);
    console.log(`${TOOL}: ledger (dry run) written to ${ledgerPath}`);
    console.log(`${TOOL}: DRY RUN — nothing was written. Re-run with --apply to reopen the ${rows.length} listed above.`);
    return;
  }
  const changed: StaleDocNayRow[] = [];
  for (const r of rows) {
    const res = await (db as any).execute(sql`
      UPDATE ipo_field_plan
         SET state = 'PENDING', next_due_at = now(), claimed_at = NULL, claim_token = NULL,
             reason_code = NULL, updated_at = now()
       WHERE id = ${r.id}::uuid
         AND state = ${r.state}::field_plan_state
         AND cause IS NOT DISTINCT FROM ${r.cause}
      RETURNING id
    `);
    if (rowsOf(res).length > 0) changed.push(r);
  }
  const ledgerPath = ledgerFor(true, changed);
  console.log(`${TOOL}: reopened ${changed.length} of ${rows.length} rows (a row that changed since the read is skipped).`);
  console.log(`${TOOL}: ledger (before-image of exactly the ${changed.length} changed rows) written to ${ledgerPath}. Undo: --undo ${ledgerPath} --apply`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`${TOOL}: ${e?.message ?? e}`);
      process.exit(1);
    });
}
