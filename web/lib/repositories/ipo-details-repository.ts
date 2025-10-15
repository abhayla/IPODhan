/**
 * IPO Details Repository (Story 4.11)
 *
 * Handles IPO details data access including issue structure (Fresh Issue vs OFS),
 * issue type, minimum investment, cut-off price, and registrar links.
 * Implements caching for frequently accessed details.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { ipoDetails } from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import { CacheTTL, getIpoDetailsKey } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
import type {
  IpoDetails,
  IpoDetailsInsert,
  IIpoDetailsRepository,
} from './types';

export class IpoDetailsRepository
  extends BaseRepository
  implements IIpoDetailsRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find IPO details for an IPO
   */
  async findByIPO(ipoId: string): Promise<IpoDetails | null> {
    const cacheKey = getIpoDetailsKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [data] = await this.db
            .select()
            .from(ipoDetails)
            .where(eq(ipoDetails.ipoId, ipoId))
            .limit(1);

          return data || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch IPO details for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.IPO_DETAILS
    );
  }

  /**
   * Create or update IPO details for an IPO
   */
  async upsert(data: IpoDetailsInsert): Promise<IpoDetails> {
    try {
      const [result] = await this.db
        .insert(ipoDetails)
        .values(data)
        .onConflictDoUpdate({
          target: ipoDetails.ipoId,
          set: {
            ...data,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Invalidate cache
      await this.deleteCache(getIpoDetailsKey(data.ipoId));

      return result;
    } catch (error) {
      throw new DatabaseError(
        'Failed to upsert IPO details',
        undefined,
        error
      );
    }
  }

  /**
   * Delete IPO details for an IPO
   */
  async delete(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(ipoDetails)
        .where(eq(ipoDetails.ipoId, ipoId));

      // Invalidate cache
      await this.deleteCache(getIpoDetailsKey(ipoId));
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete IPO details for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
