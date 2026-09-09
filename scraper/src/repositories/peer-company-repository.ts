/**
 * Peer Company Repository (Scraper)
 *
 * Data access layer for peer companies in scraper context
 * Simplified version without caching (caching handled by web layer)
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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
  async replaceForIpo(ipoId: string, rows: PeerCompanyInsert[]): Promise<PeerCompany[]> {
    if (rows.length === 0) return [];

    const byRowKey = new Map<string, PeerCompanyInsert>();
    for (const row of rows) {
      byRowKey.set(row.normalizedName, row);
    }
    const deduped = [...byRowKey.values()];

    return this.db.transaction(async (tx) => {
      await tx.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, ipoId));
      return tx.insert(schema.peerCompanies).values(deduped).returning();
    });
  }
}
