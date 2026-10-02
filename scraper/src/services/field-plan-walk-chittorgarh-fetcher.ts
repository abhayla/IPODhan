/**
 * The CHITTORGARH fetcher for the field-plan walk (item 6, rank 3 for every
 * DOC -> BSE -> CHITTORGARH manifest field).
 *
 * Ruling 33: `scrapeChittorgarhIPOs()` — the SAME whole-IPO orchestrator call
 * `chittorgarh-scraper-orchestrator*.ts` uses — is called at most once per
 * cycle via the memoised state below, never per field.
 *
 * CAPABILITY: `ChittorgarhIPO` (the mapped shape) carries `issueSize` only —
 * no fresh/OFS split, no financial series (that lives behind the SEPARATE
 * detail-page scrape in `chittorgarh-detail-fields.ts`, which this slice does
 * not call — ruling 33 is whole-IPO per source, and the list scrape is
 * Chittorgarh's whole-IPO call here). So `financial_statements.revenue` and
 * every `ipo_details.*` field in this manifest slice answer NOT_PRINTED from
 * Chittorgarh for now, named explicitly in the PR body rather than silently
 * guessed at.
 */

import type { FieldFetcher, FieldFetcherAnswer } from './field-plan-walk.js';
import type { IPORepository } from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { scrapeChittorgarhIPOs } from '../scrapers/chittorgarh-scraper.js';
import { extractSectorFromDetailHtml, fetchChittorgarhDetailHtml } from '../scrapers/chittorgarh-detail-sector.js';
import {
  extractAllotmentDateFromDetailHtml,
  extractFaceValueDecimalFromDetailHtml,
  extractIsinFromDetailHtml,
  extractLotSizeFromDetailHtml,
  extractRegistrarFromDetailHtml,
} from '../scrapers/chittorgarh-detail-fields.js';
import type { ChittorgarhIPO } from '../utils/validators.js';
// `plan.fieldName` is the manifest's snake_case key; `ChittorgarhIPO`'s
// fields are camelCase.
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { logger } from '../utils/logger.js';

// ipos.sector (#394/#343/#73, spec field 13 rank 2): read from the IPO's DETAIL
// page (the list row's verifierUrl), one GET per IPO per cycle, mapped through the
// fixed sector list (scraper/config/sector-list.json, check F1).
// ipos.listingDate (#1228, spec field 7 rank 3 / SME rank 2): the list row's own
// listing-date column (chittorgarh-scraper.ts `listingDate`), the same value the
// CHITTORGARH orchestrator writes.
// Item 43 (OD-164(e), F-226): each pair below was decided on a real page fetched 2026-10-02
// (report 82 rows + detail pages, fixtures under tests/fixtures/chittorgarh/ with provenance meta).
// LIST-row fields: report 82 prints "Opening Date", "Closing Date", "Issue Price (Rs.)" (the band),
// "Issue Category" (Mainboard / SME) and "Listing at" ("BSE, NSE" / "BSE SME" / "NSE SME"), the SAME
// row `scrapeChittorgarhIPOs()` already maps.
const CHITTORGARH_LIST_FIELDS: ReadonlySet<string> = new Set([
  'ipos.issueSize',
  'ipos.listingDate',
  'ipos.openDate',
  'ipos.closeDate',
  'ipos.priceRangeMin',
  'ipos.priceRangeMax',
  'ipos.segment',
  'ipos.listingExchanges',
]);

// DETAIL-page fields: the IPO's own CG page (one GET per IPO per cycle, memoised), read through the
// SAME extractors the CG detail backfills use (chittorgarh-detail-fields.ts), never a new parser.
// ipos.sector keeps its own sector-list mapping below.
const CHITTORGARH_DETAIL_EXTRACTORS: ReadonlyMap<string, (html: string) => string | number | null> = new Map<
  string,
  (html: string) => string | number | null
>([
  ['ipos.isin', extractIsinFromDetailHtml],
  ['ipos.allotmentDate', extractAllotmentDateFromDetailHtml],
  ['ipos.faceValue', extractFaceValueDecimalFromDetailHtml],
  ['ipos.lotSize', extractLotSizeFromDetailHtml],
  ['ipos.registrar', extractRegistrarFromDetailHtml],
]);

export const CHITTORGARH_SERVEABLE_FIELDS: ReadonlySet<string> = new Set([
  ...CHITTORGARH_LIST_FIELDS,
  'ipos.sector',
  ...CHITTORGARH_DETAIL_EXTRACTORS.keys(),
]);

/** CG "Listing at" -> the stored `ipos.listing_exchanges` array; an unread board stays absent. */
function listingExchangesFromRow(row: ChittorgarhIPO): ('NSE' | 'BSE')[] | null {
  if (row.listingExchange === 'BOTH') return ['NSE', 'BSE'];
  if (row.listingExchange === 'NSE') return ['NSE'];
  if (row.listingExchange === 'BSE') return ['BSE'];
  return null;
}

export interface ChittorgarhFetcherDeps {
  ipoRepository: IPORepository;
  isChittorgarhCapable: (tableName: string, fieldName: string) => boolean;
  /** Injected in tests; defaults to one live GET of the CG detail page. */
  fetchDetailHtml?: (url: string) => Promise<string>;
}

/** Per-cycle memo — one instance per document-cycle wake, shared across every IPO's walk. */
export class ChittorgarhFieldFetcherState {
  private list: Promise<{ ipos: ChittorgarhIPO[]; errors: string[] }> | null = null;
  private detailPages = new Map<string, Promise<string>>();

  getDetailHtml(url: string, fetchDetailHtml: (url: string) => Promise<string>): Promise<string> {
    let page = this.detailPages.get(url);
    if (!page) {
      page = fetchDetailHtml(url);
      this.detailPages.set(url, page);
    }
    return page;
  }

  private getList(): Promise<{ ipos: ChittorgarhIPO[]; errors: string[] }> {
    if (!this.list) {
      this.list = scrapeChittorgarhIPOs().then((r) => ({ ipos: r.ipos, errors: r.errors }));
    }
    return this.list;
  }

  /**
   * Four outcomes, never a guess (review round 1, M1). The mapped list shape
   * (`ChittorgarhIPO`) carries no symbol/isin (report 82 has `~nse_symbol` and
   * `~isin` columns, but they are empty while an IPO is open, so nothing here
   * reads them), so an ambiguous name match has no fallback confirmation to
   * try — any 2+ match is always `ambiguous`, never resolvable to `found`.
   * `source_failed` (fix round 1): `scrapeChittorgarhIPOs` swallows a fetch
   * error and returns `ipos: []` with `errors` set; an errored or empty list
   * says nothing about this IPO, so it must never read as "not published yet".
   */
  async resolveIPO(
    deps: ChittorgarhFetcherDeps,
    ipoId: string
  ): Promise<
    | { status: 'found'; row: ChittorgarhIPO }
    | { status: 'not_found' }
    | { status: 'ambiguous'; cause: string }
    | { status: 'source_failed'; cause: string }
  > {
    const ipo = await deps.ipoRepository.findById(ipoId);
    if (!ipo) return { status: 'not_found' };
    const companyName = (ipo as unknown as { companyName?: string | null }).companyName;
    if (!companyName) return { status: 'not_found' };

    const { ipos: list, errors } = await this.getList();
    if (errors.length > 0 || list.length === 0) {
      const cause = errors.length > 0 ? errors.join('; ') : 'empty list';
      return { status: 'source_failed', cause: `Chittorgarh list fetch failed: ${cause}` };
    }
    const target = normalizeCompanyNameForMatching(companyName);
    const matches = list.filter((row) => normalizeCompanyNameForMatching(row.companyName) === target);

    if (matches.length === 1) return { status: 'found', row: matches[0] };
    if (matches.length > 1) {
      const names = matches.map((r) => r.companyName).join(', ');
      return {
        status: 'ambiguous',
        cause: `ambiguous name match: ${matches.length} rows (${names})`,
      };
    }
    return { status: 'not_found' };
  }
}

export function buildChittorgarhFetcher(
  deps: ChittorgarhFetcherDeps,
  state: ChittorgarhFieldFetcherState
): FieldFetcher {
  return async function chittorgarhFetcher(
    ipoId: string,
    tableName: string,
    _rowKey: string,
    fieldName: string
  ): Promise<FieldFetcherAnswer> {
    if (!deps.isChittorgarhCapable(tableName, fieldName)) {
      return { outcome: 'NOT_PRINTED' };
    }

    const camelFieldName = columnToCamelCase(fieldName);
    const key = `${tableName}.${camelFieldName}`;
    if (!CHITTORGARH_SERVEABLE_FIELDS.has(key)) {
      // Review round 2, RCA2 extended: manifest says capable.CHITTORGARH.capable
      // is TRUE for this field, but the list-scrape shape this fetcher reads
      // (ruling 33's whole-IPO call) does not carry it yet — a coverage gap
      // in THIS fetcher's code (a future detail-page adapter is its own
      // slice), not a manifest "no". Only capability.CHITTORGARH.capable ===
      // false (checked above) may answer NOT_PRINTED; a code limitation must
      // stay re-askable, CHECK_FAILED transient.
      return {
        outcome: 'CHECK_FAILED',
        reason: `CHITTORGARH has no mapped field for ${key} yet (coverage gap, not a manifest no)`,
        gap: 'NO_MAPPING',
        transient: true,
      };
    }

    let resolved: Awaited<ReturnType<ChittorgarhFieldFetcherState['resolveIPO']>>;
    try {
      resolved = await state.resolveIPO(deps, ipoId);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }
    if (resolved.status === 'source_failed') {
      return { outcome: 'CHECK_FAILED', reason: resolved.cause, transient: true };
    }
    if (resolved.status === 'not_found') {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
    if (resolved.status === 'ambiguous') {
      // Never guess (signal-ownership R6: cause logged, not fabricated as a
      // reason field NOT_AVAILABLE_YET's fixed shape does not carry).
      logger.warn(
        { ipoId, tableName, fieldName, cause: resolved.cause },
        'PASS 3 CHITTORGARH fetcher: refusing to guess'
      );
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
    const row = resolved.row;

    if (CHITTORGARH_LIST_FIELDS.has(key)) {
      const value =
        camelFieldName === 'listingExchanges'
          ? listingExchangesFromRow(row)
          : (row as unknown as Record<string, unknown>)[camelFieldName];
      // Absent stays absent: an empty column is "not printed yet" (re-asked), never a value.
      if (value === undefined || value === null || value === '') return { outcome: 'NOT_AVAILABLE_YET' };
      return { outcome: 'SUPPLIED', value };
    }

    const detailExtractor = CHITTORGARH_DETAIL_EXTRACTORS.get(key);
    if (detailExtractor) {
      if (!row.verifierUrl) return { outcome: 'NOT_AVAILABLE_YET' };
      let html: string;
      try {
        html = await state.getDetailHtml(row.verifierUrl, deps.fetchDetailHtml ?? fetchChittorgarhDetailHtml);
      } catch (error) {
        return {
          outcome: 'CHECK_FAILED',
          reason: error instanceof Error ? error.message : String(error),
          transient: true,
        };
      }
      const value = detailExtractor(html);
      if (value === null || value === '') return { outcome: 'NOT_AVAILABLE_YET' };
      return { outcome: 'SUPPLIED', value };
    }

    if (camelFieldName === 'sector') {
      if (!row.verifierUrl) return { outcome: 'NOT_AVAILABLE_YET' };
      let html: string;
      try {
        html = await state.getDetailHtml(row.verifierUrl, deps.fetchDetailHtml ?? fetchChittorgarhDetailHtml);
      } catch (error) {
        return {
          outcome: 'CHECK_FAILED',
          reason: error instanceof Error ? error.message : String(error),
          transient: true,
        };
      }
      // Absent stays absent: no code, or a code outside the fixed list, is
      // NOT_AVAILABLE_YET (re-asked), never SUPPLIED '' (#394).
      const sector = extractSectorFromDetailHtml(html);
      if (!sector) return { outcome: 'NOT_AVAILABLE_YET' };
      return { outcome: 'SUPPLIED', value: sector };
    }

    // Unreachable today (every CHITTORGARH_SERVEABLE_FIELDS key has a branch above, and the gate above already answers CHECK_FAILED transient for
    // anything else) — kept as a defensive fallback with the SAME
    // review-round-2 reasoning: a field this fetcher's mapping branch does
    // not handle is a coverage gap, never a manifest no.
    return {
      outcome: 'CHECK_FAILED',
      reason: `CHITTORGARH has no mapped field for ${key} yet (coverage gap, not a manifest no)`,
      gap: 'NO_MAPPING',
      transient: true,
    };
  };
}
