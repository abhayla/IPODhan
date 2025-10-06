/**
 * Financial Data Repository
 *
 * Handles financial data access with upsert operations.
 * Implements caching for frequently accessed financial metrics.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { financialData } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL, getFinancialDataKey } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
import type {
  FinancialData,
  FinancialDataInsert,
  IFinancialDataRepository,
} from './types';

export class FinancialDataRepository
  extends BaseRepository
  implements IFinancialDataRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find financial data for an IPO
   */
  async findByIPO(ipoId: string): Promise<FinancialData | null> {
    const cacheKey = getFinancialDataKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [data] = await this.db
            .select()
            .from(financialData)
            .where(eq(financialData.ipoId, ipoId))
            .limit(1);

          return data || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch financial data for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.FINANCIAL_DATA
    );
  }

  /**
   * Create or update financial data for an IPO
   */
  async upsert(data: FinancialDataInsert): Promise<FinancialData> {
    try {
      const [result] = await this.db
        .insert(financialData)
        .values(data)
        .onConflictDoUpdate({
          target: financialData.ipoId,
          set: data,
        })
        .returning();

      // Invalidate cache
      await this.deleteCache(getFinancialDataKey(data.ipoId));

      return result;
    } catch (error) {
      throw new DatabaseError(
        'Failed to upsert financial data',
        undefined,
        error
      );
    }
  }

  /**
   * Delete financial data for an IPO
   */
  async delete(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(financialData)
        .where(eq(financialData.ipoId, ipoId));

      // Invalidate cache
      await this.deleteCache(getFinancialDataKey(ipoId));
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete financial data for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
