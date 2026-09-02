/**
 * IPO Risk Factors Repository — T-428 WP C-1.
 *
 * The numbered risk-factor list every price-band ad / prospectus prints
 * (heading + body + optional KPI table). Full-replace per IPO on write —
 * the seq numbering itself can shift between the ad and the final
 * prospectus, so there is no stable per-row identity to upsert against.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { ipoRiskFactors } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';

export interface IpoRiskFactorRow {
  id: string;
  ipoId: string;
  seq: number;
  heading: string;
  body: string | null;
  kpis: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export type IpoRiskFactorInsert = Omit<IpoRiskFactorRow, 'id' | 'createdAt' | 'updatedAt'>;

function getRiskFactorsKey(ipoId: string): string {
  return `ipo-risk-factors:ipo:${ipoId}`;
}

export class IpoRiskFactorsRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  async listByIpo(ipoId: string): Promise<IpoRiskFactorRow[]> {
    const cacheKey = getRiskFactorsKey(ipoId);
    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const rows = await this.db
            .select()
            .from(ipoRiskFactors)
            .where(eq(ipoRiskFactors.ipoId, ipoId))
            .orderBy(ipoRiskFactors.seq);
          return rows as unknown as IpoRiskFactorRow[];
        } catch (error) {
          throw new DatabaseError(
            `Failed to list risk factors for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.FILING_SCHEMA
    );
  }

  /** Replace the full risk-factor list for one IPO inside a transaction. */
  async replaceForIpo(ipoId: string, rows: IpoRiskFactorInsert[]): Promise<IpoRiskFactorRow[]> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.delete(ipoRiskFactors).where(eq(ipoRiskFactors.ipoId, ipoId));
        if (rows.length === 0) return [];
        return tx.insert(ipoRiskFactors).values(rows as never[]).returning();
      });

      await this.deleteCache(getRiskFactorsKey(ipoId));
      return result as unknown as IpoRiskFactorRow[];
    } catch (error) {
      throw new DatabaseError(`Failed to replace risk factors for IPO: ${ipoId}`, undefined, error);
    }
  }
}
