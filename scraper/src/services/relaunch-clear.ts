/**
 * §2.9 + OD-120 (§9.2 item 27): the scraper side of the relaunch clear. Which fields are DOCUMENT
 * fields is the field manifest's: a field that any document source ranks for any IPO type, and never
 * an E-1 timetable field (manifest class `T`). The clear itself is the shared
 * `clearAdminValuesOnRelaunch`, run inside the COMPLETED transaction by `writeReceiptAndReopen`.
 */
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import {
  clearAdminValuesOnRelaunch,
  type ExecuteLike,
  type RelaunchClearSummary,
} from '@ipodhan/shared/services/relaunch-admin-clear';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import { logger } from '../utils/logger.js';

/** Sources that print from a filed document (field-source-override-validation.ts DOCUMENT_SOURCES). */
const DOCUMENT_SOURCES: ReadonlySet<string> = new Set(['DOC', 'DRHP', 'RHP', 'PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD']);

let documentFieldKeys: Set<string> | null = null;

/** `table|camelField` of every manifest field a document source ranks, class `T` (E-1) excluded. */
export function documentFieldSet(manifest = loadFieldManifest()): Set<string> {
  const out = new Set<string>();
  for (const [key, entry] of Object.entries(manifest.fields)) {
    if (entry.class === 'T') continue;
    const ranked = Object.values(entry.rank ?? {}).flat() as string[];
    if (!ranked.some((s) => DOCUMENT_SOURCES.has(s))) continue;
    const dot = key.indexOf('.');
    out.add(`${key.slice(0, dot)}|${columnToCamelCase(key.slice(dot + 1))}`);
  }
  return out;
}

export function isRelaunchDocumentField(tableName: string, fieldName: string): boolean {
  documentFieldKeys ??= documentFieldSet();
  return documentFieldKeys.has(`${tableName}|${fieldName}`);
}

export async function clearAdminValuesForRelaunchFiling(
  tx: ExecuteLike,
  doc: { id: string; ipoId: string; type: string },
  receipt: ReadonlyArray<{ tableName: string; rowKey: string; fieldName: string; value?: string | null }>
): Promise<RelaunchClearSummary | null> {
  const summary = await clearAdminValuesOnRelaunch(tx, doc, receipt, isRelaunchDocumentField);
  if (summary && summary.cleared.length > 0) {
    logger.info(
      {
        ipoId: doc.ipoId,
        slug: summary.slug,
        documentId: doc.id,
        documentType: doc.type,
        cleared: summary.cleared.map((c) => `${c.tableName}.${c.fieldName}${c.adminEmpty ? ' (admin EMPTY)' : ''}`),
      },
      `[relaunch] ${doc.type} ${doc.id} on POSTPONED ${summary.slug} cleared ${summary.cleared.length} admin value(s) (OD-120)`
    );
  }
  return summary;
}
