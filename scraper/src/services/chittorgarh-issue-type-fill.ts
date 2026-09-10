/**
 * Item 2 slice 7 — write the issue type Chittorgarh report 82 already publishes.
 *
 * Dependencies are injected, so this is testable without a database and the
 * caller owns the fetch, the matching rule and the writer. That matters here:
 * the same-name matching is the part most likely to be got wrong, and it stays
 * outside this function where it can be tested on its own.
 *
 * THE SAFETY ARGUMENT IS THE NULL GUARD **PLUS ADMIN PROTECTION**, NOT A RANKING.
 *
 * CORRECTION: the first version of this comment said the null guard was the
 * WHOLE protection, on the grounds that `ipo_details` has no priority engine.
 * That was wrong. ADMIN's analogue for this table is `filterProtectedFields`,
 * which every other `ipo_details` write door passes through and this one did
 * not - and an admin lock CLEARS the field to NULL, which makes the null guard
 * fire in the attacker's favour. `isWriteAllowed` is now required in the deps. `ipo_details` has no
 * source-priority mechanism — measured 2026-09-11: the field-priority matrix
 * governs `ipos` writes only, and `dropOutranked` is cover-versus-price-band-ad
 * arbitration that no-ops unless the incoming write IS a prospectus cover. So a
 * 60-confidence aggregator value cannot be RANKED below a filing here; it can
 * only be made HARMLESS. `fillIssueTypeIfNull` is that harmlessness, and a
 * provenance row is written ONLY when it reports a real write.
 */

import { BASE_SOURCE_CONFIDENCE } from '../config/source-confidence.js';
import type { Report82IssueType, IssueType } from '../scrapers/chittorgarh-report82-fields.js';

/** Written from the canonical table, never typed as a literal — a hardcoded 60 drifts. */
export const REPORT82_CONFIDENCE = BASE_SOURCE_CONFIDENCE.CHITTORGARH;

export interface IssueTypeFillDeps {
  /** Resolve a report name to a stored IPO id. Returns null when it matches none. */
  resolveIpoId(companyName: string): Promise<string | null>;
  /** The SAME fold the index was built with - used to detect report-side collisions. */
  foldKey(companyName: string): string;
  /** The stored row's open date as ISO yyyy-mm-dd, or null when we hold none. */
  /** REQUIRED, not optional: an optional guard is one a future caller disables
   *  by omission, with no type error and no signal. Return null when we hold no
   *  date - the check then cannot run, which `noReportDate` makes visible. */
  storedOpenDate(ipoId: string): Promise<string | null>;
  /**
   * Create the `ipo_details` identity row when the IPO has none. True when it
   * created one. REQUIRED in practice, not optional decoration: 182 of the 183
   * fillable IPOs have no `ipo_details` row at all, so an UPDATE-only fill
   * reaches exactly ONE of them. Must be INSERT .. ON CONFLICT DO NOTHING, so a
   * repeat cycle never touches an existing row's data_source.
   */
  /**
   * ADMIN PROTECTION. False when an admin has locked this IPO or protected this
   * field. REQUIRED, not optional decoration.
   *
   * `ipo_details` has no source-priority engine, so I originally argued the NULL
   * guard was the whole protection. THAT WAS WRONG, and a Tier A review caught
   * it: ADMIN's analogue for this table is `filterProtectedFields`, which every
   * other `ipo_details` write door passes through and this one did not. Without
   * it: an admin finds a wrong issue_type, clears it to NULL and locks the IPO -
   * which makes `issue_type IS NULL` TRUE - and the next cycle writes the value
   * straight back with sourced provenance and no signal to the admin.
   */
  isWriteAllowed(ipoId: string, issueType: string): Promise<boolean>;
  ensureDetailsRow(ipoId: string): Promise<boolean>;
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
  /**
   * Identity rows CREATED. Deliberately separate from `filled`: creating a row
   * and filling a value are different claims, and a counter that merges them
   * would report a successful fill for a row that only came into existence.
   */
  rowsCreated: number;
  /** Refused because an admin locked the IPO or protected the field. */
  blockedByAdmin: number;
  /**
   * Refused because two REPORT rows fold together and DISAGREE on the type.
   * Only ever the disagreeing population - see `duplicateResolved` for the
   * agreeing one. Round 2 of the review caught these two being merged into one
   * number, which made an operator read "the source contradicted itself" from a
   * count that was in fact benign duplication.
   */
  reportAmbiguous: number;
  /**
   * Two DIFFERENT report rows that AGREE and resolve to the same stored IPO.
   * The first wrote it; this counts the rest. Benign, but counted and logged
   * rather than folded into alreadySet, which would report agreement with the
   * database when it is agreement with another report row.
   */
  duplicateResolved: number;
  /**
   * The report row carried no parseable open date, so the temporal check could
   * not run. Counted so a silent format change on the source is visible: if this
   * jumps to the row count, the guard has gone inert.
   */
  noReportDate: number;
  /** Refused because the report's open date disagrees with the stored row. */
  dateMismatch: number;
  /** Rows whose write threw; counted, never swallowed silently. */
  failed: number;
}

export async function fillIssueTypesFromReport(
  pairs: ReadonlyArray<Report82IssueType>,
  deps: IssueTypeFillDeps
): Promise<IssueTypeFillSummary> {
  const summary: IssueTypeFillSummary = {
    candidates: pairs.length, matched: 0, filled: 0, alreadySet: 0, unmatched: 0,
    rowsCreated: 0, blockedByAdmin: 0, reportAmbiguous: 0, duplicateResolved: 0,
    noReportDate: 0, dateMismatch: 0, failed: 0,
  };

  // REPORT-SIDE AMBIGUITY, refused before anything is resolved.
  //
  // buildFoldedIndex refuses when two STORED rows share a key. Nothing refused
  // when two REPORT rows share one - a Tier A review caught that the guard was
  // one-sided, and it is not theoretical: on the live 231-row report today, 196
  // matches resolve to only 195 distinct IPOs. Without this, both report rows
  // resolve to the same stored id, the first wins, and the second is silently
  // counted as `alreadySet` - so a disagreement between two report rows is
  // recorded as agreement.
  const byKey = new Map<string, Set<IssueType>>();
  for (const pair of pairs ?? []) {
    const k = deps.foldKey(pair.companyName);
    if (!k) continue;
    const s = byKey.get(k);
    if (s) s.add(pair.issueType);
    else byKey.set(k, new Set([pair.issueType]));
  }
  const conflictedKeys = new Set(
    [...byKey.entries()].filter(([, v]) => v.size > 1).map(([k]) => k)
  );

  // ATTEMPTED, not written: an id lands here before the date, admin and write
  // steps, so a row whose write throws is not retried by a later duplicate in
  // the same run. Next cycle retries it; naming it `writtenIds` would have
  // claimed more than it does.
  const attemptedIds = new Set<string>();

  for (const pair of pairs) {
    if (conflictedKeys.has(deps.foldKey(pair.companyName))) {
      summary.reportAmbiguous++;
      deps.logger?.warn(
        { companyName: pair.companyName },
        'issue-type fill: two report rows fold together and disagree - refusing both'
      );
      continue;
    }
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

    // Two DIFFERENT report rows resolving to one stored IPO. They necessarily
    // AGREE - a disagreeing pair shares a fold key and was refused by the
    // pre-pass above - so this is benign duplication, counted on its own line
    // and logged. Folding it into `alreadySet` would report agreement with the
    // DATABASE when it is agreement with another report row.
    if (attemptedIds.has(ipoId)) {
      summary.duplicateResolved++;
      deps.logger?.warn(
        { ipoId, companyName: pair.companyName },
        'issue-type fill: a second report row resolves to an IPO already handled this run'
      );
      continue;
    }
    attemptedIds.add(ipoId);

    // A name match is not an identity match. When BOTH sides carry an open date
    // and they disagree, this is a different issue of the same company - a
    // refile, or an older issue whose name folds identically. Refuse rather than
    // write this year's pricing method onto a previous issue's row. When either
    // side has no date the check cannot run and is not invented.
    if (!pair.openDate) summary.noReportDate++;
    const storedOpen = await deps.storedOpenDate(ipoId);
    if (pair.openDate && storedOpen && pair.openDate !== storedOpen) {
      summary.dateMismatch++;
      deps.logger?.warn(
        { ipoId, companyName: pair.companyName, reportOpenDate: pair.openDate, storedOpenDate: storedOpen },
        'issue-type fill: open dates disagree - refusing, this is a different issue'
      );
      continue;
    }

    // ADMIN PROTECTION, checked before any write. An admin lock makes
    // issue_type NULL and therefore makes the NULL guard USELESS as a defence.
    let allowed = false;
    try {
      allowed = await deps.isWriteAllowed(ipoId, pair.issueType);
    } catch (err) {
      summary.failed++;
      deps.logger?.warn({ ipoId, err }, 'issue-type fill: protection check failed - refusing the write');
      continue;
    }
    if (!allowed) { summary.blockedByAdmin++; continue; }

    let wrote_ = false;
    try {
      // Create the identity row FIRST when it is missing, or the UPDATE below
      // has no row to touch. Counted on its own line - never as a fill.
      if (await deps.ensureDetailsRow(ipoId)) summary.rowsCreated++;
      const wrote = await deps.fillIssueTypeIfNull(ipoId, pair.issueType);
      if (!wrote) { summary.alreadySet++; continue; }
      summary.filled++;
      wrote_ = true;
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
      // If the ROW was written and only provenance tracking threw, the pair has
      // already been counted as `filled`. Counting it as `failed` too would
      // break the identity the summary implies -
      // candidates == unmatched + reportAmbiguous + duplicateResolved +
      // dateMismatch + blockedByAdmin + failed + filled + alreadySet -
      // and would fail the cycle step for a row that WAS written. Round 2
      // caught this; it is logged distinctly instead.
      if (wrote_) {
        deps.logger?.warn(
          { ipoId, companyName: pair.companyName, err },
          'issue-type fill: the value was written but its provenance row was NOT - provenance is now behind the data'
        );
      } else {
        summary.failed++;
        deps.logger?.warn({ ipoId, companyName: pair.companyName, err }, 'issue-type fill: write failed');
      }
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
