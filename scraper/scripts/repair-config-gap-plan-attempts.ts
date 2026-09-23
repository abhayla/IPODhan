/**
 * #884 repair: give back the attempts that a CONFIGURATION gap burned.
 *
 * Before #884, `recordOutcome` charged `attempts + 1` for every CHECK_FAILED,
 * including ones whose only cause was configuration — the manifest ranks a
 * source with no field mapping, a DOC rank with no documentType, or a source
 * with no registered fetcher. The claim query stops re-asking CHECK_FAILED at
 * FIELD_PLAN_RECLAIM_MAX_ATTEMPTS, so those rows were retired by a config fact
 * (6,220 rows across 72 IPOs on staging, 2026-09-23). The code fix stops new
 * rows accruing; this tool repairs the rows already stranded.
 *
 * Selection (one definition, the shared `isFieldPlanConfigGapCause`):
 *   state = 'CHECK_FAILED' AND attempts >= FIELD_PLAN_RECLAIM_MAX_ATTEMPTS
 *   AND the recorded cause is a configuration gap.
 * A row whose cause is a real failure (e.g. `no document provenance …`,
 * `no field result returned`, a THROWN socket error) is HELD and listed.
 *
 * Writes only `attempts = 0` (and `updated_at`), guarded on the row still
 * holding the exact state/attempts/cause it was read with. The ledger carries
 * the before-image; `--undo <ledger.json>` restores it for rows still at 0.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-config-gap-plan-attempts.ts --expect-db ipodhan_test            # dry run
 *   npx tsx scripts/repair-config-gap-plan-attempts.ts --expect-db ipodhan_test --apply
 *   npx tsx scripts/repair-config-gap-plan-attempts.ts --expect-db ipodhan_test --undo evidence/<ledger>.json --apply
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { FIELD_PLAN_RECLAIM_MAX_ATTEMPTS } from '@ipodhan/shared/repositories';
import { isFieldPlanConfigGapCause } from '@ipodhan/shared/utils/field-plan-config-gap';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';

const TOOL = 'repair-config-gap-plan-attempts';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface CappedPlanRow {
  id: string;
  ipoId: string;
  ipoSlug: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  state: string;
  attempts: number;
  reasonCode: string | null;
  cause: string | null;
}

export interface ResetDecision {
  row: CappedPlanRow;
  reset: boolean;
  reason: string;
}

export function decideReset(row: CappedPlanRow, maxAttempts: number = FIELD_PLAN_RECLAIM_MAX_ATTEMPTS): ResetDecision {
  if (row.state !== 'CHECK_FAILED') {
    return { row, reset: false, reason: `state is ${row.state}, not CHECK_FAILED` };
  }
  if (row.attempts < maxAttempts) {
    return { row, reset: false, reason: `attempts ${row.attempts} is below the cap ${maxAttempts} — still reclaimable` };
  }
  if (!isFieldPlanConfigGapCause(row.cause)) {
    return { row, reset: false, reason: `cause is not a configuration gap (${row.cause ?? 'null'}) — a real failure keeps its count` };
  }
  return { row, reset: true, reason: 'CHECK_FAILED at the cap, cause is a configuration gap' };
}

/** The cause with its field key stripped, so a breakdown groups by KIND of gap, not by field. */
export function causeKind(cause: string | null): string {
  if (!cause) return 'null';
  return cause
    .replace(/ for [A-Za-z0-9_.]+( on [A-Z0-9_]+)?/, '')
    .replace(/ \(.*$/, '')
    .replace(/ yet$/, '')
    .replace(/^(provisional-)?rank\d+:/, '');
}

export function breakdown(decisions: readonly ResetDecision[]): Array<{ reset: boolean; reasonCode: string; kind: string; rows: number; ipos: number }> {
  const groups = new Map<string, { reset: boolean; reasonCode: string; kind: string; rows: number; ipos: Set<string> }>();
  for (const d of decisions) {
    const reasonCode = d.row.reasonCode ?? 'null';
    const kind = causeKind(d.row.cause);
    const key = `${d.reset}|${reasonCode}|${kind}`;
    const g = groups.get(key) ?? { reset: d.reset, reasonCode, kind, rows: 0, ipos: new Set<string>() };
    g.rows += 1;
    g.ipos.add(d.row.ipoId);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ reset: g.reset, reasonCode: g.reasonCode, kind: g.kind, rows: g.rows, ipos: g.ipos.size }))
    .sort((a, b) => Number(b.reset) - Number(a.reset) || b.rows - a.rows);
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

function rowsOf(result: unknown): Record<string, unknown>[] {
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}

async function readCappedRows(): Promise<CappedPlanRow[]> {
  const result = await (db as any).execute(sql`
    SELECT p.id, p.ipo_id, i.slug, p.table_name, p.row_key, p.field_name, p.state::text AS state,
           p.attempts, p.reason_code, p.cause
      FROM ipo_field_plan p
      LEFT JOIN ipos i ON i.id = p.ipo_id
     WHERE p.state = 'CHECK_FAILED' AND p.attempts >= ${FIELD_PLAN_RECLAIM_MAX_ATTEMPTS}
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
    attempts: Number(r.attempts),
    reasonCode: (r.reason_code as string) ?? null,
    cause: (r.cause as string) ?? null,
  }));
}

async function runUndo(cli: Cli, actual: string, ledgerPath: string): Promise<void> {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
    tool: string;
    database: string;
    apply: boolean;
    reset: Array<{ planRowId: string; before: { attempts: number } }>;
  };
  if (ledger.tool !== TOOL) throw new Error(`--undo ledger was written by "${ledger.tool}", not ${TOOL}`);
  if (ledger.database !== actual) throw new Error(`--undo ledger is for "${ledger.database}", this pool is "${actual}"`);
  if (!ledger.apply) throw new Error('--undo ledger is a DRY RUN ledger — nothing was written, nothing to undo');
  console.log(`${TOOL} --undo: ${ledger.reset.length} row(s) in the before-image`);
  if (!cli.apply) {
    console.log(`${TOOL} --undo: DRY RUN — re-run with --apply to restore attempts for rows still at 0.`);
    return;
  }
  let restored = 0;
  for (const r of ledger.reset) {
    const res = await (db as any).execute(sql`
      UPDATE ipo_field_plan SET attempts = ${r.before.attempts}, updated_at = now()
       WHERE id = ${r.planRowId}::uuid AND attempts = 0
      RETURNING id
    `);
    restored += rowsOf(res).length;
  }
  console.log(`${TOOL} --undo: restored ${restored} of ${ledger.reset.length} (rows re-attempted since the repair are left as they are).`);
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

  const decisions = (await readCappedRows()).map((row) => decideReset(row));
  const reset = decisions.filter((d) => d.reset);
  const held = decisions.filter((d) => !d.reset);
  const groups = breakdown(decisions);

  console.log(`\n${TOOL}: ${reset.length} to reset, ${held.length} held, of ${decisions.length} CHECK_FAILED rows at attempts >= ${FIELD_PLAN_RECLAIM_MAX_ATTEMPTS} in "${actual}".`);
  console.log(`${TOOL}: IPOs affected (reset): ${new Set(reset.map((d) => d.row.ipoId)).size}`);
  console.log('breakdown (action | reason_code | cause kind | rows | ipos):');
  for (const g of groups) {
    console.log(`  ${g.reset ? 'RESET' : 'HOLD '} | ${g.reasonCode} | ${g.kind} | ${g.rows} | ${g.ipos}`);
  }

  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    {
      tool: TOOL,
      database: actual,
      apply: cli.apply,
      at: new Date().toISOString(),
      maxAttempts: FIELD_PLAN_RECLAIM_MAX_ATTEMPTS,
      breakdown: groups,
      reset: reset.map((d) => ({
        planRowId: d.row.id,
        ipoId: d.row.ipoId,
        ipoSlug: d.row.ipoSlug,
        tableName: d.row.tableName,
        rowKey: d.row.rowKey,
        fieldName: d.row.fieldName,
        before: { state: d.row.state, attempts: d.row.attempts, reasonCode: d.row.reasonCode, cause: d.row.cause },
      })),
      held: held.map((d) => ({ planRowId: d.row.id, ipoSlug: d.row.ipoSlug, fieldName: d.row.fieldName, reason: d.reason })),
    }
  );
  console.log(`${TOOL}: ledger (before-image) written to ${ledgerPath}`);

  if (!cli.apply) {
    console.log(`${TOOL}: DRY RUN — nothing was written. Re-run with --apply to reset the ${reset.length} listed above.`);
    return;
  }
  let written = 0;
  for (const d of reset) {
    const res = await (db as any).execute(sql`
      UPDATE ipo_field_plan SET attempts = 0, updated_at = now()
       WHERE id = ${d.row.id}::uuid
         AND state = 'CHECK_FAILED'
         AND attempts = ${d.row.attempts}
         AND cause IS NOT DISTINCT FROM ${d.row.cause}
      RETURNING id
    `);
    written += rowsOf(res).length;
  }
  console.log(`${TOOL}: reset attempts to 0 on ${written} of ${reset.length} rows (a row that changed since the read is skipped). Undo: --undo ${ledgerPath} --apply`);
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
