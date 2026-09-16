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
import { logger } from '../utils/logger.js';

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

  /**
   * Three outcomes, never a guess (review round 1, M1). Unlike BSE, the
   * Chittorgarh list shape carries NO symbol/isin at all, so an ambiguous
   * name match here has no fallback confirmation to try — any 2+ match is
   * always `ambiguous`, never resolvable to `found`.
   */
  async resolveIPO(
    deps: ChittorgarhFetcherDeps,
    ipoId: string
  ): Promise<
    | { status: 'found'; row: ChittorgarhIPO }
    | { status: 'not_found' }
    | { status: 'ambiguous'; cause: string }
  > {
    const ipo = await deps.ipoRepository.findById(ipoId);
    if (!ipo) return { status: 'not_found' };
    const companyName = (ipo as unknown as { companyName?: string | null }).companyName;
    if (!companyName) return { status: 'not_found' };

    const list = await this.getList();
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
      // Manifest marks this capable, but the list-scrape shape this fetcher
      // reads (ruling 33's whole-IPO call) does not carry it. Named per-field
      // in the module header and the PR body — a future detail-page adapter
      // is its own slice, not silently assumed here.
      return { outcome: 'NOT_PRINTED' };
    }

    let resolved: Awaited<ReturnType<ChittorgarhFieldFetcherState['resolveIPO']>>;
    try {
      resolved = await state.resolveIPO(deps, ipoId);
    } catch (error) {
      return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
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

    if (camelFieldName === 'issueSize') {
      if (row.issueSize === undefined || row.issueSize === null) {
        return { outcome: 'NOT_AVAILABLE_YET' };
      }
      return { outcome: 'SUPPLIED', value: row.issueSize };
    }

    return { outcome: 'NOT_PRINTED' };
  };
}
