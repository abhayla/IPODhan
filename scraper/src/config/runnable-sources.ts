/**
 * The sources the scheduler can actually run, in one place.
 *
 * Item 16 slice 2. This list already existed — inline in `index.ts`, as the
 * array `--source=` is validated against. Being inline meant nothing else could
 * read it, so when item 16 retired Moneycontrol from that array, Moneycontrol's
 * freshness SLO stayed armed and nothing noticed. The monitor kept asking the
 * database when a retired source had last succeeded, and would have paged the
 * owner about it on 2026-09-17.
 *
 * So the allow-list moves here and `index.ts` imports it. Retiring a source is
 * now one edit in one file, and `freshness-slo-no-retired-sources.test.ts`
 * fails if an SLO is left behind.
 *
 * NOT the same thing as `ScraperSource`. That type still includes MONEYCONTROL
 * and must: `scraper_logs` and `field_sources` hold real historical rows
 * attributed to it, and those rows are not being rewritten. "A source that
 * exists in the data" and "a source the scheduler will run tonight" are
 * different questions, and conflating them is what would tempt someone to
 * delete history to make a check pass.
 */
import type { ScraperSource } from './field-priority-matrix.js';

/**
 * CLI argument -> the `ScraperSource` its scrape is recorded under.
 *
 * `fallback` and `api` are two spellings of the same runner, which is why the
 * map has more keys than the set below has members.
 */
export const CLI_SOURCE_ALIASES: Readonly<Record<string, ScraperSource>> = Object.freeze({
  nse: 'NSE',
  bse: 'BSE',
  chittorgarh: 'CHITTORGARH',
  gmp: 'INVESTORGAIN_GMP',
  fallback: 'API_FALLBACK',
  api: 'API_FALLBACK',
});

/** The `--source=` values `index.ts` accepts. `all` runs every runner above. */
export const CLI_SOURCE_ARGS: readonly string[] = Object.freeze([
  ...Object.keys(CLI_SOURCE_ALIASES),
  'all',
]);

/**
 * The sources a scheduled cycle can still produce a success for.
 *
 * Derived from the alias map rather than retyped, so the two cannot disagree:
 * a source removed from the map leaves this set in the same edit.
 */
export const RUNNABLE_SCRAPER_SOURCES: readonly ScraperSource[] = Object.freeze(
  Array.from(new Set(Object.values(CLI_SOURCE_ALIASES)))
);
