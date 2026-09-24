/**
 * Item 7 S5: the `--job=price` process (spec §2.1 job row "Post-listing price", OD-29).
 * Wires the real clients, the DB and the narrow write into `runPostListingPriceJob`.
 *
 * Lock: its own `scraper:price` resource in the `live` class (§2.1: the price job takes
 * `live`, never the heavy `scraper:cycle`), skip-if-held. It is a separate resource from the
 * live-figures job's `scraper:live` because both wake on the same :00/:30 minutes and a
 * shared resource would make one of them skip every half hour. TTL 14 minutes: one run must
 * finish inside its 15-minute cadence, and a run still holding the lock after that is stuck.
 */
import { db, getRedisClient, IPORepository, FieldSourcesRepository } from '@ipodhan/shared';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import logger from '../utils/logger.js';
import { DistributedLock } from '../utils/distributed-lock.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { defaultHolidayLookup } from '../services/document-cycle-calendar-gate.js';
import { writePostListingPrice, writePostListingSymbolReads } from '../services/data-persister.js';
import { recordLiveStep } from '../services/step-ledger-recorders.js';
import { readBsePrice, readNsePrice } from '../scrapers/post-listing-quote.js';
import { fetchBseScripMaster } from '../scrapers/bse-scrip-master.js';
import { isPriceJobWindowIST, runPostListingPriceJob, selectPriceCandidates } from './post-listing-price.js';

export const PRICE_LOCK_RESOURCE = 'scraper:price';
export const PRICE_LOCK_TTL_MS = 14 * 60 * 1000;

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
    logger.warn({ lockResource: PRICE_LOCK_RESOURCE }, 'Post-listing price job: previous run still holds scraper:price — skipping this occurrence, exit 0');
    return 0;
  }
  try {
    const candidates = await selectPriceCandidates(db as any, now);
    const ipoRepository = new IPORepository(db as any, redis as any);
    const fieldSources = new FieldSourcesRepository(db as any, redis as any);
    const summary = await runPostListingPriceJob({
      now,
      candidates,
      readNse: (symbol, segment) => readNsePrice(symbol, segment),
      readBse: (scripCode) => readBsePrice(scripCode),
      loadBseScrips: async () => {
        const master = await fetchBseScripMaster();
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
      writeReads: async (c, reads, delistedOn) => {
        await writePostListingSymbolReads({ ipoRepository: ipoRepository as any, ipoId: c.id, reads, delistedOn });
        if (reads > 0) {
          await recordLiveStep(c.id, 'H5', { status: 'FAILED', error: `no-such-symbol read ${reads} of 3${delistedOn ? `; delisted on ${delistedOn}` : ''}` });
        }
      },
      log: (line, fields) => logger.info(fields, line),
    });
    logger.info(
      {
        candidates: summary.candidates,
        updated: summary.updated.length,
        unchanged: summary.unchanged.length,
        noSymbol: summary.noSymbol,
        delisted: summary.delisted,
        refused: summary.refused,
        notJudged: summary.notJudged,
        calls: summary.calls,
      },
      'Post-listing price job: run complete'
    );
    return summary.refused.length > 0 && summary.updated.length + summary.unchanged.length === 0 ? 1 : 0;
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Post-listing price job failed');
    return 1;
  } finally {
    try {
      await lock.release(PRICE_LOCK_RESOURCE, lockResult.token);
    } catch {
      // The 14-minute TTL expires it.
    }
  }
}
