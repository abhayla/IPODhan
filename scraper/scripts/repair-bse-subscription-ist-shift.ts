/**
 * Repair: BSE subscription rows whose `timestamp` was written by the T-999
 * class fix (scrapers/bse-api-scraper.ts `mapBSESubscription`) — the prior
 * `new Date(maxdt)` parsed BSE's zone-less IST `Maxdt` string (e.g. the
 * day-end "5:00:00 PM") AS UTC in the TZ=UTC scraper process, storing the
 * value 5h30m late.
 *
 * IDENTIFICATION RULE (why it cannot hit a correct row): the corrupted rows
 * are `subscriptions` rows with `scope = 'BSE_ONLY'` whose STORED
 * `"timestamp"` time-of-day is EXACTLY 17:00:00.000000 UTC. This does NOT
 * depend on Maxdt always being "5:00:00 PM" — it isn't: BSE's Maxdt varies
 * intraday too (e.g. staging log: Unitec Fibres Maxdt "13:36:42 IST" on
 * 2026-09-23, which the old bug would have stored as 13:36:42 UTC, not
 * 17:00:00). The rule instead rests on what a genuine UTC instant of
 * 17:00:00 WOULD mean: 22:30 IST — hours after BSE's exchange session has
 * closed, a time BSE never publishes a fresh subscription read at. So
 * `scope='BSE_ONLY' AND time-of-day=17:00:00` can only be the specific
 * corrupted case where the source's IST 5:00:00 PM day-end figure (verified
 * live 2026-09-24 against Pubissues_GetBkbldgCatdem_ng, IPO_NO
 * 7992/7989/7991/7988/7987/7984 — every open IPO's Maxdt was exactly that
 * day-end figure at fetch time) got parsed as UTC instead of IST; a
 * correctly-parsed 5:00:00 PM IST instant is 11:30:00 UTC, never 17:00:00
 * UTC. Other, intraday Maxdt values shifted the same way land at OTHER
 * UTC time-of-day values (e.g. 13:36:42 IST -> mis-parsed 13:36:42 UTC,
 * not 17:00:00) and are not caught by this rule — see the PR body for the
 * measured count of stored BSE_ONLY rows at UTC time-of-day values other
 * than 17:00:00 that are NOT this class (they cluster on the scraper's own
 * 30-minute cron boundaries, which is the correct `new Date()`
 * scrape-time fallback, not a shifted source timestamp). Most such intraday
 * reads were REJECTED outright by W-38's 5-minute-future guard before they
 * could be written at all, so they are lost, not repairable; only the
 * day-end row reliably survives to be repaired, because the write that
 * persists it typically happens late enough in the next cycle that the
 * shifted value is no longer >5 minutes ahead of "now".
 *
 * FIX: shift the identified rows -5h30m (UTC-3300 becomes UTC-0, the true
 * observation instant), then de-duplicate: if the shifted timestamp now
 * collides with an existing row for the same ipo_id with identical
 * subscription figures, the newer (already-correct) row wins and the
 * shifted duplicate is deleted instead of updated.
 *
 * Idempotent: after a repair, no row has scope=BSE_ONLY and time-of-day
 * 17:00:00 any more (they are now at 11:30:00), so a second run finds 0.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-bse-subscription-ist-shift.ts --expect-db ipodhan_staging            # dry run
 *   npx tsx scripts/repair-bse-subscription-ist-shift.ts --expect-db ipodhan_staging --apply
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';

const TOOL = 'repair-bse-subscription-ist-shift';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIFT_MS = (5 * 60 + 30) * 60 * 1000;

export interface CandidateRow {
  id: string;
  ipoId: string;
  slug: string;
  timestamp: string; // ISO, as read back from the DB (UTC session)
  qibSubscription: string | null;
  niiSubscription: string | null;
  retailSubscription: string | null;
  totalSubscription: string | null;
  employeeSubscription: string | null;
}

export interface RepairPlan {
  /** rows to UPDATE: shift timestamp -5h30m, no collision at the shifted time */
  toShift: CandidateRow[];
  /** rows to DELETE: shifting would collide with an existing identical-value row for the same ipo */
  toDeleteAsDuplicate: { row: CandidateRow; survivorId: string }[];
}

function sameFigures(a: CandidateRow, b: { qibSubscription: string | null; niiSubscription: string | null; retailSubscription: string | null; totalSubscription: string | null; employeeSubscription: string | null }): boolean {
  return (
    (a.qibSubscription ?? null) === (b.qibSubscription ?? null) &&
    (a.niiSubscription ?? null) === (b.niiSubscription ?? null) &&
    (a.retailSubscription ?? null) === (b.retailSubscription ?? null) &&
    (a.totalSubscription ?? null) === (b.totalSubscription ?? null) &&
    (a.employeeSubscription ?? null) === (b.employeeSubscription ?? null)
  );
}

/**
 * Pure planning function — unit-testable without a DB. `existingByIpoAndTs`
 * maps `${ipoId}::${shiftedIsoTimestamp}` to an existing row's figures (and
 * id) for the same ipo already sitting at the shifted instant, so a shift
 * that would collide is turned into a delete-the-duplicate instead of a
 * unique-constraint surprise or a silent double snapshot.
 */
export function planRepair(
  candidates: readonly CandidateRow[],
  existingByIpoAndShiftedTs: ReadonlyMap<string, CandidateRow>
): RepairPlan {
  const toShift: CandidateRow[] = [];
  const toDeleteAsDuplicate: { row: CandidateRow; survivorId: string }[] = [];

  for (const row of candidates) {
    const shiftedIso = new Date(new Date(row.timestamp).getTime() - SHIFT_MS).toISOString();
    const key = `${row.ipoId}::${shiftedIso}`;
    const collision = existingByIpoAndShiftedTs.get(key);
    if (collision && collision.id !== row.id && sameFigures(row, collision)) {
      toDeleteAsDuplicate.push({ row, survivorId: collision.id });
    } else {
      toShift.push(row);
    }
  }
  return { toShift, toDeleteAsDuplicate };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cli = { apply: argv.includes('--apply'), allowProd: argv.includes('--allow-prod'), expectDb: valueAfter(argv, '--expect-db') };
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

  const candidatesRes = await db.execute(sql`
    select s.id::text as id, s.ipo_id::text as "ipoId", i.slug as slug,
           to_char(s."timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "timestamp",
           s.qib_subscription::text as "qibSubscription",
           s.nii_subscription::text as "niiSubscription",
           s.retail_subscription::text as "retailSubscription",
           s.total_subscription::text as "totalSubscription",
           s.employee_subscription::text as "employeeSubscription"
      from subscriptions s
      join ipos i on i.id = s.ipo_id
     where s.scope = 'BSE_ONLY'
       and to_char(s."timestamp", 'HH24:MI:SS') = '17:00:00'
     order by s."timestamp" asc`);
  const candidates = (candidatesRes as unknown as { rows: CandidateRow[] }).rows;

  const candidateIpoIds = [...new Set(candidates.map((c) => c.ipoId))];
  const existingRows: CandidateRow[] = candidateIpoIds.length
    ? (
        (await db.execute(sql`
          select s.id::text as id, s.ipo_id::text as "ipoId", to_char(s."timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "timestamp",
                 s.qib_subscription::text as "qibSubscription",
                 s.nii_subscription::text as "niiSubscription",
                 s.retail_subscription::text as "retailSubscription",
                 s.total_subscription::text as "totalSubscription",
                 s.employee_subscription::text as "employeeSubscription"
            from subscriptions s
           where s.ipo_id in (${sql.join(candidateIpoIds.map((id) => sql`${id}::uuid`), sql`, `)})`)) as unknown as { rows: CandidateRow[] }
      ).rows
    : [];
  const existingByIpoAndTs = new Map<string, CandidateRow>();
  for (const r of existingRows) {
    existingByIpoAndTs.set(`${r.ipoId}::${new Date(r.timestamp).toISOString()}`, r);
  }

  const plan = planRepair(candidates, existingByIpoAndTs);

  console.log(
    `${TOOL}: "${actual}" - ${candidates.length} BSE_ONLY row(s) stamped exactly 17:00:00 (T-999 shift class), ` +
      `${plan.toShift.length} to shift -5h30m, ${plan.toDeleteAsDuplicate.length} to delete as post-shift duplicates.`
  );
  for (const row of plan.toShift) {
    const shifted = new Date(new Date(row.timestamp).getTime() - SHIFT_MS).toISOString();
    console.log(`  ${cli.apply ? 'SHIFT' : 'would shift'}: ${row.slug} row ${row.id} ${row.timestamp} -> ${shifted}`);
  }
  for (const { row, survivorId } of plan.toDeleteAsDuplicate) {
    console.log(`  ${cli.apply ? 'DELETE' : 'would delete'}: ${row.slug} row ${row.id} (duplicate of ${survivorId} after shift)`);
  }

  let shiftedIds: string[] = [];
  let deletedIds: string[] = [];
  if (cli.apply) {
    if (plan.toShift.length > 0) {
      shiftedIds = await db.transaction(async (tx) => {
        const out: string[] = [];
        for (const row of plan.toShift) {
          const shifted = new Date(new Date(row.timestamp).getTime() - SHIFT_MS).toISOString();
          await tx.execute(
            sql`update subscriptions set "timestamp" = ${shifted}::timestamp where id = ${row.id}::uuid`
          );
          out.push(row.id);
        }
        return out;
      });
    }
    if (plan.toDeleteAsDuplicate.length > 0) {
      const ids = plan.toDeleteAsDuplicate.map((d) => d.row.id);
      await db.execute(sql`delete from subscriptions where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
      deletedIds = ids;
    }
  }

  writeLedgerFile(path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`), {
    tool: TOOL,
    database: actual,
    apply: cli.apply,
    at: new Date().toISOString(),
    candidates,
    plan,
    shiftedIds,
    deletedIds,
  });
  console.log(
    cli.apply
      ? `${TOOL}: APPLIED - ${shiftedIds.length} shifted, ${deletedIds.length} deleted as duplicates.`
      : `${TOOL}: DRY RUN - re-run with --apply to write.`
  );
  process.exit(0);
}

function valueAfter(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`${TOOL}: crashed:`, error);
    process.exit(1);
  });
}
