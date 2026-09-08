/**
 * Per-IPO Chittorgarh detail-page visit for `ipos.sector` (T-507, issue #394,
 * owner decision 5 of 2026-09-08).
 *
 * Same shape as the sibling `#222` issue-type visitor (PR #367, unmerged as
 * of this writing): the live 30-min Chittorgarh cycle
 * (`ChittorgarhScraperOrchestratorV2` / `runChittorgarhScraper`, called from
 * `scraper/src/index.ts`) only ever fetches Chittorgarh's BULK JSON reports —
 * it never visits a per-IPO detail page. `ipos.sector` is '' on every row
 * (T-455/#242 found no live scraper source; T-507 found the Chittorgarh
 * detail page DOES carry the sector, but only as the heading of its
 * "recently listed peers" comparison table, not a labelled row — see
 * `extractSectorFromDetailHtml` in `chittorgarh-detail-fields.ts`).
 *
 * URL resolution: the detail page needs BOTH the company's URL slug AND its
 * numeric report id (`/ipo/<slug>/<id>/` — verified live; a slug-only guess
 * 404s even for Ather Energy, see `chittorgarh-detail-url-resolver.ts`'s
 * header comment for the corrected-from-PR#367 RCA). Discovery is scoped to
 * the CURRENT fiscal year only (report 82, mainboard+SME — 2 cheap paginated
 * fetches) so this stays affordable inside a 30-min live cycle; older
 * candidates fall through to the one-time `backfill-sector-chittorgarh.ts`
 * tool, which affords the full historical discovery pass.
 *
 * Budget: capped to `SECTOR_VISIT_BATCH_SIZE` IPOs per cycle, exactly ONE
 * detail-page fetch per matched IPO — existing rows fill in over the 30-min
 * rotation.
 */
import { or, isNull, eq, sql } from 'drizzle-orm';
import { db } from '@ipodhan/shared';
import { ipos } from '@ipodhan/shared/db/schema';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { extractSectorFromDetailHtml } from '../scrapers/chittorgarh-detail-fields.js';
import { upsertIpoSector } from './data-persister.js';
import {
  buildChittorgarhDiscoveryMap,
  buildChittorgarhDetailUrlFromRef,
  currentFiscalYear,
  type ChittorgarhDetailRef,
} from './chittorgarh-detail-url-resolver.js';
import logger from '../utils/logger.js';

export const SECTOR_VISIT_BATCH_SIZE = 5;
const DETAIL_FETCH_TIMEOUT_MS = 20_000;

export interface SectorVisitCandidate {
  ipoId: string;
  companyName: string;
}

export interface SectorVisitSummary {
  candidates: number;
  matched: number;
  fetched: number;
  extracted: number;
  written: number;
  fetchErrors: number;
}

/**
 * IPOs whose `sector` is NULL or '' (T-455's every-row starting state),
 * oldest-updated-first so the rotation covers every row rather than
 * re-hammering the same handful each cycle.
 */
export async function loadSectorVisitCandidates(
  limit: number = SECTOR_VISIT_BATCH_SIZE
): Promise<SectorVisitCandidate[]> {
  const rows = await db
    .select({ ipoId: ipos.id, companyName: ipos.companyName })
    .from(ipos)
    .where(or(isNull(ipos.sector), eq(ipos.sector, '')))
    .orderBy(sql`${ipos.updatedAt} ASC`)
    .limit(limit);
  return rows.map((r) => ({ ipoId: r.ipoId, companyName: r.companyName }));
}

async function fetchDetailHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(DETAIL_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, '[sector-visitor] detail page HTTP error');
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn(
      { url, error: err instanceof Error ? err.message : String(err) },
      '[sector-visitor] detail page fetch failed'
    );
    return null;
  }
}

/**
 * Visit up to `SECTOR_VISIT_BATCH_SIZE` IPOs missing `sector`: resolve each
 * candidate's detail URL from the current-fiscal-year discovery map, fetch
 * ONCE, extract, and write through `upsertIpoSector` (never overwrites an
 * existing ADMIN-sourced or non-empty value). Never throws — a
 * resolve/fetch/extract/write failure for one IPO is logged and skipped so it
 * never breaks the wider Chittorgarh cycle result.
 */
export async function runSectorVisit(
  limit: number = SECTOR_VISIT_BATCH_SIZE
): Promise<SectorVisitSummary> {
  const summary: SectorVisitSummary = {
    candidates: 0,
    matched: 0,
    fetched: 0,
    extracted: 0,
    written: 0,
    fetchErrors: 0,
  };

  let candidates: SectorVisitCandidate[] = [];
  try {
    candidates = await loadSectorVisitCandidates(limit);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      '[sector-visitor] candidate query failed — skipping this cycle'
    );
    return summary;
  }
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  let discoveryMap: Map<string, ChittorgarhDetailRef>;
  try {
    discoveryMap = await buildChittorgarhDiscoveryMap([currentFiscalYear()]);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      '[sector-visitor] discovery map build failed — skipping this cycle'
    );
    return summary;
  }

  for (const candidate of candidates) {
    const ref = discoveryMap.get(normalizeCompanyNameForMatching(candidate.companyName));
    if (!ref) continue; // not in this fiscal year's discovery feed — the backfill tool covers older rows
    summary.matched++;

    const url = buildChittorgarhDetailUrlFromRef(ref);
    const html = await fetchDetailHtml(url);
    if (!html) {
      summary.fetchErrors++;
      continue;
    }
    summary.fetched++;

    const sector = extractSectorFromDetailHtml(html);
    if (!sector) continue;
    summary.extracted++;

    try {
      const wrote = await upsertIpoSector(candidate.ipoId, sector);
      if (wrote) summary.written++;
    } catch (err) {
      logger.warn(
        {
          ipoId: candidate.ipoId,
          companyName: candidate.companyName,
          error: err instanceof Error ? err.message : String(err),
        },
        '[sector-visitor] write failed'
      );
    }
  }

  logger.info(summary, '[sector-visitor] cycle complete');
  return summary;
}
