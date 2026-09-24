/**
 * Item 22 round 3 (OD-36, F-154; failure class container-unwrapped-to-one-member):
 * the data-slot pass that expands zips stored BEFORE the runner kept their
 * other members.
 *
 * Why in the pipeline and not only in the repair CLI: `--apply` writes member
 * PDFs into the document store on the serving host, and a manual run there is
 * an ad-hoc host run. Here the expansion reaches staging through the normal
 * deploy and prod with the release.
 *
 * Bounded per wake: at most `STORED_ZIP_EXPANSIONS_PER_WAKE` zips, and no new
 * download starts after `STORED_ZIP_EXPANSION_CEILING_MS`. Why 3: a stored-zip
 * download is one GET bounded by DOWNLOAD_TIMEOUT_MS (120 s); three typical
 * RHP zips take seconds, and even three timeouts stay inside the 3-minute
 * ceiling plus one timeout, a small slice of the 20-minute wake whose remainder
 * extraction takes. At ~16 wakes per data slot and two slots a day, 3 per wake
 * clears the 168 zips measured on staging in about two days while leaving live
 * discovery untouched.
 *
 * Idempotent: `documents.zip_members_checked_at` is written for every definite
 * verdict (`expandStoredZip`), and the selection reads only rows where it is
 * NULL, so the next wake does 0 for a zip already examined, including one whose
 * members were all GID or duplicates.
 */
import logger from '../utils/logger.js';
import type { StoredZipRow } from '@ipodhan/shared/repositories';
import { DOCUMENT_TYPES, type DocumentType } from './document-types.js';
import type { SeenBySha, StoredZip, StoredZipExpansion } from './zip-member-documents.js';

export const STORED_ZIP_EXPANSIONS_PER_WAKE = 3;
export const STORED_ZIP_EXPANSION_CEILING_MS = 3 * 60 * 1000;

/**
 * Item 22 round 4 (Tier A MAJOR): how many DISTINCT data slots a transport-level
 * re-fetch failure (404, timeout, refused address) may happen in before the zip
 * is marked checked as `zip_unreachable` and leaves the selection. Not a
 * per-wake count (there are ~16 wakes/slot) — `markZipExpandAttemptFailed`
 * increments only when the slot changes, so a genuinely dead zip is retried on
 * 3 SEPARATE data-job wakes (spread over up to 3 slots, i.e. up to a day) before
 * it is given up on, never on 3 wakes 2 minutes apart.
 */
export const ZIP_EXPAND_MAX_ATTEMPTS = 3;

export interface StoredZipSelection {
  listZipsWithUncheckedMembers(options: { limit?: number; slug?: string | null }): Promise<StoredZipRow[]>;
}

export interface StoredZipExpander {
  expandStoredZip(zip: StoredZip, opts: { apply: boolean; seenBySha?: SeenBySha }): Promise<StoredZipExpansion>;
}

export interface StoredZipPassSummary {
  selected: number;
  expanded: number;
  refused: number;
  /**
   * Item 22 round 4: refused AND `checked: true` — a zip closed without being
   * expanded (cover-check refusal, an archive that changed, or 3 distinct-slot
   * `zip_unreachable` failures). Distinguishable from `expanded` (members were
   * stored) and from a still-pending refusal (`checked: false`, retried next
   * wake) — requirement 4 of round 4: both a cover-check refusal and a
   * `zip_unreachable` close are counted here and neither is read as expanded.
   */
  unresolved: number;
  unchecked: number;
  membersStored: number;
  skippedByCeiling: number;
}

/** A selected row as the expander takes it; a row of an unknown type is dropped. */
export function toStoredZip(row: StoredZipRow): StoredZip | null {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(row.type)) return null;
  return { ...row, type: row.type as DocumentType };
}

export async function runStoredZipExpansionPass(
  deps: { selection: StoredZipSelection; expander: StoredZipExpander; now?: () => number },
  options: { limit?: number; ceilingMs?: number } = {}
): Promise<StoredZipPassSummary> {
  const now = deps.now ?? Date.now;
  const limit = options.limit ?? STORED_ZIP_EXPANSIONS_PER_WAKE;
  const ceilingMs = options.ceilingMs ?? STORED_ZIP_EXPANSION_CEILING_MS;
  const startedAt = now();
  const summary: StoredZipPassSummary = {
    selected: 0,
    expanded: 0,
    refused: 0,
    unresolved: 0,
    unchecked: 0,
    membersStored: 0,
    skippedByCeiling: 0,
  };
  const rows = await deps.selection.listZipsWithUncheckedMembers({ limit });
  summary.selected = rows.length;
  const seenByIpo = new Map<string, SeenBySha>();
  for (const row of rows) {
    if (now() - startedAt >= ceilingMs) {
      summary.skippedByCeiling += 1;
      continue;
    }
    const zip = toStoredZip(row);
    if (!zip) {
      summary.refused += 1;
      logger.warn({ documentId: row.documentId, type: row.type }, 'Stored zip of an unknown document type skipped (item 22)');
      continue;
    }
    let seen = seenByIpo.get(zip.ipoId);
    if (!seen) seenByIpo.set(zip.ipoId, (seen = new Map()));
    const r = await deps.expander.expandStoredZip(zip, { apply: true, seenBySha: seen });
    if (r.refused) {
      summary.refused += 1;
      if (r.checked) summary.unresolved += 1;
    } else {
      summary.expanded += 1;
    }
    if (!r.checked) summary.unchecked += 1;
    summary.membersStored += r.outcomes.filter((o) => o.action === 'stored').length;
  }
  logger.info({ ...summary, limit, ceilingMs }, 'Stored-zip member expansion pass (item 22)');
  return summary;
}
