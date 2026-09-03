/**
 * IPO Valuation Repository — T-428 WP C-1.
 *
 * One row per pricing event (PRICE_BAND_AD, PROSPECTUS) — the price-band ad
 * publishes valuation at the floor AND cap, and the final prospectus can
 * differ, so each event gets its own row rather than overwriting in place.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { ipoValuation } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';

export type PricingEvent = 'PRICE_BAND_AD' | 'PROSPECTUS';

export interface IpoValuationRow {
  id: string;
  ipoId: string;
  pricingEvent: PricingEvent;
  priceFloor: string | null;
  priceCap: string | null;
  sharesAtFloor: string | null;
  sharesAtCap: string | null;
  freshSharesAtFloor: string | null;
  freshSharesAtCap: string | null;
  ofsShares: string | null;
  totalSharesAtFloor: string | null;
  totalSharesAtCap: string | null;
  mcapAtFloor: string | null;
  mcapAtCap: string | null;
  peAtFloor: string | null;
  peAtCap: string | null;
  peNotAscertainableReason: string | null;
  ronwWeighted3y: string | null;
  faceValueMultipleFloor: string | null;
  faceValueMultipleCap: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IpoValuationUpsert = Omit<IpoValuationRow, 'id' | 'createdAt' | 'updatedAt'>;

function getIpoValuationKey(ipoId: string): string {
  return `ipo-valuation:ipo:${ipoId}`;
}

export class IpoValuationRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  async listByIpo(ipoId: string): Promise<IpoValuationRow[]> {
    const cacheKey = getIpoValuationKey(ipoId);
    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const rows = await this.db
            .select()
            .from(ipoValuation)
            .where(eq(ipoValuation.ipoId, ipoId));
          return rows as unknown as IpoValuationRow[];
        } catch (error) {
          throw new DatabaseError(
            `Failed to list valuation rows for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.FILING_SCHEMA
    );
  }

  /** Upsert on the (ipoId, pricingEvent) unique key. */
  async upsert(row: IpoValuationUpsert): Promise<IpoValuationRow> {
    try {
      const [result] = await this.db
        .insert(ipoValuation)
        .values(row as never)
        .onConflictDoUpdate({
          target: [ipoValuation.ipoId, ipoValuation.pricingEvent],
          set: { ...(row as Record<string, unknown>), updatedAt: new Date() } as never,
        })
        .returning();

      await this.deleteCache(getIpoValuationKey(row.ipoId));
      return result as unknown as IpoValuationRow;
    } catch (error) {
      throw new DatabaseError('Failed to upsert IPO valuation row', undefined, error);
    }
  }
}
