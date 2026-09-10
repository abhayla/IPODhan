/**
 * Item 2 slice 7 — the composition root: fetch report 82, match, fill.
 *
 * Everything decidable lives in the pure pieces this file wires together
 * (`chittorgarh-report82-fields.ts`, `chittorgarh-issue-type-fill.ts`). This
 * file owns only the parts that need the network and the database, so it is
 * the one piece that cannot be unit-tested without them — kept deliberately
 * thin for that reason.
 *
 * WHY A SEPARATE JOB RATHER THAN A HOOK INSIDE THE ORCHESTRATOR. The scrape
 * orchestrator's job is to write `ipos`. This writes `ipo_details`, a different
 * table with a different writer and a different safety argument (a NULL guard,
 * not a priority engine). Folding it into `scrapeData()` would put two write
 * contracts behind one error path.
 */

import { sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { foldCompanyIdentity } from '@ipodhan/shared/utils/company-identity-fold';
import {
  fetchChittorgarhAPI,
  extractTextFromAnchor,
  REPORT82_PAGE_SIZE,
} from '../scrapers/chittorgarh-scraper.js';
import { collectIssueTypesFromReport } from '../scrapers/chittorgarh-report82-fields.js';
import {
  buildFoldedIndex,
  resolveByFoldedName,
  fillIssueTypesFromReport,
  REPORT82_CONFIDENCE,
  type IssueTypeFillSummary,
  type MatchCandidate,
} from './chittorgarh-issue-type-fill.js';

export interface IssueTypeJobDeps {
  /** Every stored IPO the report could name. Read once; matching is in memory. */
  loadCandidates(): Promise<MatchCandidate[]>;
  ensureDetailsRow(ipoId: string, source: string): Promise<boolean>;
  fillIssueTypeIfNull(ipoId: string, issueType: string): Promise<boolean>;
  trackFieldUpdate(row: {
    ipoId: string;
    tableName: string;
    fieldName: string;
    source: string;
    confidence: number;
    dataLineage: unknown;
    updatedBy: string;
  }): Promise<void>;
  fetchReport(): Promise<ReadonlyArray<Record<string, unknown>>>;
  logger: { info(o: unknown, m: string): void; warn(o: unknown, m: string): void };
}

export interface IssueTypeJobResult extends IssueTypeFillSummary {
  /** Rows the report returned. ZERO is an error condition, not an empty day. */
  reportRows: number;
  /** Stored IPOs the matcher could choose between. */
  candidates_: number;
  /** Set when the job refused to run; the summary counters are then all zero. */
  abortedReason?: string;
}

/**
 * Read report 82 once, at the ONLY page size it accepts.
 *
 * REPORT82_PAGE_SIZE is not a tuning knob — every other value returns HTTP 200
 * with zero rows and an "Invalid API Call" body. See its comment for the
 * measurement.
 */
export async function fetchReport82(): Promise<ReadonlyArray<Record<string, unknown>>> {
  const data = await fetchChittorgarhAPI(1, REPORT82_PAGE_SIZE, 'all');
  if ((data as { error?: unknown }).error) {
    throw new Error(`Chittorgarh report 82 returned an error: ${String((data as { error?: unknown }).error)}`);
  }
  // The report's own record type is a fixed-key shape; the collector reads it
  // as an open bag of columns, so this widens through `unknown` deliberately.
  return (data.reportTableData ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
}

export async function runIssueTypeFillJob(deps: IssueTypeJobDeps): Promise<IssueTypeJobResult> {
  const empty: IssueTypeFillSummary = {
    candidates: 0, matched: 0, filled: 0, alreadySet: 0, unmatched: 0, rowsCreated: 0, failed: 0,
  };

  const records = await deps.fetchReport();

  // A ZERO-ROW REPORT IS A BROKEN CALL, NOT A QUIET DAY. The endpoint answers
  // HTTP 200 with an empty list when the request is malformed, so treating
  // "no rows" as "nothing to do" would make a permanently broken job look
  // healthy forever. Report 82 lists the whole financial year; it is never
  // legitimately empty.
  if (records.length === 0) {
    deps.logger.warn({}, 'issue-type fill: report 82 returned ZERO rows - refusing to treat as no-op');
    return { ...empty, reportRows: 0, candidates_: 0, abortedReason: 'report returned zero rows' };
  }

  const pairs = collectIssueTypesFromReport(records, extractTextFromAnchor);
  const candidates = await deps.loadCandidates();
  const index = buildFoldedIndex(candidates, foldCompanyIdentity);

  const summary = await fillIssueTypesFromReport(pairs, {
    resolveIpoId: async (companyName) => resolveByFoldedName(companyName, index, foldCompanyIdentity),
    ensureDetailsRow: (ipoId) => deps.ensureDetailsRow(ipoId, 'CHITTORGARH'),
    fillIssueTypeIfNull: deps.fillIssueTypeIfNull,
    trackFieldUpdate: deps.trackFieldUpdate,
    logger: deps.logger,
  });

  deps.logger.info(
    { ...summary, reportRows: records.length, storedCandidates: candidates.length, confidence: REPORT82_CONFIDENCE },
    'issue-type fill complete'
  );
  return { ...summary, reportRows: records.length, candidates_: candidates.length };
}

/** Live wiring. Kept apart from the job so the job stays testable. */
export function makeIssueTypeJobDeps(
  db: { execute: (q: unknown) => Promise<{ rows: Array<Record<string, unknown>> }> },
  writer: {
    insertIfMissing?(ipoId: string, values: Record<string, unknown>): Promise<boolean>;
    fillIssueTypeIfNull?(ipoId: string, issueType: string): Promise<boolean>;
  },
  fieldSources: { trackFieldUpdate(input: never): Promise<unknown> },
  logger: IssueTypeJobDeps['logger']
): IssueTypeJobDeps {
  return {
    fetchReport: fetchReport82,
    async loadCandidates() {
      // Only IPOs whose issue_type is not already set have anything to gain, but
      // the index must hold ALL of them: a name that folds onto an
      // already-filled row is an AMBIGUITY the matcher has to see, not a miss.
      const res = await db.execute(
        sql`select i.id::text as id, i.company_name as "companyName" from ${schema.ipos} i`
      );
      return res.rows.map((r) => ({ id: String(r.id), companyName: String(r.companyName ?? '') }));
    },
    async ensureDetailsRow(ipoId, source) {
      if (!writer.insertIfMissing) return false;
      return writer.insertIfMissing(ipoId, { dataSource: source });
    },
    async fillIssueTypeIfNull(ipoId, issueType) {
      if (!writer.fillIssueTypeIfNull) return false;
      return writer.fillIssueTypeIfNull(ipoId, issueType);
    },
    async trackFieldUpdate(row) {
      await fieldSources.trackFieldUpdate(row as never);
    },
    logger,
  };
}
