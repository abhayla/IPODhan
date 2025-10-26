/**
 * Anchor Investor Repository
 *
 * Story 11.10: Implement Anchor Investors Details Section
 * Handles anchor investor data access with caching.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { anchorInvestors } from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import {
  CacheTTL,
  getAnchorInvestorKey,
  getAnchorInvestorInvalidationKeys,
} from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Type definitions
export type AnchorInvestor = InferSelectModel<typeof schema.anchorInvestors>;
export type AnchorInvestorInsert = InferInsertModel<typeof schema.anchorInvestors>;

export interface IAnchorInvestorRepository {
  findByIPOId(ipoId: string): Promise<AnchorInvestor | null>;
  create(data: AnchorInvestorInsert): Promise<AnchorInvestor>;
  upsert(data: AnchorInvestorInsert): Promise<AnchorInvestor>;
  delete(ipoId: string): Promise<void>;
}

export class AnchorInvestorRepository
  extends BaseRepository
  implements IAnchorInvestorRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find anchor investor data for an IPO
   */
  async findByIPOId(ipoId: string): Promise<AnchorInvestor | null> {
    const cacheKey = getAnchorInvestorKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [data] = await this.db
            .select()
            .from(anchorInvestors)
            .where(eq(anchorInvestors.ipoId, ipoId))
            .limit(1);

          return data || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch anchor investor data for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.ANCHOR_INVESTOR
    );
  }

  /**
   * Create anchor investor data for an IPO
   */
  async create(data: AnchorInvestorInsert): Promise<AnchorInvestor> {
    try {
      const [result] = await this.db
        .insert(anchorInvestors)
        .values(data)
        .returning();

      // Invalidate cache
      await this.deleteCachePattern(
        getAnchorInvestorInvalidationKeys(data.ipoId)
      );

      return result;
    } catch (error) {
      throw new DatabaseError(
        'Failed to create anchor investor data',
        undefined,
        error
      );
    }
  }

  /**
   * Create or update anchor investor data for an IPO
   */
  async upsert(data: AnchorInvestorInsert): Promise<AnchorInvestor> {
    try {
      const [result] = await this.db
        .insert(anchorInvestors)
        .values(data)
        .onConflictDoUpdate({
          target: anchorInvestors.ipoId,
          set: {
            ...data,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Invalidate cache
      await this.deleteCachePattern(
        getAnchorInvestorInvalidationKeys(data.ipoId)
      );

      return result;
    } catch (error) {
      throw new DatabaseError(
        'Failed to upsert anchor investor data',
        undefined,
        error
      );
    }
  }

  /**
   * Delete anchor investor data for an IPO
   */
  async delete(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(anchorInvestors)
        .where(eq(anchorInvestors.ipoId, ipoId));

      // Invalidate cache
      await this.deleteCachePattern(getAnchorInvestorInvalidationKeys(ipoId));
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete anchor investor data for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
