/**
 * Peer Company Repository
 *
 * Handles peer company comparison data access.
 * Implements caching for peer company listings.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { peerCompanies } from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';

export interface PeerCompany {
  id: string;
  ipoId: string;
  companyName: string;
  sector: string | null;
  isListed: boolean;
  peRatio: string | null;
  eps: string | null;
  dilutedEps: string | null;
  ronw: string | null;
  nav: string | null;
  pbvRatio: string | null;
  financialStatementType: 'CONSOLIDATED' | 'STANDALONE' | null;
  dataSource: string | null;
  lastUpdated: Date | null;
  createdAt: Date;
}

export interface PeerCompanyInsert {
  ipoId: string;
  companyName: string;
  sector?: string;
  isListed: boolean;
  peRatio?: string;
  eps?: string;
  dilutedEps?: string;
  ronw?: string;
  nav?: string;
  pbvRatio?: string;
  financialStatementType?: 'CONSOLIDATED' | 'STANDALONE';
  dataSource?: string;
  lastUpdated?: Date;
}

export class PeerCompanyRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Generate cache key for peer companies
   */
  private getPeerCompaniesKey(ipoId: string): string {
    return `peers:${ipoId}`;
  }

  /**
   * Find all peer companies for an IPO
   */
  async findByIPO(ipoId: string): Promise<PeerCompany[]> {
    const cacheKey = this.getPeerCompaniesKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const results = await this.db
            .select()
            .from(peerCompanies)
            .where(eq(peerCompanies.ipoId, ipoId));

          return results;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch peer companies for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.REFERENCE // 7 days - peer data rarely changes
    );
  }

  /**
   * Create a new peer company record
   */
  async create(data: PeerCompanyInsert): Promise<PeerCompany> {
    try {
      const [peerCompany] = await this.db
        .insert(peerCompanies)
        .values(data)
        .returning();

      // Invalidate cache
      await this.deleteCache(this.getPeerCompaniesKey(data.ipoId));

      return peerCompany;
    } catch (error) {
      throw new DatabaseError(
        'Failed to create peer company',
        undefined,
        error
      );
    }
  }

  /**
   * Delete all peer companies for an IPO
   */
  async deleteByIPO(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(peerCompanies)
        .where(eq(peerCompanies.ipoId, ipoId));

      // Invalidate cache
      await this.deleteCache(this.getPeerCompaniesKey(ipoId));
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete peer companies for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Batch upsert peer companies
   * Returns success and failure counts
   */
  async upsertPeers(
    peers: PeerCompanyInsert[]
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const peer of peers) {
      try {
        await this.create(peer);
        success++;
      } catch (error) {
        failed++;
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        errors.push(`${peer.companyName}: ${errorMsg}`);
      }
    }

    return { success, failed, errors };
  }
}
