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
export type PeerCompanyInsert = InferInsertModel<typeof schema.peerCompanies>;

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
}
