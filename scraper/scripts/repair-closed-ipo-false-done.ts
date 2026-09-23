/**
 * repair-closed-ipo-false-done.ts — #717: re-open closed-IPO ledger rows that
 * were recorded DONE although the job never did the work it selected them for.
 *
 * WHY THIS EXISTS. The closed-IPO job selects a closed IPO because it holds a
 * PENDING extractable document. Until #717's fix, its worker only ran the
 * field-plan walk; closed IPOs selected this way have no plan rows, so the walk
 * returned NO_DUE_FIELDS and the job wrote DONE with fields_written 0. The
 * candidate query never re-picks DONE, so those IPOs were excluded for good
 * while their documents stayed PENDING. Measured on staging 2026-09-23: 10 of 10
 * DONE, PROSPECTUS PENDING 74 before and 74 after.
 *
 * THE CLASS IT REPAIRS, as a data filter: every closed_ipo_resourcing row, on
 * any slot, with outcome = 'DONE' whose IPO still holds a document of an
 * extractable type (PRICE_BAND_AD, RHP, DRHP, PROSPECTUS) that is UNREAD --
 * extraction_status NOT IN (COMPLETED, MANUAL_REVIEW, NOT_EXTRACTABLE), NULL
 * counting as unread. fields_written is NOT part of the filter (PR #912 review
 * round 1 MAJOR-3): a walk that wrote some fields does not make the document
 * read. A DONE row whose IPO has no unread extractable document is left
 * alone: that DONE is true.
 *
 * WHAT --apply DOES. Sets such a row to outcome PARTIAL, cause_class
 * EXTRACTOR_MISSING (the extraction never ran on it), a cause_detail that
 * starts with the marker `repair-717:`, and prefixes resourced_at_version with
 * the same marker. The version prefix is what makes the row RE-PICKABLE (PR #912
 * review round 2 MINOR-3): EXTRACTOR_MISSING is a permanent class, re-selected
 * only when `resourced_at_version IS DISTINCT FROM` the running version, and a
 * row DONE at the CURRENT version would otherwise never be picked again. No
 * real version starts with the marker, so the next run always re-picks it, and
 * its upsert then stamps the real version back (attempts restart at 1).
 * The rows as they were (outcome, cause_class, cause_detail, attempts, version)
 * are written to scripts/state/ before the update, and the UPDATE re-checks the
 * unread condition itself, so a document read between the dry run and --apply
 * leaves its DONE row untouched.
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
           cause_detail = ${REPAIR_MARKER} || ' recorded DONE while an extractable document was still unread; the extraction never finished',
           resourced_at_version = ${REPAIR_MARKER} || COALESCE(resourced_at_version, ''),
           updated_at = now()
     WHERE ipo_id = ANY(${sql.param(ids)}::uuid[])
       AND outcome = 'DONE'
       AND EXISTS (SELECT 1 FROM documents d
                    WHERE d.ipo_id = closed_ipo_resourcing.ipo_id
                      AND COALESCE(d.extraction_status, 'PENDING') NOT IN ('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE')
                      AND d.type::text IN ('PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS'))`);
  return (res as { rowCount?: number }).rowCount ?? 0;
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
               AND d.type::text IN ('PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS')) AS pending
      FROM closed_ipo_resourcing r
      JOIN ipos i ON i.id = r.ipo_id
     WHERE r.outcome = 'DONE'
     ORDER BY i.company_name`);
  const all = ((read as unknown as { rows: FalseDoneRow[] }).rows ?? []);
  const rows = all.filter((r) => Number(r.pending) > 0);

  console.log(`${all.length} DONE row(s); ${rows.length} still hold an unread extractable document:`);
  for (const r of rows) {
    console.log(
      `  ${r.company_name} (${r.ipo_id}) unread=${r.pending} fields_written=${r.fields_written} version=${r.resourced_at_version} last=${r.last_attempt_at}`
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
    console.log(`${rows.length - changed} row(s) no longer matched at write time (a document was read since the read above) and were left as they were`);
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
