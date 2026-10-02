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
 *
 * OFF THE BOARDS (#1486): the boards list only current and upcoming issues. An IPO that has left
 * them (CLOSED / LISTED / WITHDRAWN) used to answer "not on the board" or, when the board scrape
 * failed, "NSE board empty" on every re-ask, so a band NSE corrected after close (Runwal
 * Enterprises: 290-302 stored, NSE states 290-305) was never re-read. The SAME ask now reads
 * `/api/ipo-detail` for that IPO, by its ACTIVE `NSE_ISSUE` source key (OD-85; never a name
 * search), at most once per IPO per cycle, through the same NSE client. Answer states:
 *
 *   on board                                    -> the board value, as before
 *   off board, detail states the value          -> SUPPLIED
 *   off board, detail empty / field not carried -> NOT_AVAILABLE_YET (abstention, OD-60)
 *   off board, detail request failed            -> CHECK_FAILED with the cause (OD-145: unknown)
 *   off board, detail duplicated / unparseable  -> CHECK_FAILED with the reason (fail closed)
 *   off board, detail for another symbol        -> CHECK_FAILED (identity mismatch)
 *   two ACTIVE NSE keys / a non-EQ/SME series   -> CHECK_FAILED, no request
 *   no ACTIVE NSE key                           -> as before: NOT_AVAILABLE_YET when the board was
 *                                                  read, CHECK_FAILED when the board failed
 */

import type { FieldFetcher, FieldFetcherAnswer } from './field-plan-walk.js';
import type { IPORepository } from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { scrapeNSEIPOs } from '../scrapers/nse-scraper.js';
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { logger } from '../utils/logger.js';
import { parseNseDetailFields, type NseDetailField, type NseDetailParse } from '../scrapers/nse-detail-fields.js';

type NseBoardRow = Awaited<ReturnType<typeof scrapeNSEIPOs>>['ipos'][number];

/**
 * `${tableName}.${camelFieldName}` -> the board key NSE actually carries for
 * it. Derived from what `scrapeNSEIPOs()` populates, NOT from what the
 * manifest says NSE is capable of: the manifest states policy, this states
 * what the adapter can serve today.
 */
export const NSE_SERVEABLE_FIELDS: ReadonlyMap<string, keyof NseBoardRow> = new Map<string, keyof NseBoardRow>([
  ['ipos.symbol', 'symbol'],
  ['ipos.companyName', 'companyName'],
  ['ipos.openDate', 'openDate'],
  ['ipos.closeDate', 'closeDate'],
  // NOT ipos.listingDate (#1228 review r1): NSE's real ipo-current-issue and
  // all-upcoming-issues payloads carry no listing date
  // (docs/design/probes/nse-payload.out.json), so mapping it would only ever
  // answer NOT_AVAILABLE_YET. Field 7 comes from CHITTORGARH (and documents);
  // the NSE gap stays in the #884 baseline.
  ['ipos.priceRangeMin', 'priceRangeMin'],
  ['ipos.priceRangeMax', 'priceRangeMax'],
  ['ipos.lotSize', 'lotSize'],
  ['ipos.isin', 'isin'],
]);

export interface NseFetcherDeps {
  ipoRepository: IPORepository;
  /** Manifest lookup: is `${tableName}.${fieldName}` marked capability.NSE.capable? */
  isNseCapable: (tableName: string, fieldName: string) => boolean;
  /**
   * #1486: the IPO's ACTIVE `NSE_ISSUE` key values ("SYMBOL|SERIES", OD-85). Optional: without it
   * (and `fetchNseDetail`) the fetcher reads the boards only.
   */
  nseIssueKeys?: (ipoId: string) => Promise<string[]>;
  /** #1486: the raw `/api/ipo-detail` payload; THROWS when NSE could not be read. */
  fetchNseDetail?: (symbol: string, series: 'EQ' | 'SME') => Promise<unknown>;
}

/** Board key -> the ipo-detail field that carries it; a board key not listed here is not in ipo-detail. */
const DETAIL_FIELD_FOR_BOARD_KEY: ReadonlyMap<string, NseDetailField> = new Map<string, NseDetailField>([
  ['symbol', 'symbol'],
  ['openDate', 'openDate'],
  ['closeDate', 'closeDate'],
  ['priceRangeMin', 'priceRangeMin'],
  ['priceRangeMax', 'priceRangeMax'],
  ['lotSize', 'lotSize'],
]);

type DetailRead =
  | { status: 'no_key' }
  | { status: 'refused'; cause: string }
  | { status: 'failed'; key: string; cause: string }
  | { status: 'read'; key: string; parse: NseDetailParse };

/**
 * Per-cycle memo state -- construct ONE instance per document-cycle wake and
 * pass the SAME instance to every IPO's walk, mirroring the BSE fetcher's
 * per-cycle-not-per-IPO construction in field-plan-walk-deps.ts.
 */
export class NseFieldFetcherState {
  private board: Promise<NseBoardRow[]> | null = null;
  private details = new Map<string, Promise<DetailRead>>();

  /**
   * #1486: one ipo-detail read per IPO per cycle, by its ACTIVE NSE_ISSUE key. Memoised by IPO so
   * every field of the IPO in this cycle shares the one request (B4(a): no new budget).
   */
  detailFor(deps: NseFetcherDeps, ipoId: string): Promise<DetailRead> {
    let read = this.details.get(ipoId);
    if (!read) {
      read = this.readDetail(deps, ipoId);
      this.details.set(ipoId, read);
    }
    return read;
  }

  private async readDetail(deps: NseFetcherDeps, ipoId: string): Promise<DetailRead> {
    if (!deps.nseIssueKeys || !deps.fetchNseDetail) return { status: 'no_key' };
    let keys: string[];
    try {
      keys = [...new Set(await deps.nseIssueKeys(ipoId))];
    } catch (error) {
      return { status: 'refused', cause: `NSE key read failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (keys.length === 0) return { status: 'no_key' };
    if (keys.length > 1) return { status: 'refused', cause: `${keys.length} ACTIVE NSE keys (${keys.join(', ')})` };
    const [symbol, series, ...rest] = keys[0].split('|');
    if (!symbol || rest.length > 0 || (series !== 'EQ' && series !== 'SME')) {
      return { status: 'refused', cause: `NSE key ${keys[0]} is not an EQ/SME issue ipo-detail serves` };
    }
    try {
      const payload = await deps.fetchNseDetail(symbol, series);
      return { status: 'read', key: keys[0], parse: parseNseDetailFields(payload, symbol) };
    } catch (error) {
      return { status: 'failed', key: keys[0], cause: error instanceof Error ? error.message : String(error) };
    }
  }

  private getBoard(): Promise<NseBoardRow[]> {
    if (!this.board) {
      // OD-145: `scrapeNSEIPOs` returns `ipos: []` when both the API and the browser fail (it
      // catches and logs). An empty board is therefore UNKNOWN, never "this IPO is not on NSE":
      // it throws here, so every field this cycle answers CHECK_FAILED (transient, re-asked).
      this.board = scrapeNSEIPOs().then((r) => {
        if (!Array.isArray(r?.ipos) || r.ipos.length === 0) {
          throw new Error(`NSE board empty (source=${r?.source ?? 'none'}): scrape failed or returned no rows`);
        }
        return r.ipos;
      });
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
        gap: 'NO_MAPPING',
        transient: true,
      };
    }

    let resolved: Awaited<ReturnType<NseFieldFetcherState['resolveRow']>> | null = null;
    let boardError: string | null = null;
    try {
      resolved = await state.resolveRow(deps, ipoId);
    } catch (error) {
      boardError = error instanceof Error ? error.message : String(error);
    }

    if (resolved?.status === 'ambiguous') {
      // Never guess. An ambiguous match is UNKNOWN (OD-145), not "not published yet": CHECK_FAILED
      // (transient, re-asked) with the cause, so no rule downstream reads it as a stated absence.
      logger.warn({ ipoId, tableName, fieldName, cause: resolved.cause }, 'PASS 3 NSE fetcher: refusing to guess');
      return { outcome: 'CHECK_FAILED', reason: `ambiguous NSE match: ${resolved.cause}`, transient: true };
    }

    if (resolved?.status === 'found') {
      const value = resolved.row[boardKey];
      if (value === undefined || value === null || value === '') {
        // The board carries this field but this IPO has no value for it yet --
        // re-askable, not a settled "not here".
        return { outcome: 'NOT_AVAILABLE_YET' };
      }
      return { outcome: 'SUPPLIED', value: value as never };
    }

    // Off the boards, or the boards could not be read (#1486): ask ipo-detail by the stored key.
    return answerFromDetail(await state.detailFor(deps, ipoId), boardKey, boardError);
  };
}

function answerFromDetail(read: DetailRead, boardKey: string, boardError: string | null): FieldFetcherAnswer {
  const prefix = boardError ? `${boardError}; ` : '';
  switch (read.status) {
    case 'no_key':
      // No NSE identity: nothing more to ask, and never a name search.
      return boardError ? { outcome: 'CHECK_FAILED', reason: boardError } : { outcome: 'NOT_AVAILABLE_YET' };
    case 'refused':
      return { outcome: 'CHECK_FAILED', reason: `${prefix}ipo-detail not asked: ${read.cause}` };
    case 'failed':
      return { outcome: 'CHECK_FAILED', reason: `${prefix}ipo-detail ${read.key} failed: ${read.cause}` };
    case 'read': {
      const parse = read.parse;
      // NSE answered and served no detail: an abstention (OD-60), not a failure.
      if (parse.kind === 'empty') return { outcome: 'NOT_AVAILABLE_YET' };
      if (parse.kind === 'identity_mismatch') {
        return { outcome: 'CHECK_FAILED', reason: `ipo-detail ${read.key}: ${parse.cause}` };
      }
      const detailField = DETAIL_FIELD_FOR_BOARD_KEY.get(boardKey);
      if (!detailField) return { outcome: 'NOT_AVAILABLE_YET' };
      const answer = parse.fields[detailField];
      if ('value' in answer) return { outcome: 'SUPPLIED', value: answer.value as never };
      if ('error' in answer) return { outcome: 'CHECK_FAILED', reason: `ipo-detail ${read.key}: ${answer.error}` };
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
  }
}
