/**
 * #1380 / F-220 repair: delete the exchange-specific market_holidays rows that are one-day-early copies
 * of another exchange's row (class: calendar-date-stored-one-day-early). NSE and BSE trading holidays are
 * one set; on staging 23 NSE-only 2025 rows were each one day before the same holiday's BOTH row (Good
 * Friday NSE 2025-04-17 Thu vs BOTH 2025-04-18), so real trading weekdays read as holidays.
 *
 * Selection is BY RULE (scripts/lib/shifted-holiday-copies.mjs, shared with the nightly check
 * h_market_holiday_shifted_copy), never a list of dates: an NSE or BSE TRADING row whose date + 1 day is a
 * TRADING row of the other exchange (or BOTH) with the same description, and whose own date is not carried
 * by the other exchange. A genuine exchange-only holiday and a real double holiday are never selected.
 * The dry run prints every selected row and the row it copies. --apply deletes exactly those rows in ONE
 * transaction and re-reads inside it (count must match, nothing may remain selected), else it rolls back.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-shifted-market-holidays.ts --expect-db ipodhan_staging            # dry run
 *   npx tsx scripts/repair-shifted-market-holidays.ts --expect-db ipodhan_staging --apply    # apply
 * --apply needs --expect-db; prod (ipodhan) is refused without --allow-prod (openRepairDb).
 * The web holidays page caches market_holidays:* for 30 days; after an apply on a remote DB drop those keys
 * on the box (docs/ops/prod-ops-recipes.md section 5). The scraper reads the table uncached.
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRepairDb, readExpectDbFlag, writeLedgerFile, type ExecuteLike, type RepairLedgerFieldChange } from './lib/repair-tool';
import { deleteShiftedHolidayCopies, findShiftedHolidayCopies } from '../src/services/shifted-market-holidays';

const TOOL = 'repair-shifted-market-holidays';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const allowProd = argv.includes('--allow-prod');
  const expectDb = readExpectDbFlag(argv);
  if (apply && !expectDb) {
    console.error(`${TOOL}: --apply needs --expect-db <name>; refusing to guess the target database.`);
    process.exit(1);
  }
  const { dbName } = await openRepairDb(db as ExecuteLike, { apply, allowProd, toolName: TOOL, expectDb });

  const selected = await findShiftedHolidayCopies(db as never);
  console.log(`\n${TOOL}: ${selected.length} shifted holiday row(s) selected in "${dbName}".`);
  for (const s of selected) {
    console.log(
      `  ${s.row.id} | ${s.row.date} ${s.weekday} | ${s.row.exchange} | ${s.row.description}` +
        `  <- copy of ${s.copyOf.id} | ${s.copyOf.date} | ${s.copyOf.exchange} | ${s.copyOf.description}`
    );
  }

  let deleted = 0;
  if (apply) {
    const result = await deleteShiftedHolidayCopies(db as never);
    deleted = result.deleted;
    console.log(`${TOOL}: deleted ${deleted} row(s) in one transaction; re-read found none left to select.`);
  }

  const changes: RepairLedgerFieldChange[] = selected.map((s) => ({
    table: 'market_holidays',
    rowKey: { id: s.row.id, date: s.row.date, exchange: s.row.exchange, copyOf: s.copyOf.id },
    field: 'row',
    before: `${s.row.exchange} ${s.row.date} ${s.row.description}`,
    after: apply ? '(deleted)' : '(would be deleted)',
  }));
  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    { tool: TOOL, mode: apply ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(), changes, database: dbName, selected: selected.length, deleted }
  );
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);
  if (!apply) console.log(`${TOOL}: DRY RUN — nothing was written.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`${TOOL}: FAILED — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
