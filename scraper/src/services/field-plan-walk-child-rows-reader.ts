/**
 * Item 38 (spec §2.5.6 item 1): the read-only count the DOC fetcher answers an IPO-level child-table plan
 * row with. Its own module (schema + drizzle only) so a read-only harness can hand it any drizzle handle.
 */
import { count, eq, getTableColumns } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import type { ChildColumnCount, DocFetcherDeps } from './field-plan-walk-doc-fetcher.js';

/**
 * Item 38: the schema export behind each DOC_CHILD_ROWS_TABLES name. A name with no entry, or a column the
 * table does not have, answers `unknown_column` (the fetcher fails closed, CHECK_FAILED transient).
 */
const DOC_CHILD_ROWS_SCHEMA_EXPORT: Readonly<Record<string, string>> = {
  financial_statements: 'financialStatements',
  ipo_intermediaries: 'ipoIntermediaries',
  ipo_risk_factors: 'ipoRiskFactors',
  peer_companies: 'peerCompanies',
  promoter_acquisition_ranges: 'promoterAcquisitionRanges',
  promoters: 'promoters',
};

/** Item 38: one read-only count per ask -- the IPO's stored rows, and those with the column non-null. */
export function makeChildColumnCounter(database: { select: (...args: any[]) => any }): NonNullable<DocFetcherDeps['childColumnCounter']> {
  return async (ipoId, tableName, camelFieldName): Promise<ChildColumnCount> => {
    // Resolved per call, never at import: a test that mocks the schema module then imports this file freely.
    const exportName = DOC_CHILD_ROWS_SCHEMA_EXPORT[tableName];
    const table = exportName ? (schema as Record<string, any>)[exportName] : undefined;
    const column = table ? (getTableColumns(table) as Record<string, any>)[camelFieldName] : undefined;
    if (!table || !column || camelFieldName === 'ipoId') return { status: 'unknown_column' };
    const rows = await database
      .select({ rows: count(), withValue: count(column) })
      .from(table)
      .where(eq(table.ipoId, ipoId));
    return { status: 'ok', rows: Number(rows[0]?.rows ?? 0), withValue: Number(rows[0]?.withValue ?? 0) };
  };
}

