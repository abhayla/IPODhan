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
import type { ChittorgarhIPO } from '../utils/validators.js';
// `plan.fieldName` is the manifest's snake_case key; `ChittorgarhIPO`'s
// fields are camelCase.
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';

const CHITTORGARH_SERVEABLE_FIELDS: ReadonlySet<string> = new Set(['ipos.issueSize']);

export interface ChittorgarhFetcherDeps {
  ipoRepository: IPORepository;
  isChittorgarhCapable: (tableName: string, fieldName: string) => boolean;
}

/** Per-cycle memo — one instance per document-cycle wake, shared across every IPO's walk. */
export class ChittorgarhFieldFetcherState {
  private list: Promise<ChittorgarhIPO[]> | null = null;

  private getList(): Promise<ChittorgarhIPO[]> {
    if (!this.list) {
      this.list = scrapeChittorgarhIPOs().then((r) => r.ipos);
    }
    return this.list;
  }

  async resolveIPO(deps: ChittorgarhFetcherDeps, ipoId: string): Promise<ChittorgarhIPO | null> {
    const ipo = await deps.ipoRepository.findById(ipoId);
    if (!ipo) return null;
    const companyName = (ipo as unknown as { companyName?: string | null }).companyName;
    if (!companyName) return null;

    const list = await this.getList();
    const target = normalizeCompanyNameForMatching(companyName);
    const match = list.find((row) => normalizeCompanyNameForMatching(row.companyName) === target);
    return match ?? null;
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
      // Manifest marks this capable, but the list-scrape shape this fetcher
      // reads (ruling 33's whole-IPO call) does not carry it. Named per-field
      // in the module header and the PR body — a future detail-page adapter
      // is its own slice, not silently assumed here.
      return { outcome: 'NOT_PRINTED' };
    }

    let row: ChittorgarhIPO | null;
    try {
      row = await state.resolveIPO(deps, ipoId);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }
    if (!row) {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }

    if (camelFieldName === 'issueSize') {
      if (row.issueSize === undefined || row.issueSize === null) {
        return { outcome: 'NOT_AVAILABLE_YET' };
      }
      return { outcome: 'SUPPLIED', value: row.issueSize };
    }

    return { outcome: 'NOT_PRINTED' };
  };
}
