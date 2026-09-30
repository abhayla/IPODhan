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
import { lockAndReadListOwnership, recordListSuggestion, listRowKey } from '../services/admin-list-hold';

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
  async upsert(row: FinancialStatementUpsert, source = 'DRHP'): Promise<FinancialStatementRow | null> {
    try {
      const [result] = await this.db.transaction(async (tx) => {
        // §9.2 item 8 (OD-107): the admin owns the whole list of years. A row the admin's list lacks
        // becomes a suggestion (the admin's list plus this row); a year the admin has with DIFFERENT
        // values becomes a suggestion too (the admin's list with this year replaced). Nothing is written.
        const { owned } = await lockAndReadListOwnership(tx as never, row.ipoId, 'financial_statements');
        if (owned) {
          const stored = await tx.select().from(financialStatements).where(eq(financialStatements.ipoId, row.ipoId));
          const k = listRowKey('financial_statements', row as never);
          const same = stored.find((s) => listRowKey('financial_statements', s as never) === k);
          const incoming = same
            ? stored.map((s) => (s === same ? { ...s, ...(row as Record<string, unknown>) } : s))
            : [...stored, row];
          await recordListSuggestion(tx as never, { ipoId: row.ipoId, list: 'financial_statements', source, stored, incoming: incoming as never });
          // What is STORED, never the incoming row (which has no id): the admin's row for this year, or
          // nothing when the admin's list lacks the year (#1294 item 6).
          return [(same ?? null) as never];
        }
        return tx
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
      });

      await this.deleteCache(getFinancialStatementsKey(row.ipoId));
      return (result ?? null) as unknown as FinancialStatementRow | null;
    } catch (error) {
      throw new DatabaseError('Failed to upsert financial statement', undefined, error);
    }
  }
}
