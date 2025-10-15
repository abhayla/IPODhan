/**
 * IPO Financials Repository (Story 4.10)
 *
 * Handles enhanced financial data access with P/B Ratio, ROCE, Industry P/E, and peer companies.
 * Implements caching for frequently accessed financial metrics.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { ipoFinancials } from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import { CacheTTL, getIpoFinancialsKey } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
import type {
  IpoFinancials,
  IpoFinancialsInsert,
  IIpoFinancialsRepository,
} from './types';

export class IpoFinancialsRepository
  extends BaseRepository
  implements IIpoFinancialsRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find enhanced financial data for an IPO
   */
  async findByIPO(ipoId: string): Promise<IpoFinancials | null> {
    const cacheKey = getIpoFinancialsKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [data] = await this.db
            .select()
            .from(ipoFinancials)
            .where(eq(ipoFinancials.ipoId, ipoId))
            .limit(1);

          return data || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch IPO financials for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.IPO_FINANCIALS
    );
  }

  /**
   * Create or update enhanced financial data for an IPO
   */
  async upsert(data: IpoFinancialsInsert): Promise<IpoFinancials> {
    try {
      const [result] = await this.db
        .insert(ipoFinancials)
        .values(data)
        .onConflictDoUpdate({
          target: ipoFinancials.ipoId,
          set: {
            ...data,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Invalidate cache
      await this.deleteCache(getIpoFinancialsKey(data.ipoId));

      return result;
    } catch (error) {
      throw new DatabaseError(
        'Failed to upsert IPO financials',
        undefined,
        error
      );
    }
  }

  /**
   * Delete enhanced financial data for an IPO
   */
  async delete(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(ipoFinancials)
        .where(eq(ipoFinancials.ipoId, ipoId));

      // Invalidate cache
      await this.deleteCache(getIpoFinancialsKey(ipoId));
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete IPO financials for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
