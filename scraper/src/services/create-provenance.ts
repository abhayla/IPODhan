/**
 * #1196 (OD-88: every column a write sets carries its field_sources row): the provenance rows for a
 * brand-new `ipos` row. ONE definition for both create doors - `DataConsolidationOrchestrator`
 * (`consolidatedUpsertIPO`, the live door) and `upsertIPO` (data-persister.ts, T-292). A create has no
 * prior value, so `previousValue` is null. Bookkeeping columns are not sourced.
 */
import type { ScraperSource } from '../config/field-priority-matrix';

const NOT_SOURCED = new Set(['id', 'slug', 'createdAt', 'updatedAt']);

export function createProvenanceFields(
  data: Record<string, unknown>,
  source: ScraperSource
): Array<{ fieldName: string; source: ScraperSource; confidence: number; previousValue: null }> {
  return Object.entries(data)
    .filter(([fieldName, value]) => value !== undefined && value !== null && !NOT_SOURCED.has(fieldName))
    .map(([fieldName]) => ({ fieldName, source, confidence: 100, previousValue: null }));
}
