/**
 * The NSE fetcher for the field-plan walk (item 6).
 *
 * Why this exists: 57 manifest fields rank NSE, including the six E-1 fields
 * only the exchange may state (open/close/listing/allotment dates, status,
 * listing exchanges). With no NSE fetcher registered, every one of those plan
 * rows answered `NO_FETCHER_REGISTERED` on every wake -- 136 rows measured on
 * staging 2026-09-20. Two issues, #705 and #759, were both describing this one
 * gap from opposite ends.
 *
 * Ruling 33, same as the BSE fetcher: a whole-source fetch, at most once per
 * cycle. `scrapeNSEIPOs()` is called AT MOST ONCE per `NseFieldFetcherState`
 * instance and memoised, so a second field of the same IPO -- or a different
 * IPO -- in the same cycle reuses the board rather than refetching. It is the
 * SAME function the NSE orchestrator calls, never a second HTTP client with
 * its own headers and backoff.
 *
 * RESOLUTION ORDER (symbol -> isin -> normalised name), matching the BSE
 * fetcher: symbol and ISIN are the exchange's own identifiers when present;
 * company name needs normalising because casing and suffixes ("Limited" vs
 * "Ltd") differ from what is stored.
 *
 * CAPABILITY: only fields `NSE_SERVEABLE_FIELDS` names are served, and that
 * set is what `scrapeNSEIPOs()` actually populates. A field the manifest marks
 * NSE-capable but this mapping does not handle answers CHECK_FAILED
 * **transient**, never NOT_PRINTED -- a gap in this adapter is a code
 * limitation, and retiring a field for it would mean extending the mapping
 * later could not bring the field back without a manual requeue. That
 * reasoning is the BSE fetcher's review-round-2 finding, applied here rather
 * than rediscovered.
 */

import type { FieldFetcher, FieldFetcherAnswer } from './field-plan-walk.js';
import type { IPORepository } from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { scrapeNSEIPOs } from '../scrapers/nse-scraper.js';
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { logger } from '../utils/logger.js';

type NseBoardRow = Awaited<ReturnType<typeof scrapeNSEIPOs>>['ipos'][number];

/**
 * `${tableName}.${camelFieldName}` -> the board key NSE actually carries for
 * it. Derived from what `scrapeNSEIPOs()` populates, NOT from what the
 * manifest says NSE is capable of: the manifest states policy, this states
 * what the adapter can serve today.
 */
const NSE_SERVEABLE_FIELDS: ReadonlyMap<string, keyof NseBoardRow> = new Map<string, keyof NseBoardRow>([
  ['ipos.symbol', 'symbol'],
  ['ipos.companyName', 'companyName'],
  ['ipos.openDate', 'openDate'],
  ['ipos.closeDate', 'closeDate'],
  ['ipos.priceRangeMin', 'priceRangeMin'],
  ['ipos.priceRangeMax', 'priceRangeMax'],
  ['ipos.lotSize', 'lotSize'],
  ['ipos.isin', 'isin'],
]);

export interface NseFetcherDeps {
  ipoRepository: IPORepository;
  /** Manifest lookup: is `${tableName}.${fieldName}` marked capability.NSE.capable? */
  isNseCapable: (tableName: string, fieldName: string) => boolean;
}

/**
 * Per-cycle memo state -- construct ONE instance per document-cycle wake and
 * pass the SAME instance to every IPO's walk, mirroring the BSE fetcher's
 * per-cycle-not-per-IPO construction in field-plan-walk-deps.ts.
 */
export class NseFieldFetcherState {
  private board: Promise<NseBoardRow[]> | null = null;

  private getBoard(): Promise<NseBoardRow[]> {
    if (!this.board) {
      this.board = scrapeNSEIPOs().then((r) => r.ipos);
    }
    return this.board;
  }

  /**
   * symbol -> isin -> normalised name. Returns a discriminated result rather
   * than a row-or-null so the caller can tell "no match" (re-askable) from
   * "several matched" (never guess) -- the same three-way shape the BSE
   * fetcher uses.
   */
  async resolveRow(
    deps: NseFetcherDeps,
    ipoId: string
  ): Promise<
    | { status: 'found'; row: NseBoardRow }
    | { status: 'not_found' }
    | { status: 'ambiguous'; cause: string }
  > {
    const ipo = await deps.ipoRepository.findById(ipoId);
    if (!ipo) return { status: 'not_found' };

    const board = await this.getBoard();

    if (ipo.symbol) {
      const bySymbol = board.filter((r) => r.symbol && r.symbol === ipo.symbol);
      if (bySymbol.length === 1) return { status: 'found', row: bySymbol[0] };
      if (bySymbol.length > 1) {
        return { status: 'ambiguous', cause: `${bySymbol.length} NSE rows share symbol ${ipo.symbol}` };
      }
    }

    if (ipo.isin) {
      const byIsin = board.filter((r) => r.isin && r.isin === ipo.isin);
      if (byIsin.length === 1) return { status: 'found', row: byIsin[0] };
      if (byIsin.length > 1) {
        return { status: 'ambiguous', cause: `${byIsin.length} NSE rows share isin ${ipo.isin}` };
      }
    }

    const wanted = normalizeCompanyNameForMatching(ipo.companyName);
    const byName = board.filter(
      (r) => r.companyName && normalizeCompanyNameForMatching(r.companyName) === wanted
    );
    if (byName.length === 1) return { status: 'found', row: byName[0] };
    if (byName.length > 1) {
      return { status: 'ambiguous', cause: `${byName.length} NSE rows normalise to "${wanted}"` };
    }
    return { status: 'not_found' };
  }
}

export function buildNseFetcher(deps: NseFetcherDeps, state: NseFieldFetcherState): FieldFetcher {
  return async function nseFetcher(
    ipoId: string,
    tableName: string,
    _rowKey: string,
    fieldName: string
  ): Promise<FieldFetcherAnswer> {
    // Only capability.NSE.capable === false may answer NOT_PRINTED: that is the
    // manifest saying "this source never carries this field", which is settled.
    if (!deps.isNseCapable(tableName, fieldName)) {
      return { outcome: 'NOT_PRINTED' };
    }

    const camelFieldName = columnToCamelCase(fieldName);
    const key = `${tableName}.${camelFieldName}`;
    const boardKey = NSE_SERVEABLE_FIELDS.get(key);
    if (!boardKey) {
      // Manifest says capable, this adapter cannot serve it yet. A code gap
      // stays re-askable so extending the mapping later does not require
      // manually requeueing every field it would otherwise have retired.
      return {
        outcome: 'CHECK_FAILED',
        reason: `NSE has no mapped field for ${key} yet (coverage gap, not a manifest no)`,
        transient: true,
      };
    }

    let resolved: Awaited<ReturnType<NseFieldFetcherState['resolveRow']>>;
    try {
      resolved = await state.resolveRow(deps, ipoId);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }

    if (resolved.status === 'not_found') {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
    if (resolved.status === 'ambiguous') {
      // Never guess. NOT_AVAILABLE_YET carries no reason field (its shape is
      // fixed across every fetcher), so the cause is logged here instead
      // (signal-ownership R6: every failure carries its cause).
      logger.warn({ ipoId, tableName, fieldName, cause: resolved.cause }, 'PASS 3 NSE fetcher: refusing to guess');
      return { outcome: 'NOT_AVAILABLE_YET' };
    }

    const value = resolved.row[boardKey];
    if (value === undefined || value === null || value === '') {
      // The board carries this field but this IPO has no value for it yet --
      // re-askable, not a settled "not here".
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
    return { outcome: 'SUPPLIED', value: value as never };
  };
}
