/**
 * Peer Company Repository (Scraper)
 *
 * Data access layer for peer companies in scraper context
 * Simplified version without caching (caching handled by web layer)
 */

import { lockAndReadRowHolds, applyRowHolds, type HoldExecutor } from '@ipodhan/shared/services/field-hold';
import { lockAndReadListOwnership, recordListSuggestion } from '@ipodhan/shared/services/admin-list-hold';
import { logger } from '../utils/logger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray } from 'drizzle-orm';
import { retireChildRowSources } from '@ipodhan/shared/repositories/field-sources-retirement';
import * as schema from '@ipodhan/shared/db/schema';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export type PeerCompany = InferSelectModel<typeof schema.peerCompanies>;
// normalizedName narrowed to required: the column keeps its '' schema
// default (gated DROP DEFAULT, see web/drizzle/migrations/_gated/
// E1_row_key_unique_constraints.sql) so drizzle-orm's InferInsertModel
// still infers it optional — narrowed here the same way
// promoters-repository.ts and ipo-intermediaries-repository.ts narrow it,
// so a caller omitting the row key fails at build time, not at runtime.
export type PeerCompanyInsert = Omit<
  InferInsertModel<typeof schema.peerCompanies>,
  'normalizedName'
> & {
  normalizedName: string;
};

/**
 * #545 round 2. How a document's peer set meets rows another source already
 * stored. Omitted = the original whole-set replace (the Chittorgarh path in
 * data-persister.ts is unchanged).
 */
export interface PeerReplaceOptions {
  /**
   * A null (or absent) value in an incoming row is "this source printed
   * nothing here", never "erase". The stored non-null value for the same row
   * key is kept. `isListed` falls back to the stored value, then to true.
   */
  nullNeverOverwrites?: boolean;
  /** The writer, named on a suggestion when the admin owns the list (§9.2 item 8). */
  source?: string;
  /**
   * The incoming set is NOT a complete replacement (it carries names only):
   * rows it does not name are kept untouched, rows it names that already
   * exist are left as stored, and only new row keys are inserted.
   */
  fillGapsOnly?: boolean;
  /**
   * OD-156: the offer document type the incoming set came from. When set, a stored peer the set
   * no longer names is removed ONLY when it is a document peer whose recorded type is the same as
   * or older than this one (`documentPeerMayBeRemoved`); every other stored row is kept. When
   * omitted (the Chittorgarh path) the set is a whole-list replace, as before.
   */
  documentType?: string;
  /** OD-157: which set replaced a deleted row, written as the retired source records' reason. */
  replacedBy?: string;
}

/** OD-156 / OD-154: the document order for peer list membership. Lower = older. */
export const PEER_DOCUMENT_ORDER: Readonly<Record<string, number>> = { DRHP: 1, RHP: 2, PROSPECTUS: 3 };

/**
 * OD-156: may a document peer list of `incomingType` remove this stored row it no longer names?
 * Only a row a DOCUMENT wrote (data_source 'DRHP', the enum slot every document maps to) whose real
 * document type is recorded and is the same as or older than the incoming list's. Fails closed: a
 * Chittorgarh or admin row, a document row of unknown type (written before OD-156), and any type
 * outside the OD-156 order (the price band advertisement) are never removed.
 */
export function documentPeerMayBeRemoved(
  stored: { dataSource: string | null; sourceDocumentType: string | null },
  incomingType: string
): boolean {
  if (stored.dataSource !== 'DRHP') return false;
  const storedRank = stored.sourceDocumentType ? PEER_DOCUMENT_ORDER[stored.sourceDocumentType] : undefined;
  const incomingRank = PEER_DOCUMENT_ORDER[incomingType];
  if (storedRank === undefined || incomingRank === undefined) return false;
  return storedRank <= incomingRank;
}

/** The value columns a peer row carries; identity and write metadata excluded. */
export const PEER_VALUE_COLUMNS = ['peRatio', 'eps', 'dilutedEps', 'ronw', 'nav', 'pbvRatio'] as const;

export class PeerCompanyRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Find all peer companies for an IPO
   */
  async findByIPOId(ipoId: string): Promise<PeerCompany[]> {
    const results = await this.db
      .select()
      .from(schema.peerCompanies)
      .where(eq(schema.peerCompanies.ipoId, ipoId));

    return results;
  }

  /**
   * Create a new peer company
   */
  async create(data: PeerCompanyInsert): Promise<PeerCompany> {
    const [peerCompany] = await this.db
      .insert(schema.peerCompanies)
      .values(data)
      .returning();

    return peerCompany;
  }

  /**
   * Delete all peer companies for an IPO
   * (Used before re-scraping to ensure fresh data)
   */
  async deleteByIPOId(ipoId: string): Promise<number> {
    const result = await this.db
      .delete(schema.peerCompanies)
      .where(eq(schema.peerCompanies.ipoId, ipoId));

    return result.rowCount || 0;
  }

  /**
   * Batch insert peer companies
   */
  async batchCreate(data: PeerCompanyInsert[]): Promise<PeerCompany[]> {
    if (data.length === 0) return [];

    const results = await this.db
      .insert(schema.peerCompanies)
      .values(data)
      .returning();

    return results;
  }

  /**
   * Replace the full peer-company list for one IPO inside a transaction
   * (Item 1 slice s2 fix round, F-1 / GitHub #443).
   *
   * Two peers in the same document that normalise to the same row key are
   * the same company written twice — the LAST one wins (a document lists
   * peers in filing order, and a duplicate mention later in the table is
   * more often a corrected/updated printing of the same row than the first
   * is; deterministic on the same input either way). De-duping HERE, before
   * the insert, means the `(ipo_id, normalized_name)` unique constraint
   * never fires from a same-document collision.
   *
   * The delete and the insert run in ONE transaction, the way
   * `PromotersRepository.replacePromoters` / `IpoIntermediariesRepository
   * .replaceForIpo` already do: if the insert throws (a genuine`23505` from
   * some other cause, a connection drop, anything), the transaction rolls
   * back and the previously stored rows survive — the delete never commits
   * on its own.
   *
   * An EMPTY `rows` is a no-op, not "delete everything" (F-3, Tier A
   * follow-up round): a future backfill/repair caller passing a document
   * that yielded no peers must not erase a good table just because it had
   * nothing new to write. Both current live callers already guard on
   * length before calling, so this only changes behaviour for callers that
   * don't yet exist — but it is a real behaviour change, called out here
   * because the unit test that asserted the old wipe-on-empty behaviour
   * had to be updated to match.
   */
  async replaceForIpo(
    ipoId: string,
    rows: PeerCompanyInsert[],
    options: PeerReplaceOptions = {}
  ): Promise<PeerCompany[]> {
    if (rows.length === 0) return [];

    const byRowKey = new Map<string, PeerCompanyInsert>();
    for (const row of rows) {
      byRowKey.set(row.normalizedName, row);
    }
    const deduped = [...byRowKey.values()];

    // §9.2 item 19 (§2.7): every branch takes the admin's lock (the IPO's ipos row, FOR NO KEY
    // UPDATE) and reads the per-row holds FIRST, and only then reads the stored rows, all in one
    // transaction. Reading `stored` before the lock let an admin save commit in between, and the
    // held field was then "kept" at its stale pre-admin value (Tier A CRITICAL, round 1).
    return this.db.transaction(async (tx) => {
      const t = tx as unknown as NodePgDatabase<typeof schema> & HoldExecutor;
      const holds = await lockAndReadRowHolds(t, ipoId, 'peer_companies');
      // §9.2 item 23 (OD-151): a hidden IPO's peer rows are left as stored; nothing is replaced.
      if (holds.hidden) return [];
      const stored = await tx
        .select()
        .from(schema.peerCompanies)
        .where(eq(schema.peerCompanies.ipoId, ipoId));
      const storedByKey = new Map(stored.map((row) => [row.normalizedName, row]));

      // §9.2 item 8 (OD-107): an admin-owned list is never replaced, extended or trimmed, in any
      // branch; the writer's list becomes a suggestion (rows to add / remove) for the admin queue.
      if ((await lockAndReadListOwnership(t, ipoId, 'peer_companies')).owned) {
        await recordListSuggestion(t, { ipoId, list: 'peer_companies', source: options.source ?? 'DRHP', stored, incoming: deduped as never });
        return options.fillGapsOnly ? [] : stored;
      }

      const incomingKeys = new Set(deduped.map((row) => row.normalizedName));
      const replacedBy = options.replacedBy ?? `a ${options.documentType ?? 'whole-list'} peer set`;

      if (options.fillGapsOnly) {
        // Insert-only for named rows: a stored row the set names is never touched. A row the admin
        // removed leaves a hold under its key with no stored row — it stays removed (OD-121: delete
        // = keep empty), never refilled. OD-156: names-only sets also remove the document peers of
        // the same or an older type that they no longer name (never a held row).
        if (options.documentType) {
          const dropped = stored
            .filter((row) => !incomingKeys.has(row.normalizedName))
            .filter((row) => !holds.rows.has(row.normalizedName))
            .filter((row) => documentPeerMayBeRemoved(row, options.documentType as string))
            .map((row) => row.normalizedName);
          await this.deleteAndRetire(tx, ipoId, dropped, replacedBy);
        }
        const fresh = deduped
          .filter((row) => !storedByKey.has(row.normalizedName))
          .filter((row) => !holds.rows.has(row.normalizedName))
          .map((row) => ({ ...row, isListed: row.isListed ?? true }));
        if (fresh.length === 0) return [];
        return tx.insert(schema.peerCompanies).values(fresh).returning();
      }

      let incoming: PeerCompanyInsert[] = deduped;
      if (options.nullNeverOverwrites) {
        incoming = deduped.map((row) => {
          const prior = storedByKey.get(row.normalizedName);
          const out: Record<string, unknown> = { ...row };
          for (const col of PEER_VALUE_COLUMNS) {
            if (out[col] === null || out[col] === undefined) out[col] = prior ? prior[col] : null;
          }
          if (typeof out.isListed !== 'boolean') out.isListed = prior ? prior.isListed : true;
          return out as PeerCompanyInsert;
        });
      }
      const rowsToWrite = this.honourRowHolds(ipoId, incoming, stored, holds.rows);
      const writtenKeys = new Set(rowsToWrite.map((row) => row.normalizedName));
      if (options.documentType) {
        // OD-156: rewrite the rows the set names (and held rows), remove only the document peers of
        // the same or an older type it no longer names; every other stored row stays as it is.
        const dropped = stored
          .filter((row) => !writtenKeys.has(row.normalizedName))
          .filter((row) => documentPeerMayBeRemoved(row, options.documentType as string))
          .map((row) => row.normalizedName);
        const rewritten = stored.map((row) => row.normalizedName).filter((key) => writtenKeys.has(key));
        if (rewritten.length > 0) {
          await tx
            .delete(schema.peerCompanies)
            .where(and(eq(schema.peerCompanies.ipoId, ipoId), inArray(schema.peerCompanies.normalizedName, rewritten)));
        }
        await this.deleteAndRetire(tx, ipoId, dropped, replacedBy);
      } else {
        await tx.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, ipoId));
        // OD-157: the whole-list replace deleted every stored row it did not write again.
        await retireChildRowSources(tx as unknown as NodePgDatabase<typeof schema>, {
          ipoId,
          tableName: 'peer_companies',
          rowKeys: stored.map((row) => row.normalizedName).filter((key) => !writtenKeys.has(key)),
          reason: `replaced by ${replacedBy}`,
        });
      }
      if (rowsToWrite.length === 0) return [];
      return tx.insert(schema.peerCompanies).values(rowsToWrite).returning();
    });
  }

  /**
   * OD-156 + OD-157: delete the named stored rows and, in the same transaction, retire their
   * field_sources records (kept in field_sources_retired with the date and the replacing set).
   */
  private async deleteAndRetire(
    tx: unknown,
    ipoId: string,
    rowKeys: string[],
    replacedBy: string
  ): Promise<void> {
    if (rowKeys.length === 0) return;
    const t = tx as NodePgDatabase<typeof schema>;
    await t
      .delete(schema.peerCompanies)
      .where(and(eq(schema.peerCompanies.ipoId, ipoId), inArray(schema.peerCompanies.normalizedName, rowKeys)));
    const retired = await retireChildRowSources(t, {
      ipoId,
      tableName: 'peer_companies',
      rowKeys,
      reason: `OD-156: no longer named by ${replacedBy}`,
    });
    logger.info({ ipoId, removed: rowKeys, retiredSourceRecords: retired, replacedBy }, '[OD-156] document peers dropped by a newer or same-type peer list');
  }

  /**
   * Spec §9.2 item 19 (§2.7) for a delete-and-reinsert writer: inside the replace transaction, lock
   * the IPO's ipos row (the admin's lock) and read the per-row holds (`peer_companies:<normalized
   * name>`); a held field keeps its stored value and a held row the new list omits is kept. The
   * list-level hold (whole list admin-owned, §9.2 item 8) is Phase B.
   */
  private honourRowHolds(
    ipoId: string,
    rows: PeerCompanyInsert[],
    stored: PeerCompany[],
    holds: ReadonlyMap<string, ReadonlySet<string>>
  ): PeerCompanyInsert[] {
    if (holds.size === 0) return rows;
    const out = applyRowHolds(rows as Record<string, unknown>[], stored as Record<string, unknown>[], holds, 'normalizedName');
    if (out.keptFields.length > 0 || out.keptRows.length > 0) {
      logger.info({ ipoId, keptFields: out.keptFields, keptRows: out.keptRows }, '[item 19] admin-held peer values kept inside the replace transaction');
    }
    return out.rows as PeerCompanyInsert[];
  }
}
