/**
 * Anchor Investor Repository
 *
 * Data access layer for anchor_investors table
 *
 * @module repositories/anchor-investor-repository
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, type InferInsertModel } from 'drizzle-orm';
import { logger } from '../utils/logger';

type AnchorInvestorsInsert = InferInsertModel<typeof schema.anchorInvestors>;

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
      // The domain `NewAnchorInvestor` shape (Date objects, a JSON-stringified
      // `investorList`) has always matched what callers pass and what
      // node-postgres's driver accepts for these `date`/`jsonb` columns at
      // runtime; drizzle's own inferred insert type is narrower (string-mode
      // dates, IndividualInvestor[]) and only surfaces once this file is
      // type-checked at all (#434). No behaviour change — same object, same
      // runtime call.
      const [anchorInvestor] = await this.db
        .insert(schema.anchorInvestors)
        .values(data as unknown as AnchorInvestorsInsert)
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
      // Same domain-vs-drizzle-inferred shape gap as .create() above.
      const [updated] = await this.db
        .update(schema.anchorInvestors)
        .set({
          ...data,
          updatedAt: new Date()
        } as unknown as Partial<AnchorInvestorsInsert>)
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
