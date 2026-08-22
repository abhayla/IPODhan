/**
 * Freshness SLO config (T-195) — data-class -> max staleness, seeded from the
 * MEASURED scrape cadence (T-176, docs/monitoring/scrape-cadence-measurement.md),
 * NEVER from the undeployed Asia/Kolkata market-hour tiers in
 * scheduler/config.ts (T-176 §3: only the flat 30-min PM2 cron actually runs
 * in production).
 *
 * T-176 measured ALL SIX live scraper sources (NSE, BSE, MONEYCONTROL,
 * CHITTORGARH, INVESTORGAIN_GMP, API_FALLBACK) firing on a flat 30-minute PM2
 * cron, 24/7, with p90 gap ~30.3 min and a max observed gap of 91 min (a
 * single missed cycle, not a sustained outage). Each source below is assigned
 * to the data class it is the *specialist* source for, per
 * `field-priority-matrix.ts`'s `sources[]` ordering — and that class's SLO
 * decides how stale the source's last successful run may be before it pages.
 *
 * This is a config module only — no thresholds are hardcoded at call sites.
 * See `freshness-monitor.ts` for the evaluator that reads this table.
 */
import type { ScraperSource } from '../services/types.js';

export type FreshnessDataClass =
  | 'open-ipo-gmp-subscription'
  | 'open-ipo-price-band-dates'
  | 'listed-company-statics';

export interface FreshnessSLO {
  source: ScraperSource;
  dataClass: FreshnessDataClass;
  maxStalenessMs: number;
  justification: string;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * 90 min = the T-176-measured 30-min flat cycle x 2 missed cycles + one
 * margin cycle, i.e. up to ~3 missed cycles before paging. This deliberately
 * sits just above T-176's own observed max gap of 91 min (a single-cycle
 * blip correlated with a deploy/restart) so that ONE missed cycle does not
 * itself page, but two consecutive misses do.
 */
const OPEN_IPO_REALTIME_MAX_STALENESS_MS = 90 * MIN;

/**
 * 6h for price band / open date / close date: these fields change far less
 * often intraday than GMP/subscription, and their specialist sources (NSE,
 * BSE — see `priceRangeMin`/`priceRangeMax`/`open_date`/`close_date` in
 * field-priority-matrix.ts, `sources[0]`/`sources[1]`) still run the same
 * flat 30-min cadence. 6h is a generous multiple (12 missed cycles) that
 * still catches a genuinely dead source well inside a single trading day.
 */
const PRICE_BAND_DATES_MAX_STALENESS_MS = 6 * HOUR;

/**
 * 7d for the supplementary/fallback sources (MONEYCONTROL's broad coverage,
 * API_FALLBACK's on-demand-only fallback role — see index.ts's `'manual'`
 * trigger reason). This matches the project's own existing bar for
 * slow-changing reference data: `CacheTTL.REFERENCE` in
 * `web/lib/cache/cache-keys.ts` is already 604800s (7 days) for
 * registrars/holidays/sectors.
 */
const LISTED_STATICS_MAX_STALENESS_MS = 7 * DAY;

export const FRESHNESS_SLOS: FreshnessSLO[] = [
  {
    source: 'INVESTORGAIN_GMP',
    dataClass: 'open-ipo-gmp-subscription',
    maxStalenessMs: OPEN_IPO_REALTIME_MAX_STALENESS_MS,
    justification:
      'GMP specialist — field-priority-matrix.ts gmp_price/gmp_percentage sources[0]. 30-min measured cadence x 2 missed cycles + margin (T-176).',
  },
  {
    source: 'CHITTORGARH',
    dataClass: 'open-ipo-gmp-subscription',
    maxStalenessMs: OPEN_IPO_REALTIME_MAX_STALENESS_MS,
    justification:
      'GMP secondary specialist + subscription source, same flat 30-min measured cadence as INVESTORGAIN_GMP (T-176).',
  },
  {
    source: 'NSE',
    dataClass: 'open-ipo-price-band-dates',
    maxStalenessMs: PRICE_BAND_DATES_MAX_STALENESS_MS,
    justification:
      'priceRangeMin/priceRangeMax/open_date/close_date sources[0] (field-priority-matrix.ts) — critical fields, generous 6h multiple of the 30-min cadence.',
  },
  {
    source: 'BSE',
    dataClass: 'open-ipo-price-band-dates',
    maxStalenessMs: PRICE_BAND_DATES_MAX_STALENESS_MS,
    justification:
      'priceRangeMin/priceRangeMax/open_date/close_date sources[1] (field-priority-matrix.ts) — same class/SLO as NSE.',
  },
  {
    source: 'MONEYCONTROL',
    dataClass: 'listed-company-statics',
    maxStalenessMs: LISTED_STATICS_MAX_STALENESS_MS,
    justification:
      'Broad supplementary coverage, lower-criticality than the NSE/BSE/GMP specialists; matches CacheTTL.REFERENCE (7d) for slow-changing reference data.',
  },
  {
    source: 'API_FALLBACK',
    dataClass: 'listed-company-statics',
    maxStalenessMs: LISTED_STATICS_MAX_STALENESS_MS,
    justification:
      "On-demand fallback only (index.ts 'manual' trigger reason) — not a primary-cadence source; matches CacheTTL.REFERENCE (7d).",
  },
];

/** Look up the freshness SLO for a scraper source. Returns undefined for sources not covered (e.g. ADMIN, DRHP — not scraper-log-tracked sources). */
export function getFreshnessSLO(source: ScraperSource): FreshnessSLO | undefined {
  return FRESHNESS_SLOS.find((slo) => slo.source === source);
}
