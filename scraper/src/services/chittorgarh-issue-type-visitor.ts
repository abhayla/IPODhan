/**
 * Per-IPO Chittorgarh detail-page visit for `ipo_details.issue_type` (#222).
 *
 * WHY this is a NEW live step, not reuse of an existing per-IPO fetch: the
 * live 30-min cycle (`ChittorgarhScraperOrchestratorV2` / `runChittorgarhScraper`,
 * called from `scraper/src/index.ts`) only ever fetches Chittorgarh's BULK
 * JSON reports (GMP, historical performance) — it never visits a per-IPO
 * detail page. Every existing caller of `chittorgarh-detail-fields.ts`
 * extractors (`historical-ipo-assembler.ts`, `backfill-*-chittorgarh-
 * detail.ts`, `ingest-historical-ipo.ts`) is a MANUAL script, not part of the
 * live cycle — confirmed by grepping for callers before writing this file.
 * So there is no existing "anchor/financials path" to attach to; this module
 * IS that path, scoped deliberately narrow (issue_type only, per #222's
 * explicit out-of-scope note — anchor/financials/peers stay #223/#224 work).
 *
 * Budget: capped to `ISSUE_TYPE_VISIT_BATCH_SIZE` IPOs per cycle, exactly ONE
 * detail-page fetch per IPO — existing rows fill in over the 30-min rotation
 * (242 rows / 5 per cycle / 48 cycles-per-day ≈ same-day coverage; a full
 * cold rotation caps at ~1 day of live cycles at this batch size).
 */
import { and, isNull, sql } from 'drizzle-orm';
import { db } from '@ipodhan/shared';
import { ipos, ipoDetails } from '@ipodhan/shared/db/schema';
import { extractIssueTypeFromDetailHtml } from '../scrapers/chittorgarh-detail-fields.js';
import { upsertIpoDetailsIssueType } from './data-persister.js';
import logger from '../utils/logger.js';

export const ISSUE_TYPE_VISIT_BATCH_SIZE = 5;
const DETAIL_FETCH_TIMEOUT_MS = 20_000;

export interface IssueTypeVisitCandidate {
  ipoId: string;
  companyName: string;
}

export interface IssueTypeVisitSummary {
  candidates: number;
  fetched: number;
  extracted: number;
  written: number;
  fetchErrors: number;
}

/**
 * IPOs with no `ipo_details` row (or a row whose `issue_type` is NULL),
 * oldest-updated-first so the rotation covers every row rather than
 * re-hammering the same handful each cycle.
 */
export async function loadIssueTypeVisitCandidates(
  limit: number = ISSUE_TYPE_VISIT_BATCH_SIZE
): Promise<IssueTypeVisitCandidate[]> {
  const rows = await db
    .select({ ipoId: ipos.id, companyName: ipos.companyName })
    .from(ipos)
    .leftJoin(ipoDetails, sql`${ipoDetails.ipoId} = ${ipos.id}`)
    .where(and(isNull(ipoDetails.issueType)))
    .orderBy(sql`${ipos.updatedAt} ASC`)
    .limit(limit);
  return rows.map((r) => ({ ipoId: r.ipoId, companyName: r.companyName }));
}

/** Same slug convention as `ipo-reviews-aggregator.ts`'s Chittorgarh fetch. */
export function buildChittorgarhDetailUrl(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return `https://www.chittorgarh.com/ipo/${slug}/`;
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
      logger.warn({ url, status: res.status }, '[issue-type-visitor] detail page HTTP error');
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn(
      { url, error: err instanceof Error ? err.message : String(err) },
      '[issue-type-visitor] detail page fetch failed'
    );
    return null;
  }
}

/**
 * Visit up to `ISSUE_TYPE_VISIT_BATCH_SIZE` IPOs missing `issue_type`, fetch
 * their Chittorgarh detail page ONCE each, extract, and write through
 * `upsertIpoDetailsIssueType` (never overwrites an existing value). Never
 * throws — a fetch/extract failure for one IPO is logged and skipped so it
 * never breaks the wider Chittorgarh cycle result.
 */
export async function runIssueTypeVisit(
  limit: number = ISSUE_TYPE_VISIT_BATCH_SIZE
): Promise<IssueTypeVisitSummary> {
  const summary: IssueTypeVisitSummary = {
    candidates: 0,
    fetched: 0,
    extracted: 0,
    written: 0,
    fetchErrors: 0,
  };

  let candidates: IssueTypeVisitCandidate[] = [];
  try {
    candidates = await loadIssueTypeVisitCandidates(limit);
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      '[issue-type-visitor] candidate query failed — skipping this cycle'
    );
    return summary;
  }
  summary.candidates = candidates.length;

  for (const candidate of candidates) {
    const url = buildChittorgarhDetailUrl(candidate.companyName);
    const html = await fetchDetailHtml(url);
    if (!html) {
      summary.fetchErrors++;
      continue;
    }
    summary.fetched++;

    const issueType = extractIssueTypeFromDetailHtml(html);
    if (!issueType) continue;
    summary.extracted++;

    try {
      const wrote = await upsertIpoDetailsIssueType(candidate.ipoId, issueType);
      if (wrote) summary.written++;
    } catch (err) {
      logger.warn(
        {
          ipoId: candidate.ipoId,
          companyName: candidate.companyName,
          error: err instanceof Error ? err.message : String(err),
        },
        '[issue-type-visitor] write failed'
      );
    }
  }

  logger.info(summary, '[issue-type-visitor] cycle complete');
  return summary;
}
