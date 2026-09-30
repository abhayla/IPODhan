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
import { lockAndReadListOwnership, recordListSuggestion } from '@ipodhan/shared/services/admin-list-hold';

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
/**
 * The source label a suggestion raised by an anchor write carries (#1294 item 3). A caller that does
 * not name its source gets the document label every filing writes under, never a guessed exchange.
 */
export const DEFAULT_ANCHOR_WRITER = 'DRHP';
export interface AnchorWriteOptions {
  /** The scraper_source label of the writer: 'NSE' for the exchange anchor job, 'DRHP' for a document. */
  writer?: string;
}

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
  /**
   * §9.2 item 8 (OD-107), OD-117: inside the write's transaction, when the admin owns this IPO's
   * investor list, drop `investorList` and `anchorInvestorsCount` from the patch and record the
   * writer's list as a suggestion. The bid date and totals still follow the exchange (OD-106/OD-117).
   */
  private async dropOwnedList(tx: NodePgDatabase<typeof schema>, ipoId: string, data: Partial<NewAnchorInvestor>, writer: string): Promise<Partial<NewAnchorInvestor>> {
    if (data.investorList === undefined && data.anchorInvestorsCount === undefined) return data;
    if (!(await lockAndReadListOwnership(tx as never, ipoId, 'anchor_investors')).owned) return data;
    const { investorList, anchorInvestorsCount: _count, ...rest } = data;
    if (investorList !== undefined) {
      const [row] = await tx.select({ l: schema.anchorInvestors.investorList }).from(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, ipoId)).limit(1);
      const incoming = typeof investorList === 'string' ? JSON.parse(investorList) : investorList;
      await recordListSuggestion(tx as never, {
        ipoId,
        list: 'anchor_investors',
        source: writer,
        stored: ((row?.l ?? []) as unknown as Record<string, unknown>[]),
        incoming: Array.isArray(incoming) ? incoming : [],
      });
    }
    logger.info({ ipoId }, '[item 8] admin-owned anchor investor list kept; writer list recorded as a suggestion');
    return rest;
  }

  async create(data: NewAnchorInvestor, opts: AnchorWriteOptions = {}) {
    try {
      // The domain `NewAnchorInvestor` shape (Date objects, a JSON-stringified
      // `investorList`) has always matched what callers pass and what
      // node-postgres's driver accepts for these `date`/`jsonb` columns at
      // runtime; drizzle's own inferred insert type is narrower (string-mode
      // dates, IndividualInvestor[]) and only surfaces once this file is
      // type-checked at all (#434). No behaviour change — same object, same
      // runtime call.
      const [anchorInvestor] = await this.db.transaction(async (tx) => {
        const kept = await this.dropOwnedList(tx as never, data.ipoId, data, opts.writer ?? DEFAULT_ANCHOR_WRITER);
        if (kept !== data) {
          const [existing] = await tx.select().from(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, data.ipoId)).limit(1);
          if (existing) return [existing];
        }
        return tx.insert(schema.anchorInvestors).values(data as unknown as AnchorInvestorsInsert).returning();
      });

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
  async update(id: string, data: Partial<NewAnchorInvestor>, opts: AnchorWriteOptions = {}) {
    try {
      // Same domain-vs-drizzle-inferred shape gap as .create() above.
      const [updated] = await this.db.transaction(async (tx) => {
        const [cur] = await tx.select({ ipoId: schema.anchorInvestors.ipoId }).from(schema.anchorInvestors).where(eq(schema.anchorInvestors.id, id)).limit(1);
        const kept = cur ? await this.dropOwnedList(tx as never, cur.ipoId, data, opts.writer ?? DEFAULT_ANCHOR_WRITER) : data;
        return tx
          .update(schema.anchorInvestors)
          .set({
            ...kept,
            updatedAt: new Date()
          } as unknown as Partial<AnchorInvestorsInsert>)
          .where(eq(schema.anchorInvestors.id, id))
          .returning();
      });

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
      const deleted = await this.db.transaction(async (tx) => {
        // §9.2 item 8: an admin-owned investor list is never deleted by a writer.
        if ((await lockAndReadListOwnership(tx as never, ipoId, 'anchor_investors')).owned) return false;
        await tx.delete(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, ipoId));
        return true;
      });
      if (!deleted) {
        logger.info({ ipoId }, '[item 8] admin-owned anchor investor list: delete skipped');
        return;
      }

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
