/**
 * Item 7 S5: the `--job=price` process (spec §2.1 job row "Post-listing price", OD-29).
 * Wires the real clients, the DB and the narrow writes into `runPostListingPriceJob`.
 *
 * Lock (round 2, Tier A MAJOR 2): §2.1's lock table puts "the post-listing price fetch" in the
 * `live` class with the live-figures job and the grey-market fetch, TTL 4 minutes, skip-if-held.
 * So this job takes the SAME resource the live-figures job takes, `scraper:live`, with the same
 * 4-minute TTL. It does not collide with the live wakes on the cron minutes (prod price
 * :14/:29/:44/:59 and 15:30 vs live :05/:35; staging price :12/:27/:42/:57 and 15:30 vs live
 * :20/:50): a live run ends by its 3.5-minute deadline and a price run by its 3-minute one, so
 * neither is holding the lock when the other wakes. If one ever is, the arriving wake skips and
 * says so — the §2.1 behaviour for this lock.
 *
 * Bounds: a 3-minute run deadline (no new IPO is started after it; stalest-first order means
 * the next run begins where this one stopped), a 15-second timeout on every exchange request,
 * the wake wrapper's 300-second process ceiling (scripts/scraper-wake.sh, same as `live`), and
 * the lock's TTL if the process is killed outright.
 */
import { db, getRedisClient, IPORepository, FieldSourcesRepository } from '@ipodhan/shared';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import logger from '../utils/logger.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { defaultHolidayLookup } from '../services/document-cycle-calendar-gate.js';
import { writeDelistingState, writePostListingPrice, writePostListingState } from '../services/data-persister.js';
import { recordLiveStep } from '../services/step-ledger-recorders.js';
import {
  createPacer,
  defaultBseRawFetch,
  EXCHANGE_CALL_GAP_MS,
  EXCHANGE_REQUEST_TIMEOUT_MS,
  readBsePrice,
  readNsePrice,
} from '../scrapers/post-listing-quote.js';
import { fetchNseSymbolQuoteRaw } from '../scrapers/nse-api-client.js';
import { fetchBseScripMaster } from '../scrapers/bse-scrip-master.js';
import { isCloseReadIST, isPriceJobWindowIST, runPostListingPriceJob, selectPriceCandidates } from './post-listing-price.js';

/** §2.1 lock table: the `live` class — the live-figures job's own resource and TTL (index.ts LIVE_LOCK_*). */
export const PRICE_LOCK_RESOURCE = 'scraper:live';
export const PRICE_LOCK_TTL_MS = 4 * 60 * 1000;
/** Inside the 4-minute TTL with room for one in-flight 15-second request and the release. */
export const PRICE_JOB_DEADLINE_MS = 3 * 60 * 1000;

export async function runPostListingPriceWake(now: Date = new Date()): Promise<number> {
  if (!isPriceJobWindowIST(now)) {
    logger.info({ now: now.toISOString() }, 'Post-listing price job: outside market hours (09:15-15:30 IST, Mon-Fri) — ZERO network calls');
    return 0;
  }
  try {
    if (await defaultHolidayLookup.isHoliday(istDayIso(now))) {
      logger.info({ date: istDayIso(now) }, 'Post-listing price job: NSE holiday — ZERO network calls');
      return 0;
    }
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Post-listing price job: holiday lookup failed — treating today as a trading day');
  }

  const redis = getRedisClient();
  const lock = new DistributedLock(redis);
  const lockResult = await lock.acquire(PRICE_LOCK_RESOURCE, { ttl: PRICE_LOCK_TTL_MS });
  if (!lockResult.acquired) {
    logger.warn(
      { lockResource: PRICE_LOCK_RESOURCE },
      'Post-listing price job: scraper:live is held (the live-figures job or a previous price run; single HTTP reads, so a holder past its deadline is stuck) — skipping this occurrence, exit 0'
    );
    return 0;
  }
  logger.info({ lockResource: PRICE_LOCK_RESOURCE, ttlMs: PRICE_LOCK_TTL_MS }, 'Post-listing price job: took scraper:live (the §2.1 live lock class)');

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      await lock.release(PRICE_LOCK_RESOURCE, lockResult.token);
    } catch {
      // The 4-minute TTL expires it.
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    logger.warn({ signal }, 'Post-listing price job: signal received — releasing scraper:live before exit');
    void release().finally(() => process.exit(130));
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  const startedAt = Date.now();
  try {
    const closeRead = isCloseReadIST(now);
    const candidates = await selectPriceCandidates(db as any, now);
    const ipoRepository = new IPORepository(db as any, redis as any);
    const fieldSources = new FieldSourcesRepository(db as any, redis as any);
    const pace = createPacer(EXCHANGE_CALL_GAP_MS);
    const summary = await runPostListingPriceJob({
      now,
      candidates,
      deadlineAt: startedAt + PRICE_JOB_DEADLINE_MS,
      readNse: (symbol, segment, cachedSeries) =>
        readNsePrice(symbol, segment, {
          cachedSeries,
          fetchRaw: async (s, series) => {
            await pace();
            return fetchNseSymbolQuoteRaw(s, series, EXCHANGE_REQUEST_TIMEOUT_MS);
          },
        }),
      readBse: (scripCode) =>
        readBsePrice(scripCode, {
          fetchRaw: async (url) => {
            await pace();
            return defaultBseRawFetch(url);
          },
        }),
      loadBseScrips: async () => {
        await pace();
        const master = await fetchBseScripMaster({ timeoutMs: 2 * EXCHANGE_REQUEST_TIMEOUT_MS });
        return new Map([...master.byIsin].map(([isin, row]) => [isin, row.scripCode]));
      },
      writePrice: async (c, q) => {
        const result = await writePostListingPrice({
          ipoRepository: ipoRepository as any,
          fieldSources: fieldSources as any,
          sourceTrackingEnabled: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
          ipoId: c.id,
          existing: { currentPrice: c.currentPrice, currentPriceUpdatedAt: c.currentPriceUpdatedAt },
          price: q.price,
          asOf: q.asOf,
          source: q.exchange,
        });
        await recordLiveStep(c.id, 'H5', {
          source: q.exchange,
          evidence: { price: q.price, asOf: q.asOf.toISOString(), exchangeAsOfText: q.asOfText, outcome: result.outcome, fieldSources: result.fieldSources.length },
        });
        return result.outcome;
      },
      writeState: async (c, patch) => {
        await writePostListingState({
          ipoRepository: ipoRepository as any,
          ipoId: c.id,
          patch,
        });
      },
      writeDelisting: async (c, next, delistAt) => {
        await writeDelistingState({ ipoRepository: ipoRepository as any, ipoId: c.id, next, delistAt });
      },
      log: (line, fields) => logger.info(fields, line),
    });
    logger.info(
      {
        candidates: summary.candidates,
        closeRead,
        updated: summary.updated.length,
        confirmed: summary.confirmed.length,
        unchanged: summary.unchanged.length,
        stale: summary.stale,
        noPrice: summary.noPrice,
        refused: summary.refused,
        notReached: summary.notReached,
        delisting: summary.delisting,
        calls: summary.calls,
        elapsedMs: Date.now() - startedAt,
      },
      `Post-listing price job: run complete — ${summary.calls.total} exchange calls (NSE ${summary.calls.nse}, BSE ${summary.calls.bse}, BSE list ${summary.calls.bseList}) for ${summary.candidates} IPOs`
    );
    const priced = summary.updated.length + summary.confirmed.length + summary.unchanged.length + summary.stale.length;
    return summary.refused.length > 0 && priced === 0 ? 1 : 0;
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Post-listing price job failed');
    return 1;
  } finally {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    await release();
  }
}
