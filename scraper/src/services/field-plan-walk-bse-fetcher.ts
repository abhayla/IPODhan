/**
 * The BSE fetcher for the field-plan walk (item 6, rank 2 for the manifest's
 * DOC -> BSE -> CHITTORGARH fields).
 *
 * Ruling 33: a whole-source fetch, at most once per cycle. `fetchBSEBoard()`
 * (the whole-board list) is called AT MOST ONCE per `BseFieldFetcherState`
 * instance, memoised; `fetchBSEDetail(ipoNo)` is memoised per IPO number for
 * the same reason — a second field of the same IPO in the same cycle must
 * not refetch. Both helpers are the SAME functions `scrapeBSEViaAPI` uses
 * (bse-api-scraper.ts) — this is a second CALLER of the existing orchestrator
 * entry points, never a second HTTP client with its own headers/backoff.
 *
 * RESOLUTION ORDER (symbol -> isin -> normalised name), matching the
 * manifest's stated priority for matching a plan row's IPO to a BSE board row:
 * symbol and ISIN are BSE's own identifiers when present; company name needs
 * normalising because BSE's `Scrip_name`/`ScripName` casing and suffixes
 * ("Limited" vs "Ltd") differ from what is stored.
 *
 * CAPABILITY: only fields the manifest marks `capability.BSE.capable: true`
 * are served. `mapBSEToScrapedIPO`'s ScrapedIPO shape carries `issueSize`
 * only (no fresh/OFS split, no derived min-investment) — see
 * bse-api-scraper.ts's ScrapedIPOSchema — so every OTHER manifest field in
 * this slice (`ipo_details.fresh_issue`, `.ofs_issue`, `.min_investment`,
 * `financial_statements.revenue`) answers NOT_PRINTED from BSE regardless of
 * what the manifest says is capable, because there is nothing in the mapped
 * shape to serve it from. That gap is closed by a second BSE adapter working
 * from `Price_Band_Advertisement`/other detail-row fields, not by this one
 * guessing at an unmapped shape.
 */

import type { FieldFetcher, FieldFetcherAnswer } from './field-plan-walk.js';
import type { IPORepository } from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import {
  fetchBSEBoard,
  fetchBSEDetail,
  mapBSEToScrapedIPO,
  parseBSEDate,
  type BSEListRow,
} from '../scrapers/bse-api-scraper.js';
// `plan.fieldName` is the manifest's snake_case key; `mapBSEToScrapedIPO`'s
// ScrapedIPO fields are camelCase.
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { logger } from '../utils/logger.js';

/** `${tableName}.${fieldName}` -> true when BSE's mapped ScrapedIPO actually carries it. */
// Item 43 (OD-164(e), F-226): each pair below was decided on BSE's real JSON fetched 2026-10-02
// (`IPO_HomePageDetail/w` board + `GetMkt_ISSUE_BBS_IPO/w` detail for IPO_NO 8022/8015; fixtures
// under tests/fixtures/bse/ with provenance meta). Values come from `mapBSEToScrapedIPO` — the SAME
// mapping the BSE orchestrator writes — EXCEPT open/close dates, which that mapper defaults to today
// when unparsable; here they are read straight off the board row (`Start_Dt` / `End_Dt`) so an
// unprinted date stays absent, never today.
export const BSE_SERVEABLE_FIELDS: ReadonlySet<string> = new Set([
  'ipos.issueSize',
  'ipos.companyName', // board Scrip_name
  'ipos.openDate', // board Start_Dt
  'ipos.closeDate', // board End_Dt
  'ipos.priceRangeMin', // detail Price_Band "70.00-75.00"
  'ipos.priceRangeMax',
  'ipos.lotSize', // detail Market_Lot
  'ipos.faceValue', // detail Face_Value
  'ipos.registrar', // detail Registrar (name part)
  'ipos.leadManagers', // detail Book_Running_Lead_Manager + Co_Book_Running_Lead_Manager
  'ipos.symbol', // detail Symbol
]);

export interface BseFetcherDeps {
  ipoRepository: IPORepository;
  /** Manifest lookup: is `${tableName}.${fieldName}` marked capability.BSE.capable? */
  isBseCapable: (tableName: string, fieldName: string) => boolean;
}

/**
 * Per-cycle memo state — construct ONE instance per document-cycle wake and
 * pass the SAME instance to every IPO's walk (mirrors
 * `buildFieldPlanWalkOrchestrator`'s own per-cycle-not-per-IPO construction
 * in field-plan-walk-deps.ts).
 */
export class BseFieldFetcherState {
  private board: Promise<BSEListRow[]> | null = null;
  private detailByIpoNo = new Map<number, Promise<Awaited<ReturnType<typeof fetchBSEDetail>>>>();

  private getBoard(): Promise<BSEListRow[]> {
    if (!this.board) this.board = fetchBSEBoard();
    return this.board;
  }

  private getDetail(ipoNo: number) {
    let p = this.detailByIpoNo.get(ipoNo);
    if (!p) {
      p = fetchBSEDetail(ipoNo);
      this.detailByIpoNo.set(ipoNo, p);
    }
    return p;
  }

  /**
   * Three outcomes, never a guess (review round 1, M1):
   * `found` — exactly one row, confirmed either by a unique normalised-name
   * match or by symbol/isin. `not_found` — nothing plausible on the board.
   * `ambiguous` — 2+ rows share the normalised name and neither symbol nor
   * isin narrows it to exactly one; `normalizeCompanyNameForMatching('SIS
   * Limited')` and `('SIS Ltd')` both fold to `sis`, so two DIFFERENT
   * companies can collide on the key that used to be trusted as unique. A
   * silent `[0]` pick here would attach one IPO's BSE data to another IPO's
   * plan row — worse than not answering.
   */
  async resolveRow(
    deps: BseFetcherDeps,
    ipoId: string
  ): Promise<
    | { status: 'found'; row: BSEListRow }
    | { status: 'not_found' }
    | { status: 'ambiguous'; cause: string }
  > {
    const ipo = await deps.ipoRepository.findById(ipoId);
    if (!ipo) return { status: 'not_found' };
    const board = await this.getBoard();

    const symbol = (ipo as unknown as { symbol?: string | null }).symbol;
    const isin = (ipo as unknown as { isin?: string | null }).isin;
    const companyName = (ipo as unknown as { companyName?: string | null }).companyName;

    // Resolution order: symbol -> isin -> normalised name. BSE's list row
    // carries neither symbol nor isin directly — those live on the DETAIL
    // row — so a symbol/isin match requires fetching detail for candidate
    // rows by name first, then confirming. Given the board is small (~tens
    // of live rows) and detail is memoised, this costs at most one detail
    // fetch per plausible name match, not one per board row.
    const normalizedTarget = companyName ? normalizeCompanyNameForMatching(companyName) : '';
    const nameMatches = board.filter(
      (r) => normalizeCompanyNameForMatching(r.Scrip_name || '') === normalizedTarget
    );
    if (nameMatches.length === 1) return { status: 'found', row: nameMatches[0] };

    if (nameMatches.length > 1 && (symbol || isin)) {
      for (const row of nameMatches) {
        const detail = await this.getDetail(row.IPO_NO);
        if (!detail) continue;
        if (symbol && detail.Symbol?.trim().toUpperCase() === symbol.trim().toUpperCase()) {
          return { status: 'found', row };
        }
        // BSE's detail payload carries no ISIN field today; isin match is a
        // declared no-op until one is found, kept as a named branch so a
        // future detail field slots in here rather than a rewrite.
      }
    }

    if (nameMatches.length > 1) {
      const names = nameMatches.map((r) => r.Scrip_name).join(', ');
      return {
        status: 'ambiguous',
        cause: `ambiguous name match: ${nameMatches.length} rows (${names})`,
      };
    }

    return { status: 'not_found' };
  }

  async detailFor(row: BSEListRow) {
    return this.getDetail(row.IPO_NO);
  }
}

export function buildBseFetcher(deps: BseFetcherDeps, state: BseFieldFetcherState): FieldFetcher {
  return async function bseFetcher(
    ipoId: string,
    tableName: string,
    _rowKey: string,
    fieldName: string
  ): Promise<FieldFetcherAnswer> {
    if (!deps.isBseCapable(tableName, fieldName)) {
      return { outcome: 'NOT_PRINTED' };
    }

    const camelFieldName = columnToCamelCase(fieldName);
    const key = `${tableName}.${camelFieldName}`;
    if (!BSE_SERVEABLE_FIELDS.has(key)) {
      // Review round 2, RCA2 extended: manifest says capable.BSE.capable is
      // TRUE for this field, but the mapped ScrapedIPO shape has nothing for
      // it yet — a coverage gap in THIS fetcher's code, not a manifest "no".
      // Only capability.BSE.capable === false (checked above) may answer
      // NOT_PRINTED; a code limitation must stay re-askable, CHECK_FAILED
      // transient, so extending the mapping later does not require a manual
      // requeue of every field it retired.
      return {
        outcome: 'CHECK_FAILED',
        reason: `BSE has no mapped field for ${key} yet (coverage gap, not a manifest no)`,
        gap: 'NO_MAPPING',
        transient: true,
      };
    }

    let resolved: Awaited<ReturnType<BseFieldFetcherState['resolveRow']>>;
    try {
      resolved = await state.resolveRow(deps, ipoId);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }
    if (resolved.status === 'not_found') {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
    if (resolved.status === 'ambiguous') {
      // Never guess: an ambiguous match is not a definitive "not here" (a
      // future symbol/isin resolution, or the ambiguity resolving itself as
      // one IPO lists, could still answer this), so it is re-askable, not
      // terminal. `NOT_AVAILABLE_YET` carries no reason field (its shape is
      // fixed across every fetcher), so the cause is logged here instead
      // (signal-ownership R6: every failure carries its cause).
      logger.warn({ ipoId, tableName, fieldName, cause: resolved.cause }, 'PASS 3 BSE fetcher: refusing to guess');
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
    const row = resolved.row;

    let detail;
    try {
      detail = await state.detailFor(row);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }
    if (!detail) {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }

    let value: unknown;
    if (camelFieldName === 'openDate') value = parseBSEDate(row.Start_Dt);
    else if (camelFieldName === 'closeDate') value = parseBSEDate(row.End_Dt);
    else if (camelFieldName === 'faceValue') {
      // The shared mapper rounds (Rs 2.50 -> 3); keep the printed decimal value.
      const printed = parseFloat(String(detail.Face_Value || ''));
      value = Number.isFinite(printed) && printed > 0 ? printed : undefined;
    } else value = (mapBSEToScrapedIPO(row, detail) as unknown as Record<string, unknown>)[camelFieldName];
    if (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    ) {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }
    if (BSE_SERVEABLE_FIELDS.has(key)) return { outcome: 'SUPPLIED', value };

    // Unreachable today (every BSE_SERVEABLE_FIELDS key is answered above, and the
    // gate above already answers CHECK_FAILED transient for anything else) —
    // kept as a defensive fallback with the SAME review-round-2 reasoning:
    // a field this fetcher's mapping branch does not handle is a coverage
    // gap, never a manifest no.
    return {
      outcome: 'CHECK_FAILED',
      reason: `BSE has no mapped field for ${key} yet (coverage gap, not a manifest no)`,
      gap: 'NO_MAPPING',
      transient: true,
    };
  };
}
