/**
 * The INVESTORGAIN_GMP fetcher for the field-plan walk (item 6, rank 1 for
 * `gmp_records.gmp` — the manifest's only field ranking this source;
 * `field-manifest.json`'s `gmp_records.gmp` entry, capability reason "grey
 * market has no official source, ever").
 *
 * CORE (per this task's brief): the grey-market job (OD-19's GMP job,
 * `scraper/src/scrapers/investorgain-gmp-orchestrator*.ts` via
 * `createGMPRecord` in `data-persister.ts`) already runs every 30 minutes and
 * writes `gmp_records` rows with `source: 'INVESTORGAIN_GMP'`. This fetcher
 * makes NO network call and runs NO scrape of its own — it is a pure READ of
 * the value that job already stored, exactly the shape `field-plan-walk-doc-fetcher.ts`
 * describes for its own source ("a `SELECT`, never a fresh read").
 *
 * WHY A DIRECT QUERY, NOT `GMPRepository.findLatest`: that method is a
 * CACHED read (`CacheTTL.GMP_LATEST`, `getFromCache`). PASS 3 (the walk) runs
 * in the SAME wake as the GMP job that may have just written a fresh row —
 * reading through a Redis cache risks answering with the value the cache
 * held before this cycle's GMP write landed. This fetcher reads `gmp_records`
 * directly (matching `makeIpoDetailsReader`'s direct-query convention in
 * `field-plan-walk-deps.ts` for the same reason: the walk answers from the
 * CURRENT row, not a stale cache).
 *
 * WHY FILTERED BY `source = 'INVESTORGAIN_GMP'`: `gmp_records.source` is a
 * free-text column (`varchar`, not an enum) but every write path in this
 * codebase writes the literal `'INVESTORGAIN_GMP'` (`data-persister.ts`'s
 * `createGMPRecord`) — there is no second writer. Filtering on it, rather
 * than reading the latest row regardless of source, is what makes this
 * fetcher answer for the manifest's INVESTORGAIN_GMP rank specifically
 * (mutation-tested below: swapping the filter to a different literal must
 * turn the test red).
 *
 * LIVE-FIGURE BEHAVIOUR (this task's brief asks the fetcher's design to say
 * what it does and why): OD-73 states "Live figures — status, subscription,
 * listing-day prices — are never settled and follow OD-19's refresh slots."
 * GMP is the same shape (§1.1's class table, `data-sourcing-pull-model.md`
 * line 500: "**W** | Neither document nor exchange publishes it (grey
 * market) | website only"; line 825 places `gmp_records.timestamp/gmp/source`
 * in class W with the rule "newest wins"). A field-plan row that reaches
 * `state = 'SUPPLIED'` is, TODAY, terminal for every fetcher in this walk —
 * `ipo-field-plan-repository.ts`'s own comment (`SUPPLIED-reopen ("chosenDemoted")
 * design removed 2026-09-24 after a regression ... a SUPPLIED row is never
 * touched by this upsert") states this is a system-wide property of the walk,
 * not something this fetcher can opt out of alone, and that the SUPPLIED-reopen
 * mechanism was tried and reverted the SAME DAY as this task for causing a
 * regression. This fetcher therefore answers plainly (SUPPLIED with the
 * latest value, or NOT_AVAILABLE_YET with no row yet) like every other
 * fetcher in this walk, and inherits the SAME settle-after-first-SUPPLIED gap
 * every other field in the walk already has — it does not attempt a
 * GMP-only reopen mechanism the design just rejected for a different field
 * the same day. Closing that gap for live figures generally is out of this
 * slice's scope; it is named here rather than silently built around.
 */

import type { FieldFetcher, FieldFetcherAnswer } from './field-plan-walk.js';

export interface GmpReader {
  /** Latest `gmp_records` row written by the InvestorGain GMP job for this IPO, or null if none yet. */
  findLatestFromInvestorGain(ipoId: string): Promise<{ gmp: number; timestamp: Date; id: string } | null>;
}

export interface InvestorgainGmpFetcherDeps {
  gmpReader: GmpReader;
  /** Manifest lookup: is `${tableName}.${fieldName}` marked capability.INVESTORGAIN_GMP.capable? */
  isInvestorgainGmpCapable: (tableName: string, fieldName: string) => boolean;
}

export const INVESTORGAIN_GMP_SERVEABLE_FIELDS: ReadonlySet<string> = new Set(['gmp_records.gmp']);

export function buildInvestorgainGmpFetcher(deps: InvestorgainGmpFetcherDeps): FieldFetcher {
  return async function investorgainGmpFetcher(
    ipoId: string,
    tableName: string,
    _rowKey: string,
    fieldName: string
  ): Promise<FieldFetcherAnswer> {
    // Only capability.INVESTORGAIN_GMP.capable === false may answer
    // NOT_PRINTED: the manifest saying "this source never carries this
    // field" is a settled fact. Every other gap is a code limitation and
    // must stay re-askable (CHECK_FAILED, transient) — the same rule the
    // BSE/NSE/CHITTORGARH fetchers use.
    if (!deps.isInvestorgainGmpCapable(tableName, fieldName)) {
      return { outcome: 'NOT_PRINTED' };
    }

    const key = `${tableName}.${fieldName}`;
    if (!INVESTORGAIN_GMP_SERVEABLE_FIELDS.has(key)) {
      return {
        outcome: 'CHECK_FAILED',
        reason: `INVESTORGAIN_GMP has no mapped field for ${key} yet (coverage gap, not a manifest no)`,
        gap: 'NO_MAPPING',
        transient: true,
      };
    }

    let latest: Awaited<ReturnType<GmpReader['findLatestFromInvestorGain']>>;
    try {
      latest = await deps.gmpReader.findLatestFromInvestorGain(ipoId);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }

    if (!latest) {
      // The GMP job hasn't run for this IPO yet (or has never written a
      // row) — re-askable, not a settled "not here".
      return { outcome: 'NOT_AVAILABLE_YET' };
    }

    // OD-99 (OD-73): this value IS the one already stored in gmp_records --
    // the GMP job wrote it (§2.1). Declared as `stored` so the walk records
    // SUPPLIED and writes nothing; gmp_records is one row per GMP job run, so
    // there is no single row the consolidated writer could key a write to.
    return { outcome: 'SUPPLIED', value: latest.gmp, stored: { value: latest.gmp } };
  };
}
