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
import { lockAndReadListOwnership } from '@ipodhan/shared/services/admin-list-hold';

/** The anchor row's investor list is admin-owned or non-empty: edit it in the list editor instead. */
export class AnchorListHeldError extends Error {
  constructor(readonly ipoId: string) {
    super('the anchor investor list is edited row by row in the list editor (spec §9.2 item 8, OD-107); remove investors there, with a reason');
    this.name = 'AnchorListHeldError';
  }
}
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
      await this.deleteCache(
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
      // #1294 item 1: one transaction under the IPO row lock the list editor takes, so a totals save
      // and a list save never interleave; and the count is derived, never typed (spec row 134:
      // anchor_investors_count = len(investor_list)). While the list is admin-owned, or has entries,
      // the stored count is the list's length whatever the body says. With no list there is nothing
      // to derive from and the typed count is kept.
      const result = await this.db.transaction(async (tx) => {
        const { owned } = await lockAndReadListOwnership(tx as never, data.ipoId, 'anchor_investors');
        const [existing] = await tx
          .select()
          .from(anchorInvestors)
          .where(eq(anchorInvestors.ipoId, data.ipoId))
          .limit(1);

        // A list stored as TEXT (the W-52 shape: a JSON string in the jsonb column) is read as the list it
        // holds; one that cannot be read as a list fails closed (nothing is written, the count is not guessed).
        const storedList = readInvestorList(existing?.investorList, 'stored');
        let values: AnchorInvestorInsert;
        if (owned) {
          // Admin-owned: the body never replaces the admin's list (only the bid date and totals follow the
          // exchange, OD-106/OD-117); the count is the stored list's length.
          const { investorList: _bodyList, ...rest } = data;
          values = { ...rest, anchorInvestorsCount: storedList?.length ?? 0 };
        } else {
          const list = readInvestorList(data.investorList, 'supplied') ?? storedList;
          values = list && list.length > 0 ? { ...data, anchorInvestorsCount: list.length } : data;
        }

        if (existing) {
          const [updated] = await tx
            .update(anchorInvestors)
            .set({
              ...values,
              updatedAt: new Date(),
            })
            .where(eq(anchorInvestors.ipoId, data.ipoId))
            .returning();
          return updated;
        }
        const [inserted] = await tx
          .insert(anchorInvestors)
          .values(values)
          .returning();
        return inserted;
      });

      // Invalidate cache
      await this.deleteCache(
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
    // §9.2 item 8 (OD-107), item 28(b): deleting the anchor row deletes its investor LIST. Investors
    // are removed row by row, with a reason, through the list editor (writeAdminListChange); this
    // whole-row delete is refused while the list has investors or is admin-owned. Re-read under the
    // IPO row lock the list write takes, so an admin list save and this delete never interleave.
    let refused = false;
    try {
      await this.db.transaction(async (tx) => {
        const { owned } = await lockAndReadListOwnership(tx as never, ipoId, 'anchor_investors');
        const [row] = await tx.select({ l: anchorInvestors.investorList }).from(anchorInvestors).where(eq(anchorInvestors.ipoId, ipoId)).limit(1);
        if (owned || (Array.isArray(row?.l) && row.l.length > 0)) {
          refused = true;
          return;
        }
        await tx.delete(anchorInvestors).where(eq(anchorInvestors.ipoId, ipoId));
      });
    } catch (error) {
      throw new DatabaseError(`Failed to delete anchor investor data for IPO: ${ipoId}`, undefined, error);
    }
    if (refused) throw new AnchorListHeldError(ipoId);
    await this.deleteCache(getAnchorInvestorInvalidationKeys(ipoId));
  }
}

/**
 * The investor list as an array, whatever shape it is stored in: an array, or a JSON string holding one
 * (W-52). null/undefined = no list. Anything else throws, so a save never derives a count from a value
 * it could not read.
 */
function readInvestorList(value: unknown, which: string): unknown[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // falls through to the refusal below
    }
  }
  throw new Error(`anchor_investors: the ${which} investor list is not a list (${typeof value}); refusing to derive the count from it`);
}
