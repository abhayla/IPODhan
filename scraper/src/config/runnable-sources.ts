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
 * #240: `fallback`/`api` (API_FALLBACK, the ipoalerts.in fallback) retired —
 * it is not a source in the spec (`docs/design/data-sourcing-pull-model.md`
 * has zero hits for API_FALLBACK/ipoalerts) and not a walk fetcher, and its
 * scheduled cadence had been DEGRADED for 7+ cycles with no retire-by
 * decision (nightly `j_dead_source_retire_by`). Same retirement shape as
 * item 16's Moneycontrol: removed from the allow-list, not special-cased, so
 * it fails the same unrecognised-value path as any other bad string.
 */
export const CLI_SOURCE_ALIASES: Readonly<Record<string, ScraperSource>> = Object.freeze({
  nse: 'NSE',
  bse: 'BSE',
  chittorgarh: 'CHITTORGARH',
  gmp: 'INVESTORGAIN_GMP',
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
