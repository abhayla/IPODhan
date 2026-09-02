/**
 * Promoters Repository — T-428 WP C-1.
 *
 * Covers both `promoters` (per-promoter shareholding/WACA) and
 * `promoter_acquisition_ranges` (the 1Y/18M/3Y acquisition-cost-range table
 * every price-band ad prints) — one caller reads/writes both together, so
 * they share a repository rather than splitting into two files with no
 * independent consumer (YAGNI).
 *
 * Both tables are FULL-REPLACE per IPO on write, not per-row upsert: a
 * promoter list has no natural per-row unique key across filings (a promoter
 * can be renamed, added, or dropped between the ad and the prospectus), so
 * "the current promoter list for this IPO" is the row set as of the latest
 * write, and replacing it atomically is simpler and safer than diffing.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { promoters, promoterAcquisitionRanges } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';

export interface PromoterRow {
  id: string;
  ipoId: string;
  name: string;
  sharesHeld: number | null;
  waca: string | null;
  wacaLastYear: string | null;
  isPromoterGroup: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PromoterInsert = Omit<PromoterRow, 'id' | 'createdAt' | 'updatedAt'>;

export type AcquisitionPeriod = '1Y' | '18M' | '3Y';

export interface PromoterAcquisitionRangeRow {
  id: string;
  ipoId: string;
  period: AcquisitionPeriod;
  waca: string | null;
  capMultiple: string | null;
  priceLow: string | null;
  priceHigh: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PromoterAcquisitionRangeInsert = Omit<
  PromoterAcquisitionRangeRow,
  'id' | 'createdAt' | 'updatedAt'
>;

function getPromotersKey(ipoId: string): string {
  return `promoters:ipo:${ipoId}`;
}

function getPromoterAcquisitionRangesKey(ipoId: string): string {
  return `promoter-acquisition-ranges:ipo:${ipoId}`;
}

export class PromotersRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  async listPromotersByIpo(ipoId: string): Promise<PromoterRow[]> {
    const cacheKey = getPromotersKey(ipoId);
    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const rows = await this.db.select().from(promoters).where(eq(promoters.ipoId, ipoId));
          return rows as unknown as PromoterRow[];
        } catch (error) {
          throw new DatabaseError(`Failed to list promoters for IPO: ${ipoId}`, undefined, error);
        }
      },
      CacheTTL.FILING_SCHEMA
    );
  }

  /** Replace the full promoter list for one IPO inside a transaction. */
  async replacePromoters(ipoId: string, rows: PromoterInsert[]): Promise<PromoterRow[]> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.delete(promoters).where(eq(promoters.ipoId, ipoId));
        if (rows.length === 0) return [];
        return tx.insert(promoters).values(rows as never[]).returning();
      });

      await this.deleteCache(getPromotersKey(ipoId));
      return result as unknown as PromoterRow[];
    } catch (error) {
      throw new DatabaseError(`Failed to replace promoters for IPO: ${ipoId}`, undefined, error);
    }
  }

  async listAcquisitionRangesByIpo(ipoId: string): Promise<PromoterAcquisitionRangeRow[]> {
    const cacheKey = getPromoterAcquisitionRangesKey(ipoId);
    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const rows = await this.db
            .select()
            .from(promoterAcquisitionRanges)
            .where(eq(promoterAcquisitionRanges.ipoId, ipoId));
          return rows as unknown as PromoterAcquisitionRangeRow[];
        } catch (error) {
          throw new DatabaseError(
            `Failed to list promoter acquisition ranges for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.FILING_SCHEMA
    );
  }

  /** Replace the full acquisition-range set (max 3 rows: 1Y/18M/3Y) for one IPO. */
  async replaceAcquisitionRanges(
    ipoId: string,
    rows: PromoterAcquisitionRangeInsert[]
  ): Promise<PromoterAcquisitionRangeRow[]> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.delete(promoterAcquisitionRanges).where(eq(promoterAcquisitionRanges.ipoId, ipoId));
        if (rows.length === 0) return [];
        return tx.insert(promoterAcquisitionRanges).values(rows as never[]).returning();
      });

      await this.deleteCache(getPromoterAcquisitionRangesKey(ipoId));
      return result as unknown as PromoterAcquisitionRangeRow[];
    } catch (error) {
      throw new DatabaseError(
        `Failed to replace promoter acquisition ranges for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
