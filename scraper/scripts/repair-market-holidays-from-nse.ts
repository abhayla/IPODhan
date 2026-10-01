/**
 * Reconcile one year of market_holidays to NSE's own trading-holiday list (F-220, F-221, #1380).
 *
 * Dry run by default: prints INSERT / MOVE / UPDATE / RETIRE per date (weekday + description).
 * `--apply` writes the plan in ONE transaction and re-reads the year inside it; anything but an
 * exact match with NSE's list rolls the whole year back. Every exchange label is reconciled (the
 * typed BOTH rows of F-221 included); the result is one BOTH/TRADING row per NSE date.
 *
 *   cd scraper && npx tsx scripts/repair-market-holidays-from-nse.ts --year 2026 --expect-db ipodhan_staging
 *   cd scraper && npx tsx scripts/repair-market-holidays-from-nse.ts --year 2026 --expect-db ipodhan_staging --apply
 *   ... --answer-file tests/fixtures/nse/holiday-master-trading-2026-10-02.json   (a saved NSE answer, no fetch)
 *
 * `--apply` of a plan that retires+moves more than 2 rows or more than 20% of the stored rows needs
 * `--accept-plan <sha256>`, the value the dry run printed for that same plan. `--answer-file` older than
 * 7 days is refused unless `--allow-old-answer`.
 *
 * Guards: `--expect-db <name>` is mandatory (dry run too); a production `--apply` is refused
 * without `--allow-prod` (openRepairDb). NSE answer states -> exit codes: 3 unreadable (HTTP error,
 * timeout, block, non-JSON), 4 no rows for the year, 5 unparseable rows; nothing is written in
 * any of them (6 implausibly short answer, 7 big plan not accepted). After an apply, web's market_holidays:* Redis keys are dropped (SCAN + DEL), or
 * the exact on-box command is printed when this box's Redis is not that slot's Redis.
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db, getRedisClient } from '@ipodhan/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectFlagValues,
  guardCacheInvalidation,
  openRepairDb,
  readExpectDbFlag,
  repairToolRedisSlot,
  resolveRedisTargetHost,
  writeLedgerFile,
  type ExecuteLike,
  type RepairLedgerFieldChange,
} from './lib/repair-tool';
import { fetchNseHolidayMaster } from '../../scripts/lib/nse-holiday-calendar.mjs';
import {
  checkAnswerFileAge,
  holidayCacheDropCommand,
  reconcileMarketHolidayYear,
  type NseFetchResult,
} from '../src/services/market-holidays-reconcile';

const TOOL = 'repair-market-holidays-from-nse';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Every key web/lib/repositories/market-holiday-repository.ts writes: all, upcoming:*, year:*, exchange:*, range:*. */
const CACHE_PATTERN = 'market_holidays:*';

async function dropHolidayCache(dbName: string): Promise<void> {
  // The shared notice prints a plain DEL of the given keys; a pattern needs SCAN, so the tool prints its own.
  const { blocked } = guardCacheInvalidation({ dbName, toolName: TOOL, keys: [CACHE_PATTERN], log: () => {} });
  if (blocked) {
    const redisHost = resolveRedisTargetHost({ redisUrl: process.env.REDIS_URL, redisHost: process.env.REDIS_HOST });
    const { slot, dbIndex } = repairToolRedisSlot(dbName);
    console.log(
      `${TOOL}: cache NOT dropped — this box's Redis (${redisHost ?? 'unset, localhost:6379'}) is not "${dbName}"'s slot Redis. Run on the VPS (docs/ops/prod-ops-recipes.md §5):\n` +
        `  ${holidayCacheDropCommand(slot, dbIndex)}`
    );
    return;
  }
  const redis = getRedisClient();
  let cursor = '0';
  let dropped = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', CACHE_PATTERN, 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) dropped += await redis.del(...keys);
  } while (cursor !== '0');
  console.log(`${TOOL}: dropped ${dropped} Redis key(s) matching ${CACHE_PATTERN}.`);
  await redis.quit();
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const allowProd = argv.includes('--allow-prod');
  const expectDb = readExpectDbFlag(argv);
  const yearText = collectFlagValues(argv, '--year')[0];
  const answerFile = collectFlagValues(argv, '--answer-file')[0];
  const acceptPlan = collectFlagValues(argv, '--accept-plan')[0];
  const allowOldAnswer = argv.includes('--allow-old-answer');
  const year = Number(yearText);
  if (!yearText || !Number.isInteger(year) || year < 2000 || year > 2100) {
    console.error(`${TOOL}: --year <YYYY> is required (got ${yearText ?? 'nothing'}).`);
    return 2;
  }
  if (!expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required; refusing to guess the target database.`);
    return 2;
  }
  if (answerFile) {
    const age = checkAnswerFileAge(fs.statSync(path.resolve(answerFile)).mtimeMs, Date.now(), allowOldAnswer);
    console.log(`${TOOL}: ${age.message}.`);
    if (!age.ok) return 2;
  }
  const { dbName } = await openRepairDb(db as unknown as ExecuteLike, { apply, allowProd, toolName: TOOL, expectDb });

  const answer: NseFetchResult = answerFile
    ? { ok: true, body: fs.readFileSync(path.resolve(answerFile), 'utf8') }
    : await fetchNseHolidayMaster();
  console.log(`${TOOL}: ${apply ? 'APPLY' : 'DRY RUN'} year ${year} on "${dbName}", NSE answer from ${answerFile ?? 'live holiday-master'}.`);

  const outcome = await reconcileMarketHolidayYear({ db: db as never, year, apply, answer, acceptPlan });
  if (outcome.exitCode !== 0) {
    console.error(`${TOOL}: ${outcome.state} — ${outcome.cause}. Nothing was written.`);
    return outcome.exitCode;
  }

  const changes: RepairLedgerFieldChange[] = outcome.actions.map((a) => ({
    table: 'market_holidays',
    rowKey: { id: a.id ?? null, year, kind: a.kind },
    field: 'date',
    before: a.kind === 'insert' ? null : `${a.from ?? a.date} [${a.exchangeBefore ?? a.exchange ?? '?'}] ${a.before ?? a.description}`,
    after: a.kind === 'retire' ? null : `${a.date} [BOTH] ${a.description}`,
  }));
  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${year}-${outcome.applied ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    {
      tool: TOOL,
      mode: outcome.applied ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      changes,
      database: dbName,
      year,
      nseDates: outcome.nseDates,
    }
  );
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);
  if (outcome.applied) await dropHolidayCache(dbName);
  else console.log(`${TOOL}: ${apply ? 'nothing to change' : 'DRY RUN — nothing was written'}.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`${TOOL}: FAILED — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
