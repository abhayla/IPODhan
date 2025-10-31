/**
 * Anchor Investor Repository
 *
 * Data access layer for anchor_investors table
 *
 * @module repositories/anchor-investor-repository
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

/**
 * Data structure for creating anchor investor record
 */
export interface NewAnchorInvestor {
  ipoId: string;
  bidDate: Date | null;
  totalSharesOffered: number;
  totalAmountRaised: number;
  anchorInvestorsCount: number;
  lockIn50PercentDate: Date | null;
  lockInRemainingDate: Date | null;
  investorList: string; // JSON stringified array
}

/**
 * Repository for anchor_investors table operations
 */
export class AnchorInvestorRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Find anchor investor record by IPO ID
   */
  async findByIPOId(ipoId: string) {
    try {
      const results = await this.db
        .select()
        .from(schema.anchorInvestors)
        .where(eq(schema.anchorInvestors.ipoId, ipoId))
        .limit(1);

      return results[0] || null;
    } catch (error) {
      logger.error('[AnchorInvestorRepository] Error in findByIPOId:', error);
      throw error;
    }
  }

  /**
   * Create new anchor investor record
   */
  async create(data: NewAnchorInvestor) {
    try {
      const [anchorInvestor] = await this.db
        .insert(schema.anchorInvestors)
        .values(data)
        .returning();

      logger.info(`[AnchorInvestorRepository] Created anchor investor record for IPO ${data.ipoId}`);
      return anchorInvestor;
    } catch (error) {
      logger.error('[AnchorInvestorRepository] Error in create:', error);
      throw error;
    }
  }

  /**
   * Update existing anchor investor record
   */
  async update(id: string, data: Partial<NewAnchorInvestor>) {
    try {
      const [updated] = await this.db
        .update(schema.anchorInvestors)
        .set({
          ...data,
          updatedAt: new Date()
        })
        .where(eq(schema.anchorInvestors.id, id))
        .returning();

      logger.info(`[AnchorInvestorRepository] Updated anchor investor record ${id}`);
      return updated;
    } catch (error) {
      logger.error('[AnchorInvestorRepository] Error in update:', error);
      throw error;
    }
  }

  /**
   * Delete anchor investor record by IPO ID
   */
  async deleteByIPOId(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(schema.anchorInvestors)
        .where(eq(schema.anchorInvestors.ipoId, ipoId));

      logger.info(`[AnchorInvestorRepository] Deleted anchor investors for IPO ${ipoId}`);
    } catch (error) {
      logger.error('[AnchorInvestorRepository] Error in deleteByIPOId:', error);
      throw error;
    }
  }

  /**
   * Count total anchor investor records
   */
  async count(): Promise<number> {
    try {
      const result = await this.db
        .select({ count: schema.anchorInvestors.id })
        .from(schema.anchorInvestors);

      return result.length;
    } catch (error) {
      logger.error('[AnchorInvestorRepository] Error in count:', error);
      throw error;
    }
  }
}
