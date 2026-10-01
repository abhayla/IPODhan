/**
 * #1364: `documents.filing_date` for a set of document ids, so consolidation can order two documents
 * of equal rank by filing date (OD-30). Read-only. An id that is not a uuid is skipped (a lineage
 * written by a tool may carry anything); an id with no row, or a null date, is absent / null.
 */
import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { documents } from '@ipodhan/shared/db/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readDocumentFilingDates(
  dbx: NodePgDatabase<Record<string, unknown>>,
  documentIds: string[]
): Promise<Map<string, string | null>> {
  const ids = [...new Set(documentIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0) return new Map();
  const rows = await dbx
    .select({ id: documents.id, filingDate: documents.filingDate })
    .from(documents)
    .where(inArray(documents.id, ids));
  return new Map(rows.map((r) => [r.id, r.filingDate == null ? null : String(r.filingDate).slice(0, 10)]));
}
