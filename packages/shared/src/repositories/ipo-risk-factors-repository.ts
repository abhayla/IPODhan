/**
 * IPO Risk Factors Repository — T-428 WP C-1.
 *
 * The numbered risk-factor list every price-band ad / prospectus prints
 * (heading + body + optional KPI table). Full-replace per IPO on write.
 *
 * Item 1 slice s6: row identity is `(ipoId, headingHash)`, not `(ipoId, seq)`.
 * `seq` is a position in the extracted array and shifts between the ad and the
 * final prospectus, so it was never a stable identity. `replaceForIpo` is the
 * ONE choke point that derives the hash, de-duplicates on it and re-derives
 * `seq` — the same shape `PeerCompanyRepository.create` uses for
 * `normalizedName` (slice s2): the insert type does not carry the key at all,
 * so no caller can reach the insert without one or write a blank one.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { ipoRiskFactors } from '../db/schema';
import { headingHashForRiskFactor } from '../utils/risk-factor-heading-key';
import type * as schema from '../db/schema';
import { CacheTTL } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
import { logger } from '../logger';

export interface IpoRiskFactorRow {
  id: string;
  ipoId: string;
  seq: number;
  heading: string;
  headingHash: string;
  body: string | null;
  kpis: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What a caller supplies. `seq` and `headingHash` are DERIVED by
 * `replaceForIpo`, never passed in — `seq` from the caller's array order, the
 * hash from the heading. A caller therefore cannot renumber identity or omit
 * the key.
 */
export type IpoRiskFactorInsert = Omit<
  IpoRiskFactorRow,
  'id' | 'createdAt' | 'updatedAt' | 'seq' | 'headingHash'
>;

/** The result of preparing a caller's list for insert. Pure — unit-testable
 * without a DB, which is where the reordering-stability guard lives. */
export interface PreparedRiskFactorRows {
  rows: (IpoRiskFactorInsert & { seq: number; headingHash: string })[];
  /** Headings dropped because they carry no content at all. */
  droppedNoHeading: number;
  /** Headings dropped because an earlier row in this batch has the same key. */
  droppedDuplicateKey: string[];
}

/**
 * Derive the row key, drop duplicates, re-derive display order.
 *
 * De-duplication is NOT optional: staging carries 7 groups of byte-identical
 * duplicate risk factors (14 surplus rows, measured 2026-09-10 — see the
 * extractor issues referenced in the PR body), so the very next extraction on
 * one of those IPOs would violate `unique_ipo_risk_factors_ipo_heading_hash`
 * mid-write without this. FIRST occurrence wins, so the row that survives is
 * the one that appeared earliest in the document — the lowest original `seq` —
 * and display order stays stable across re-extractions.
 */
export function prepareRiskFactorRows(rows: IpoRiskFactorInsert[]): PreparedRiskFactorRows {
  const prepared: PreparedRiskFactorRows = { rows: [], droppedNoHeading: 0, droppedDuplicateKey: [] };
  const seen = new Set<string>();

  for (const row of rows) {
    const headingHash = headingHashForRiskFactor(row.heading);
    if (headingHash === null) {
      prepared.droppedNoHeading += 1;
      continue;
    }
    if (seen.has(headingHash)) {
      prepared.droppedDuplicateKey.push(row.heading);
      continue;
    }
    seen.add(headingHash);
    prepared.rows.push({ ...row, headingHash, seq: prepared.rows.length + 1 });
  }

  return prepared;
}

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

  /**
   * Replace the full risk-factor list for one IPO inside ONE transaction.
   *
   * The delete and the insert MUST stay in the same transaction: if the delete
   * committed on its own and the insert then threw (a duplicate key, a too-long
   * heading), the IPO would be left showing ZERO risk factors on a live page.
   * `ipo-risk-factors-repository.test.ts` mutation-tests exactly this.
   */
  async replaceForIpo(ipoId: string, rows: IpoRiskFactorInsert[]): Promise<IpoRiskFactorRow[]> {
    const prepared = prepareRiskFactorRows(rows);

    // A dropped row is a risk factor that will NOT appear on the live page.
    // `prepareRiskFactorRows` counted them and the counts were then discarded,
    // so rows could vanish with no log line at all (Tier A review, 2026-09-10).
    // signal-ownership R1: a count is not a reading - the headings are named,
    // truncated, so the next reader can act on the line instead of re-querying.
    if (prepared.droppedDuplicateKey.length > 0 || prepared.droppedNoHeading > 0) {
      logger.warn(
        {
          ipoId,
          submitted: rows.length,
          kept: prepared.rows.length,
          droppedDuplicateKey: prepared.droppedDuplicateKey.length,
          droppedNoHeading: prepared.droppedNoHeading,
          droppedHeadings: prepared.droppedDuplicateKey.map((h) =>
            h.length > 120 ? `${h.slice(0, 120)}...` : h
          ),
        },
        'ipo_risk_factors: dropped rows before insert (duplicate heading key / no heading)'
      );
    }

    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.delete(ipoRiskFactors).where(eq(ipoRiskFactors.ipoId, ipoId));
        if (prepared.rows.length === 0) return [];
        return tx.insert(ipoRiskFactors).values(prepared.rows as never[]).returning();
      });

      await this.deleteCache(getRiskFactorsKey(ipoId));
      return result as unknown as IpoRiskFactorRow[];
    } catch (error) {
      throw new DatabaseError(`Failed to replace risk factors for IPO: ${ipoId}`, undefined, error);
    }
  }
}
