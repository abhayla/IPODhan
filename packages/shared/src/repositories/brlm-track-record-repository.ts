/**
 * BRLM Track Record Repository — T-428 WP C-1.
 *
 * "3-year issues managed / closed below issue price" table every price-band
 * ad prints for each BRLM. The same BRLM's track record repeats verbatim
 * across many ads (it's a fact about the BRLM, not the issuer), so this is
 * keyed by (brlmName, asOfDate) rather than per-IPO — `sourceIpoId` is
 * provenance (which filing this row was read off of), not an identity key.
 */

import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { brlmTrackRecord } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';

export interface BrlmTrackRecordRow {
  id: string;
  brlmName: string;
  asOfDate: string;
  issues3y: number | null;
  closedBelowIssuePrice: number | null;
  sourceIpoId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type BrlmTrackRecordInsert = Omit<BrlmTrackRecordRow, 'id' | 'createdAt' | 'updatedAt'>;

function getBrlmTrackRecordKey(brlmName: string): string {
  return `brlm-track-record:name:${brlmName}`;
}

export class BrlmTrackRecordRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  async listByBrlmName(brlmName: string): Promise<BrlmTrackRecordRow[]> {
    const cacheKey = getBrlmTrackRecordKey(brlmName);
    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const rows = await this.db
            .select()
            .from(brlmTrackRecord)
            .where(eq(brlmTrackRecord.brlmName, brlmName));
          return rows as unknown as BrlmTrackRecordRow[];
        } catch (error) {
          throw new DatabaseError(
            `Failed to list BRLM track record for: ${brlmName}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.FILING_SCHEMA
    );
  }

  async listBySourceIpo(sourceIpoId: string): Promise<BrlmTrackRecordRow[]> {
    try {
      const rows = await this.db
        .select()
        .from(brlmTrackRecord)
        .where(eq(brlmTrackRecord.sourceIpoId, sourceIpoId));
      return rows as unknown as BrlmTrackRecordRow[];
    } catch (error) {
      throw new DatabaseError(
        `Failed to list BRLM track record for source IPO: ${sourceIpoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Insert-if-absent on (brlmName, asOfDate) — there is no DB unique
   * constraint on that pair (a BRLM can legitimately have its track record
   * re-read from multiple ads on the same as-of date with the same figures),
   * so this checks-then-inserts rather than relying on onConflictDoUpdate.
   */
  async upsert(row: BrlmTrackRecordInsert): Promise<BrlmTrackRecordRow> {
    try {
      const [existing] = await this.db
        .select()
        .from(brlmTrackRecord)
        .where(
          and(eq(brlmTrackRecord.brlmName, row.brlmName), eq(brlmTrackRecord.asOfDate, row.asOfDate))
        )
        .limit(1);

      let result: unknown;
      if (existing) {
        [result] = await this.db
          .update(brlmTrackRecord)
          .set({ ...(row as Record<string, unknown>), updatedAt: new Date() } as never)
          .where(eq(brlmTrackRecord.id, (existing as { id: string }).id))
          .returning();
      } else {
        [result] = await this.db.insert(brlmTrackRecord).values(row as never).returning();
      }

      await this.deleteCache(getBrlmTrackRecordKey(row.brlmName));
      return result as BrlmTrackRecordRow;
    } catch (error) {
      throw new DatabaseError('Failed to upsert BRLM track record', undefined, error);
    }
  }
}
