/**
 * repair-closed-ipo-false-done.ts — #717 / OD-76: re-open closed-IPO ledger rows
 * that were recorded DONE although the IPO was never walked.
 *
 * WHY THIS EXISTS. Before OD-76 the closed-IPO job's worker ran only the
 * field-plan walk. 238 of 274 LISTED IPOs on staging have no plan rows, so for
 * those the walk found nothing due and the job wrote DONE. DONE is never
 * re-picked (§6.2), so each such IPO left the backlog with nothing done.
 * Measured on staging 2026-09-23: all 10 DONE rows have 0 plan rows.
 *
 * THE CLASS IT REPAIRS, as a data filter -- the corrected DONE rule (OD-76,
 * §6.1) applied backwards: every closed_ipo_resourcing row, on any slot, with
 * outcome = 'DONE' AND EITHER the IPO has 0 ipo_field_plan rows (never DONE
 * with no plan) OR none of its plan rows was ever asked (last_attempt_at IS
 * NULL on every row) while at least one is NOT settled (state not in SUPPLIED,
 * NOT_PRINTED, EXHAUSTED -- never DONE with fields still due, OD-73).
 * Documents do NOT enter the filter (review round 1 MINOR-4): an IPO whose
 * documents are all read but whose plan was never planted or walked is the
 * same false DONE. A DONE row whose IPO was walked is left alone, and so is a
 * never-asked DONE row whose every plan row is already settled.
 *
 * WHAT --apply DOES. Sets such a row to outcome PARTIAL, cause_class
 * EXTRACTOR_MISSING (no walk ever asked a field of it), a cause_detail that
 * starts with the marker `repair-717:`, and prefixes resourced_at_version with
 * the same marker. The version prefix is what makes the row RE-PICKABLE (PR #912
 * review round 2 MINOR-3): EXTRACTOR_MISSING is a permanent class, re-selected
 * only when `resourced_at_version IS DISTINCT FROM` the running version, and a
 * row DONE at the CURRENT version would otherwise never be picked again. No
 * real version starts with the marker, so the next run always re-picks it, and
 * its upsert then stamps the real version back (attempts restart at 1).
 * The rows as they were (outcome, cause_class, cause_detail, attempts, version)
 * are written to scripts/state/ before the update, and the UPDATE re-checks the
 * unread AND not-walked conditions itself, so an IPO walked or a document read
 * between the dry run and --apply leaves its DONE row untouched.
 *
 * --undo puts every row carrying the marker back to DONE with no cause and
 * strips the marker from its version.
 *
 * Usage:
 *   tsx scraper/scripts/repair-closed-ipo-false-done.ts            # dry run
 *   tsx scraper/scripts/repair-closed-ipo-false-done.ts --apply
 *   tsx scraper/scripts/repair-closed-ipo-false-done.ts --undo --apply
 *
 * Dry run is the DEFAULT and only reads. The production guard is the shared one
 * (openRepairDb): an --apply against `ipodhan` is refused without --allow-prod.
 *
 * Exit 0 clean · 1 a write failed.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';
import { openRepairDb, writeLedgerFile } from './lib/repair-tool.js';

export const REPAIR_MARKER = 'repair-717:';

type ExecDb = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Reopen the given DONE rows so the job's selection re-picks them at ANY
 * version, including the one that wrote them DONE. The UPDATE re-checks the
 * unread condition itself. Returns the number of rows changed.
 */
export async function reopenFalseDoneRows(dbx: ExecDb, ids: string[]): Promise<number> {
  // One bound array parameter (see repair-not-extractable-documents.ts for why
  // `${ids}` alone expands into a broken parameter list).
  const res = await dbx.execute(sql`
    UPDATE closed_ipo_resourcing
       SET outcome = 'PARTIAL',
           cause_class = 'EXTRACTOR_MISSING',
           cause_detail = ${REPAIR_MARKER} || ' recorded DONE without a field-plan walk (no plan rows, or none asked while rows were unsettled)',
           resourced_at_version = ${REPAIR_MARKER} || COALESCE(resourced_at_version, ''),
           updated_at = now()
     WHERE ipo_id = ANY(${sql.param(ids)}::uuid[])
       AND outcome = 'DONE'
       AND NOT EXISTS (SELECT 1 FROM ipo_field_plan p
                        WHERE p.ipo_id = closed_ipo_resourcing.ipo_id
                          AND p.last_attempt_at IS NOT NULL)
       AND (
         NOT EXISTS (SELECT 1 FROM ipo_field_plan p WHERE p.ipo_id = closed_ipo_resourcing.ipo_id)
         OR EXISTS (SELECT 1 FROM ipo_field_plan p
                     WHERE p.ipo_id = closed_ipo_resourcing.ipo_id
                       AND p.state::text NOT IN ('SUPPLIED', 'NOT_PRINTED', 'EXHAUSTED'))
       )`);
  return (res as { rowCount?: number }).rowCount ?? 0;
}

/** The class filter, applied to the dry-run read: DONE, never walked, and no plan or a plan row still unsettled. */
export function isFalseDoneWithoutWalk(r: {
  outcome: string;
  plan_rows: number | string;
  walked_rows: number | string;
  unsettled_rows: number | string;
}): boolean {
  if (String(r.outcome).toUpperCase() !== 'DONE' || Number(r.walked_rows) !== 0) return false;
  return Number(r.plan_rows) === 0 || Number(r.unsettled_rows) > 0;
}

interface Args {
  apply: boolean;
  undo: boolean;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    apply: argv.includes('--apply'),
    undo: argv.includes('--undo'),
    allowProd: argv.includes('--allow-prod'),
  };
}

interface FalseDoneRow {
  ipo_id: string;
  company_name: string;
  outcome: string;
  fields_written: number;
  cause_class: string | null;
  cause_detail: string | null;
  attempts: number;
  resourced_at_version: string;
  last_attempt_at: string;
  pending: number;
  plan_rows: number;
  walked_rows: number;
  unsettled_rows: number;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { dbName } = await openRepairDb(db, {
    apply: args.apply,
    allowProd: args.allowProd,
    toolName: 'repair-closed-ipo-false-done',
  });
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN'}${args.undo ? ' (undo)' : ''}\n`);

  if (args.undo) {
    const read = await db.execute(
      sql`SELECT r.ipo_id, i.company_name FROM closed_ipo_resourcing r JOIN ipos i ON i.id = r.ipo_id
           WHERE r.cause_detail LIKE ${REPAIR_MARKER + '%'} ORDER BY i.company_name`
    );
    const rows = ((read as unknown as { rows: { ipo_id: string; company_name: string }[] }).rows ?? []);
    console.log(`${rows.length} row(s) carry the ${REPAIR_MARKER} marker:`);
    for (const r of rows) console.log(`  ${r.company_name} (${r.ipo_id})`);
    if (!args.apply || rows.length === 0) return 0;
    const res = await db.execute(
      sql`UPDATE closed_ipo_resourcing SET outcome = 'DONE', cause_class = NULL, cause_detail = NULL,
                  resourced_at_version = CASE WHEN resourced_at_version LIKE ${REPAIR_MARKER + '%'}
                                              THEN substr(resourced_at_version, ${REPAIR_MARKER.length + 1})
                                              ELSE resourced_at_version END,
                  updated_at = now()
           WHERE cause_detail LIKE ${REPAIR_MARKER + '%'}`
    );
    console.log(`\nrestored ${(res as unknown as { rowCount?: number }).rowCount ?? 0} row(s) to DONE on ${dbName}`);
    return 0;
  }

  const read = await db.execute(sql`
    SELECT r.ipo_id, i.company_name, r.outcome::text AS outcome, r.fields_written,
           r.cause_class::text AS cause_class, r.cause_detail, r.attempts,
           r.resourced_at_version, r.last_attempt_at::text AS last_attempt_at,
           (SELECT count(*)::int FROM documents d
             WHERE d.ipo_id = r.ipo_id
               AND COALESCE(d.extraction_status, 'PENDING') NOT IN ('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE')
               AND d.type::text IN ('PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS')) AS pending,
           (SELECT count(*)::int FROM ipo_field_plan p WHERE p.ipo_id = r.ipo_id) AS plan_rows,
           (SELECT count(*)::int FROM ipo_field_plan p
             WHERE p.ipo_id = r.ipo_id AND p.last_attempt_at IS NOT NULL) AS walked_rows,
           (SELECT count(*)::int FROM ipo_field_plan p
             WHERE p.ipo_id = r.ipo_id AND p.state::text NOT IN ('SUPPLIED', 'NOT_PRINTED', 'EXHAUSTED')) AS unsettled_rows
      FROM closed_ipo_resourcing r
      JOIN ipos i ON i.id = r.ipo_id
     WHERE r.outcome = 'DONE'
     ORDER BY i.company_name`);
  const all = ((read as unknown as { rows: FalseDoneRow[] }).rows ?? []);
  const rows = all.filter(isFalseDoneWithoutWalk);

  console.log(`${all.length} DONE row(s); ${rows.length} were never walked and have no plan or an unsettled plan row:`);
  for (const r of rows) {
    console.log(
      `  ${r.company_name} (${r.ipo_id}) unread=${r.pending} plan_rows=${r.plan_rows} walked_rows=${r.walked_rows} unsettled=${r.unsettled_rows} fields_written=${r.fields_written} version=${r.resourced_at_version} last=${r.last_attempt_at}`
    );
  }
  if (rows.length === 0) {
    console.log('  (none — nothing to do)');
    return 0;
  }
  if (!args.apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to reopen these rows as PARTIAL.');
    return 0;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ledger = writeLedgerFile(path.join(here, 'state', `repair-closed-ipo-false-done-${dbName}-${stamp}.json`), {
    tool: 'repair-closed-ipo-false-done',
    db: dbName,
    before: rows,
  });
  console.log(`\nbefore-image written: ${ledger}`);

  const ids = rows.map((r) => r.ipo_id);
  const changed = await reopenFalseDoneRows(db as unknown as ExecDb, ids);
  console.log(`reopened ${changed} row(s) as PARTIAL on ${dbName}`);
  if (changed !== rows.length) {
    console.log(`${rows.length - changed} row(s) no longer matched at write time (walked or settled since the read above) and were left as they were`);
  }
  return 0;
}

// Run only when invoked as a script, so a test can import reopenFalseDoneRows.
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
}
