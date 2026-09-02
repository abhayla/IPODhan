/**
 * Financial Statements Repository — T-428 WP C-1.
 *
 * Per-fiscal-year financial statements read off the price-band ad / RHP /
 * Prospectus (docs/reviews/price-band-ad-field-inventory.md). One row per
 * (ipoId, fiscalYear, basis) — a company reports both RESTATED and STANDALONE
 * figures for the same year in some filings, so the unique key carries all
 * three. Nothing writes here yet — WP C-2/C-3 wire the extractor and the
 * persistence path behind ENABLE_FILING_EXTRACTION.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { financialStatements } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';

export type FinancialStatementBasis = 'RESTATED' | 'STANDALONE';
export type FinancialUnit = 'MILLION' | 'LAKH' | 'CRORE';

export interface FinancialStatementRow {
  id: string;
  ipoId: string;
  fiscalYear: number;
  basis: FinancialStatementBasis;
  unit: FinancialUnit;
  revenue: string | null;
  totalIncome: string | null;
  ebitda: string | null;
  pat: string | null;
  netWorth: string | null;
  epsBasic: string | null;
  epsDiluted: string | null;
  opCashFlow: string | null;
  dscr: string | null;
  rentExpense: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FinancialStatementUpsert = Omit<
  FinancialStatementRow,
  'id' | 'createdAt' | 'updatedAt'
>;

function getFinancialStatementsKey(ipoId: string): string {
  return `financial-statements:ipo:${ipoId}`;
}

export class FinancialStatementsRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  async listByIpo(ipoId: string): Promise<FinancialStatementRow[]> {
    const cacheKey = getFinancialStatementsKey(ipoId);
    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const rows = await this.db
            .select()
            .from(financialStatements)
            .where(eq(financialStatements.ipoId, ipoId));
          return rows as unknown as FinancialStatementRow[];
        } catch (error) {
          throw new DatabaseError(
            `Failed to list financial statements for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.FILING_SCHEMA
    );
  }

  /**
   * Upsert on the (ipoId, fiscalYear, basis) unique key — a later filing
   * (e.g. Prospectus superseding a Price Band Ad) overwrites the earlier row
   * for the same year+basis rather than accumulating duplicates.
   */
  async upsert(row: FinancialStatementUpsert): Promise<FinancialStatementRow> {
    try {
      const [result] = await this.db
        .insert(financialStatements)
        .values(row as never)
        .onConflictDoUpdate({
          target: [
            financialStatements.ipoId,
            financialStatements.fiscalYear,
            financialStatements.basis,
          ],
          set: { ...(row as Record<string, unknown>), updatedAt: new Date() } as never,
        })
        .returning();

      await this.deleteCache(getFinancialStatementsKey(row.ipoId));
      return result as unknown as FinancialStatementRow;
    } catch (error) {
      throw new DatabaseError('Failed to upsert financial statement', undefined, error);
    }
  }
}
