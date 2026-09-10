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

/** A stored IPO row, reduced to what matching needs. */
export interface MatchCandidate {
  id: string;
  companyName: string;
}

/**
 * Match a report name to exactly ONE stored IPO, by folded identity.
 *
 * REFUSES AMBIGUITY. When two stored rows fold to the same key, this returns
 * null rather than picking one — the report cannot tell them apart either, and a
 * wrong pick writes a sourced value onto the wrong company. Issue #562 is the
 * live example of the opposite policy: matching our INJECTO POLYMERS to NSE's
 * INDIA PESTICIDES on a shared three-letter symbol.
 *
 * Folded identity, never the raw name and never a symbol: the fold is the
 * repo's one identity rule (`foldCompanyIdentity`), so "Asset Reconstruction
 * Co.(India) Ltd." and "ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED" resolve
 * together, which is exactly the case that created a duplicate row on 2026-09-09.
 */
export function buildFoldedIndex(
  candidates: ReadonlyArray<MatchCandidate>,
  fold: (name: string) => string
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const c of candidates ?? []) {
    const key = fold(c.companyName);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(c.id);
    else index.set(key, [c.id]);
  }
  return index;
}

/** Returns the single matching IPO id, or null when there is none or more than one. */
export function resolveByFoldedName(
  companyName: string,
  index: ReadonlyMap<string, string[]>,
  fold: (name: string) => string
): string | null {
  const key = fold(companyName);
  if (!key) return null;
  const bucket = index.get(key);
  if (!bucket || bucket.length !== 1) return null; // none, or ambiguous — refuse
  return bucket[0];
}
