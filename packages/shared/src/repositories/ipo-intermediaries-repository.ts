/**
 * IPO Intermediaries Repository — T-428 WP C-1.
 *
 * Replaces the free-text `ipos.leadManagers` / `ipo_details.sponsorBanks`
 * arrays with a proper per-role table (BRLM, REGISTRAR, SYNDICATE,
 * SPONSOR_BANK, ESCROW_BANK, PUBLIC_ISSUE_BANK) carrying contact details the
 * price-band ad prints (SEBI reg no, grievance email, etc).
 *
 * Full-replace per IPO on write, same reasoning as PromotersRepository: the
 * intermediary list has no natural per-row key stable across filings.
 */

import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { ipoIntermediaries } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';

export type IntermediaryRole =
  | 'BRLM'
  | 'REGISTRAR'
  | 'SYNDICATE'
  | 'SPONSOR_BANK'
  | 'ESCROW_BANK'
  | 'PUBLIC_ISSUE_BANK';

export interface IpoIntermediaryRow {
  id: string;
  ipoId: string;
  role: IntermediaryRole;
  name: string;
  sebiRegNo: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  grievanceEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IpoIntermediaryInsert = Omit<IpoIntermediaryRow, 'id' | 'createdAt' | 'updatedAt'>;

function getIntermediariesKey(ipoId: string): string {
  return `ipo-intermediaries:ipo:${ipoId}`;
}

export class IpoIntermediariesRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  async listByIpo(ipoId: string): Promise<IpoIntermediaryRow[]> {
    const cacheKey = getIntermediariesKey(ipoId);
    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const rows = await this.db
            .select()
            .from(ipoIntermediaries)
            .where(eq(ipoIntermediaries.ipoId, ipoId));
          return rows as unknown as IpoIntermediaryRow[];
        } catch (error) {
          throw new DatabaseError(
            `Failed to list intermediaries for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.FILING_SCHEMA
    );
  }

  async listByIpoAndRole(ipoId: string, role: IntermediaryRole): Promise<IpoIntermediaryRow[]> {
    try {
      const rows = await this.db
        .select()
        .from(ipoIntermediaries)
        .where(and(eq(ipoIntermediaries.ipoId, ipoId), eq(ipoIntermediaries.role, role)));
      return rows as unknown as IpoIntermediaryRow[];
    } catch (error) {
      throw new DatabaseError(
        `Failed to list ${role} intermediaries for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /** Replace the full intermediary list for one IPO inside a transaction. */
  async replaceForIpo(
    ipoId: string,
    rows: IpoIntermediaryInsert[]
  ): Promise<IpoIntermediaryRow[]> {
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.delete(ipoIntermediaries).where(eq(ipoIntermediaries.ipoId, ipoId));
        if (rows.length === 0) return [];
        return tx.insert(ipoIntermediaries).values(rows as never[]).returning();
      });

      await this.deleteCache(getIntermediariesKey(ipoId));
      return result as unknown as IpoIntermediaryRow[];
    } catch (error) {
      throw new DatabaseError(
        `Failed to replace intermediaries for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
