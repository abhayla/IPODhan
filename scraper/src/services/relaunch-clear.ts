/**
 * §2.9 + OD-120 (§9.2 item 27): the scraper side of the relaunch clear. Which fields are DOCUMENT
 * fields is the field manifest's: a field that any document source ranks for any IPO type, and never
 * an E-1 timetable field (manifest class `T`). The clear itself is the shared
 * `clearAdminValuesOnRelaunch`; it runs only on a relaunch filing (the OD-83 source-key supersede /
 * OD-86 merge, or a post-postponement offer document with a new window or band).
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

function logCleared(summary: RelaunchClearSummary | null): void {
  if (summary && summary.cleared.length > 0) {
    logger.info(
      {
        ipoId: summary.ipoId,
        slug: summary.slug,
        relaunch: summary.documentType,
        cleared: summary.cleared.map((c) => `${c.tableName}.${c.fieldName}${c.adminEmpty ? ' (admin EMPTY)' : ''}`),
      },
      `[relaunch] ${summary.documentType} on POSTPONED ${summary.slug} cleared ${summary.cleared.length} admin value(s) (OD-120)`
    );
  }
}

/** Inside the COMPLETED transaction of a document: clears only when it is a relaunch offer document. */
export async function clearAdminValuesForRelaunchFiling(
  tx: ExecuteLike,
  doc: { id: string; ipoId: string; type: string },
  receipt: ReadonlyArray<{ tableName: string; rowKey: string; fieldName: string; value?: string | null }>
): Promise<RelaunchClearSummary | null> {
  const summary = await clearAdminValuesOnRelaunch(
    tx,
    doc.ipoId,
    { kind: 'OFFER_DOCUMENT', documentId: doc.id, documentType: doc.type },
    receipt,
    isRelaunchDocumentField
  );
  logCleared(summary);
  return summary;
}

/** Inside the source-key bind transaction: clears when the bind superseded an older key under OD-83. */
export async function clearAdminValuesOnSourceKeyRelaunch(
  tx: ExecuteLike,
  ipoId: string,
  supersededKeyIds: readonly string[]
): Promise<RelaunchClearSummary | null> {
  if (supersededKeyIds.length === 0) return null;
  const summary = await clearAdminValuesOnRelaunch(tx, ipoId, { kind: 'SOURCE_KEY_RELAUNCH', supersededKeyIds }, [], isRelaunchDocumentField);
  logCleared(summary);
  return summary;
}

/** The repository's `bindSourceKeys` (typed loosely: the key types live in the shared repository module). */
export interface SourceKeyBinder {
  bindSourceKeys(
    ipoId: string,
    refs: any[] | null | undefined,
    opts: {
      boundVia: any;
      boundBy: string;
      onSupersede?: (tx: ExecuteLike, ipoId: string, supersededIds: string[]) => Promise<unknown>;
    }
  ): Promise<unknown>;
}

/**
 * The scraper's bind: records the keys and, when the bind is an OD-83 relaunch (an older key
 * SUPERSEDED), clears the admin values in the same transaction; the ONE alert goes out after commit.
 */
export async function bindSourceKeysClearingOnRelaunch(
  repo: SourceKeyBinder,
  ipoId: string,
  refs: any[] | null | undefined,
  opts: { boundVia: any; boundBy: string }
): Promise<RelaunchClearSummary | null> {
  let cleared: RelaunchClearSummary | null = null;
  await repo.bindSourceKeys(ipoId, refs, {
    ...opts,
    onSupersede: async (tx, id, supersededIds) => {
      cleared = await clearAdminValuesOnSourceKeyRelaunch(tx, id, supersededIds);
    },
  });
  const done = cleared as RelaunchClearSummary | null;
  if (done && done.cleared.length > 0) {
    const { sendRelaunchClearedAlert } = await import('./admin-alerts.js');
    await sendRelaunchClearedAlert(done);
  }
  return done;
}
