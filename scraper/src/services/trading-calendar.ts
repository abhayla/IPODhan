/**
 * #1380 / F-220: the trading-holiday calendar the OD-21 working-day rules (listing_t3 / listing_t6,
 * DATE_WITHIN_WORKING_DAYS) judge against. Spec section 4.6 "working_days_inclusive, defined once": a
 * working day is not Saturday, not Sunday, not in the exchange holiday calendar. NSE and BSE trading
 * holidays are one set (F-220), so every TRADING/BOTH row of every exchange counts.
 *
 * Loaded ONCE per consolidation service build (memoized promise, one query; no per-field DB call) through
 * MarketHolidayRepository.findAllUncached. The calendar also records WHICH YEARS have at least one row:
 * a rule never judges a span touching a year with no rows (an empty calendar would count every weekday
 * as a working day and refuse good dates); it returns NO_RULE_APPLIES for that date instead.
 */
import { MarketHolidayRepository } from '@ipodhan/shared/repositories';
import logger from '../utils/logger.js';

export interface ResolvedTradingCalendar {
  holidays: ReadonlySet<string>;
  /** Calendar years (of the row DATE, not the year column) that have at least one TRADING/BOTH row. */
  years: ReadonlySet<number>;
}

export interface HolidayRowLike {
  date: string | Date;
  type: string;
}

/** TRADING rows only (a SETTLEMENT-only row is not a non-trading day); date text taken as stored. */
export function buildResolvedCalendar(rows: readonly HolidayRowLike[]): ResolvedTradingCalendar {
  const holidays = new Set<string>();
  const years = new Set<number>();
  for (const r of rows) {
    if (r.type !== 'TRADING') continue;
    const iso = typeof r.date === 'string' ? r.date.slice(0, 10) : null;
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    holidays.add(iso);
    years.add(Number(iso.slice(0, 4)));
  }
  return { holidays, years };
}

const RETRY_AFTER_FAILURE_MS = 60_000;

export class TradingCalendar {
  private loaded: Promise<ResolvedTradingCalendar | null> | null = null;
  private failedAt = 0;

  constructor(private readonly loadRows: () => Promise<readonly HolidayRowLike[]>) {}

  /** The calendar, loaded on first use; null when it could not be read (the rule then judges nothing). */
  resolve(): Promise<ResolvedTradingCalendar | null> {
    if (this.loaded && (this.failedAt === 0 || Date.now() - this.failedAt < RETRY_AFTER_FAILURE_MS)) {
      return this.loaded;
    }
    this.failedAt = 0;
    this.loaded = this.loadRows()
      .then((rows) => buildResolvedCalendar(rows))
      .catch((error: unknown) => {
        this.failedAt = Date.now();
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          '[TradingCalendar] #1380: could not read market_holidays; working-day rules judge nothing until it loads'
        );
        return null;
      });
    return this.loaded;
  }
}

/** The production calendar: one uncached read of market_holidays through the shared repository. */
export function createTradingCalendar(db: any, redis: any): TradingCalendar {
  const repository = new MarketHolidayRepository(db, redis);
  return new TradingCalendar(() => repository.findAllUncached());
}

/** A dependency may be a ready-made set (tests, callers that already hold one) or a lazy TradingCalendar. */
export async function resolveTradingHolidays(
  source: ReadonlySet<string> | TradingCalendar | undefined | null
): Promise<{ holidays: ReadonlySet<string> | null; years: ReadonlySet<number> | null }> {
  if (!source) return { holidays: null, years: null };
  if (source instanceof TradingCalendar) {
    const resolved = await source.resolve();
    return resolved ? { holidays: resolved.holidays, years: resolved.years } : { holidays: null, years: null };
  }
  return { holidays: source, years: null };
}
