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
  loadCandidates(): Promise<Array<MatchCandidate & { openDate: string | null }>>;
  /** ADMIN protection: false when the IPO is locked or the field is protected. */
  isWriteAllowed(ipoId: string, issueType: string): Promise<boolean>;
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
/**
 * The fewest rows a real report-82 read can return. NOT zero.
 *
 * A zero-row guard cannot see a SHORT read, and a short read is the likelier
 * failure. `chittorgarh-rights-debt-adapter.ts` hits this SAME report id and
 * assumes the opposite of what this path assumes: it paginates, treating
 * `reportTableData.length === 10` as "there is more" (line ~469). This path
 * measured 231 rows returned in one call at perPage=10 on 2026-09-11. Both
 * cannot be true of the same endpoint, and the difference may be the `v`
 * parameter - that path sends v=20-47, this one v=15-11.
 *
 * Until that is reconciled, this floor is the guard: report 82 lists a whole
 * financial year, so a read returning a page-sized handful is a short read, not
 * a quiet year. 50 is deliberately well below the 231 observed and well above
 * any page size, so it catches the pagination case without tracking the real
 * count.
 */
export const REPORT82_MIN_ROWS = 50;

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
    candidates: 0, matched: 0, filled: 0, alreadySet: 0, unmatched: 0, rowsCreated: 0,
    blockedByAdmin: 0, reportAmbiguous: 0, duplicateResolved: 0, noReportDate: 0,
    dateMismatch: 0, failed: 0,
  };

  const records = await deps.fetchReport();

  // A ZERO-ROW REPORT IS A BROKEN CALL, NOT A QUIET DAY. The endpoint answers
  // HTTP 200 with an empty list when the request is malformed, so treating
  // "no rows" as "nothing to do" would make a permanently broken job look
  // healthy forever. Report 82 lists the whole financial year; it is never
  // legitimately empty.
  if (records.length < REPORT82_MIN_ROWS) {
    deps.logger.warn(
      { rows: records.length, floor: REPORT82_MIN_ROWS },
      'issue-type fill: report 82 returned FEWER rows than the floor - refusing to treat as a real read'
    );
    return {
      ...empty,
      reportRows: records.length,
      candidates_: 0,
      abortedReason: `report returned ${records.length} rows, below the floor of ${REPORT82_MIN_ROWS}`,
    };
  }

  const pairs = collectIssueTypesFromReport(records, extractTextFromAnchor);
  const candidates = await deps.loadCandidates();
  const index = buildFoldedIndex(candidates, foldCompanyIdentity);

  const openDates = new Map(candidates.map((c) => [c.id, c.openDate ?? null]));

  const summary = await fillIssueTypesFromReport(pairs, {
    resolveIpoId: async (companyName) => resolveByFoldedName(companyName, index, foldCompanyIdentity),
    foldKey: foldCompanyIdentity,
    storedOpenDate: async (ipoId) => openDates.get(ipoId) ?? null,
    isWriteAllowed: deps.isWriteAllowed,
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
  protectionFilter: (
    ipoId: string,
    table: string,
    data: Record<string, unknown>,
    scraperName: string
  ) => Promise<{ filtered: Record<string, unknown> }>,
  logger: IssueTypeJobDeps['logger']
): IssueTypeJobDeps {
  return {
    fetchReport: fetchReport82,
    async isWriteAllowed(ipoId, issueType) {
      // The admin layer every other ipo_details write door passes through. A
      // locked IPO returns an EMPTY `filtered`, which is the refusal.
      //
      // Probe with the REAL value, not a hardcoded one. A refusal writes an
      // admin notification carrying `attemptedValue`, so probing with a
      // hardcoded 'BOOK_BUILDING' would file "CHITTORGARH attempted to write
      // BOOK_BUILDING" every cycle for a locked IPO whose actual report value is
      // FIXED_PRICE - a refusal that is correct paired with an audit record that
      // is a lie. Round 2 of the review caught it.
      const res = await protectionFilter(ipoId, 'ipo_details', { issueType }, 'CHITTORGARH');
      return Object.keys(res?.filtered ?? {}).length > 0;
    },
    async loadCandidates() {
      // Only IPOs whose issue_type is not already set have anything to gain, but
      // the index must hold ALL of them: a name that folds onto an
      // already-filled row is an AMBIGUITY the matcher has to see, not a miss.
      const res = await db.execute(
        sql`select i.id::text as id, i.company_name as "companyName",
                   to_char(i.open_date, 'YYYY-MM-DD') as "openDate"
            from ${schema.ipos} i`
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        companyName: String(r.companyName ?? ''),
        openDate: r.openDate == null ? null : String(r.openDate),
      }));
    },
    async ensureDetailsRow(ipoId, source) {
      // THROW, never return false. Both methods are optional on IpoDetailsWriter,
      // and returning false for an ABSENT writer made "the writer is not wired"
      // report as alreadySet=231, filled=0, success - the exact inverse of the
      // truth, and a green log. A future reader deletes a guard like that in
      // good faith. An absent writer is a wiring bug and must be loud.
      if (!writer.insertIfMissing) {
        throw new Error('ipoDetailsWriter.insertIfMissing is not implemented - issue-type fill cannot create rows');
      }
      return writer.insertIfMissing(ipoId, { dataSource: source });
    },
    async fillIssueTypeIfNull(ipoId, issueType) {
      if (!writer.fillIssueTypeIfNull) {
        throw new Error('ipoDetailsWriter.fillIssueTypeIfNull is not implemented - issue-type fill cannot write');
      }
      return writer.fillIssueTypeIfNull(ipoId, issueType);
    },
    async trackFieldUpdate(row) {
      await fieldSources.trackFieldUpdate(row as never);
    },
    logger,
  };
}
