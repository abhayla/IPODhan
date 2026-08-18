/**
 * Listing-performance cadence guard for the one-shot production scraper.
 *
 * T-176 (docs/monitoring/scrape-cadence-measurement.md) confirmed the dedicated
 * `listingPerformanceUpdate` scheduler job (`scheduler/config.ts`,
 * `scheduler/jobs/listing-performance-update.ts`) never runs in production —
 * the only scraper process PM2 manages is the one-shot `--source=all` CLI
 * (`scraper/src/index.ts`) on a flat 30-minute cron, 24/7. That entrypoint has
 * no notion of the dedicated job's market-hours/after-hours/weekends tiers.
 *
 * This guard reproduces the ORIGINAL cadence intent
 * (`PROD_SCHEDULES.listingPerformanceUpdate` in `scheduler/config.ts`:
 * "Market Hours: Every 30 minutes; After Hours: Every 2 hours; Weekends: Every
 * 4 hours") on top of the flat 30-min one-shot trigger, so wiring the job into
 * the live path doesn't hammer NSE/BSE with a per-IPO live-price fetch loop
 * every single cycle outside trading hours.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

export interface IstClock {
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
}

/** Convert a UTC instant to its IST (Asia/Kolkata, UTC+5:30) wall-clock fields. */
export function toIst(now: Date): IstClock {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    dayOfWeek: ist.getUTCDay(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

/**
 * Decide whether THIS one-shot cycle should run the listing-performance
 * update, matching the dedicated job's original tiered intent:
 *   - Market hours (Mon-Fri, 09:00-17:59 IST): every cycle (~every 30 min,
 *     matching the flat cron the one-shot process already runs on).
 *   - After hours (Mon-Fri, outside market hours): once every 2 hours.
 *   - Weekends (Sat/Sun): once every 4 hours.
 */
export function shouldRunListingPerformanceUpdate(now: Date): boolean {
  const { dayOfWeek, hour, minute } = toIst(now);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isMarketHours = !isWeekend && hour >= 9 && hour < 18;

  if (isMarketHours) {
    return true;
  }

  if (isWeekend) {
    return hour % 4 === 0 && minute < 30;
  }

  // Weekday, after hours.
  return hour % 2 === 0 && minute < 30;
}
