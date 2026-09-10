/**
 * Item 2 slice 7 — write the issue type Chittorgarh report 82 already publishes.
 *
 * Dependencies are injected, so this is testable without a database and the
 * caller owns the fetch, the matching rule and the writer. That matters here:
 * the same-name matching is the part most likely to be got wrong, and it stays
 * outside this function where it can be tested on its own.
 *
 * THE SAFETY ARGUMENT IS THE NULL GUARD, NOT A RANKING. `ipo_details` has no
 * source-priority mechanism — measured 2026-09-11: the field-priority matrix
 * governs `ipos` writes only, and `dropOutranked` is cover-versus-price-band-ad
 * arbitration that no-ops unless the incoming write IS a prospectus cover. So a
 * 60-confidence aggregator value cannot be RANKED below a filing here; it can
 * only be made HARMLESS. `fillIssueTypeIfNull` is that harmlessness, and a
 * provenance row is written ONLY when it reports a real write.
 */

import { BASE_SOURCE_CONFIDENCE } from '../config/source-confidence.js';
import type { Report82IssueType } from '../scrapers/chittorgarh-report82-fields.js';

/** Written from the canonical table, never typed as a literal — a hardcoded 60 drifts. */
export const REPORT82_CONFIDENCE = BASE_SOURCE_CONFIDENCE.CHITTORGARH;

export interface IssueTypeFillDeps {
  /** Resolve a report name to a stored IPO id. Returns null when it matches none. */
  resolveIpoId(companyName: string): Promise<string | null>;
  /** The guarded writer: fills only when issue_type IS NULL; true when it filled. */
  fillIssueTypeIfNull(ipoId: string, issueType: string): Promise<boolean>;
  /** Provenance. Called ONLY after a real write. */
  trackFieldUpdate(row: {
    ipoId: string;
    tableName: string;
    fieldName: string;
    source: string;
    confidence: number;
    dataLineage: unknown;
    updatedBy: string;
  }): Promise<void>;
  logger?: { warn(o: unknown, m: string): void };
}

export interface IssueTypeFillSummary {
  candidates: number;
  /** Matched a stored IPO row. */
  matched: number;
  /** Actually filled a NULL — the only rows that get a provenance row. */
  filled: number;
  /** Matched, but the column was already set: left alone, no provenance written. */
  alreadySet: number;
  /** No stored row for that name. */
  unmatched: number;
  /** Rows whose write threw; counted, never swallowed silently. */
  failed: number;
}

export async function fillIssueTypesFromReport(
  pairs: ReadonlyArray<Report82IssueType>,
  deps: IssueTypeFillDeps
): Promise<IssueTypeFillSummary> {
  const summary: IssueTypeFillSummary = {
    candidates: pairs.length, matched: 0, filled: 0, alreadySet: 0, unmatched: 0, failed: 0,
  };

  for (const pair of pairs) {
    let ipoId: string | null = null;
    try {
      ipoId = await deps.resolveIpoId(pair.companyName);
    } catch (err) {
      summary.failed++;
      deps.logger?.warn({ companyName: pair.companyName, err }, 'issue-type fill: resolve failed');
      continue;
    }
    if (!ipoId) { summary.unmatched++; continue; }
    summary.matched++;

    try {
      const wrote = await deps.fillIssueTypeIfNull(ipoId, pair.issueType);
      if (!wrote) { summary.alreadySet++; continue; }
      summary.filled++;
      // Provenance follows the write, never precedes it: a row written for a
      // no-op would claim a source for a value this run did not set.
      await deps.trackFieldUpdate({
        ipoId,
        tableName: 'ipo_details',
        fieldName: 'issueType',
        source: 'CHITTORGARH',
        confidence: REPORT82_CONFIDENCE,
        dataLineage: { method: 'CHITTORGARH_REPORT_82', field: 'Pricing Method' },
        updatedBy: 'CHITTORGARH_ISSUE_TYPE_FILL',
      });
    } catch (err) {
      summary.failed++;
      deps.logger?.warn({ ipoId, companyName: pair.companyName, err }, 'issue-type fill: write failed');
    }
  }

  return summary;
}
