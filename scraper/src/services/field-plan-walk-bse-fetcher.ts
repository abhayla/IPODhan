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
  type BSEListRow,
} from '../scrapers/bse-api-scraper.js';
// `plan.fieldName` is the manifest's snake_case key; `mapBSEToScrapedIPO`'s
// ScrapedIPO fields are camelCase.
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';

/** `${tableName}.${fieldName}` -> true when BSE's mapped ScrapedIPO actually carries it. */
const BSE_SERVEABLE_FIELDS: ReadonlySet<string> = new Set(['ipos.issueSize']);

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

  async resolveRow(deps: BseFetcherDeps, ipoId: string): Promise<BSEListRow | null> {
    const ipo = await deps.ipoRepository.findById(ipoId);
    if (!ipo) return null;
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
    if (nameMatches.length === 1) return nameMatches[0];

    if (symbol || isin) {
      for (const row of nameMatches.length > 0 ? nameMatches : board) {
        const detail = await this.getDetail(row.IPO_NO);
        if (!detail) continue;
        if (symbol && detail.Symbol?.trim().toUpperCase() === symbol.trim().toUpperCase()) return row;
        // BSE's detail payload carries no ISIN field today; isin match is a
        // declared no-op until one is found, kept as a named branch so a
        // future detail field slots in here rather than a rewrite.
      }
    }

    return nameMatches[0] ?? null;
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
      // Manifest says capable, but the mapped ScrapedIPO shape has nothing
      // for this field — see module header. Definitive: no re-ask will
      // change what `mapBSEToScrapedIPO` returns without a code change.
      return { outcome: 'NOT_PRINTED' };
    }

    let row: BSEListRow | null;
    try {
      row = await state.resolveRow(deps, ipoId);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }
    if (!row) {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }

    let detail;
    try {
      detail = await state.detailFor(row);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }
    if (!detail) {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }

    const scraped = mapBSEToScrapedIPO(row, detail);
    if (camelFieldName === 'issueSize') {
      if (scraped.issueSize === undefined || scraped.issueSize === null) {
        return { outcome: 'NOT_AVAILABLE_YET' };
      }
      return { outcome: 'SUPPLIED', value: scraped.issueSize };
    }

    return { outcome: 'NOT_PRINTED' };
  };
}
