/**
 * Data Conflicts Repository
 * Data access layer for conflict detection and resolution
 * Logs conflicts between different scraper sources for admin review
 */

import { eq, and, isNull, isNotNull, lt, desc, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { dataConflicts } from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';

export interface DataConflictRecord {
  id: string;
  ipoId: string;
  tableName: string;
  fieldName: string;
  source1: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  value1: string | null;
  source2: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  value2: string | null;
  resolvedSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH' | null;
  resolutionReason: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  adminNote: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  detectedAt: Date;
  createdAt: Date;
}

export interface LogConflictInput {
  ipoId: string;
  tableName: string;
  fieldName: string;
  source1: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  value1: string | null;
  source2: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  value2: string | null;
  resolvedSource?: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  resolutionReason?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface ResolveConflictInput {
  resolvedSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  resolutionReason: string;
  resolvedBy: string;
  adminNote?: string;
}

export interface ConflictStats {
  total: number;
  unresolved: number;
  resolved: number;
  bySource: Record<string, number>;
  bySeverity: Record<string, number>;
}

/**
 * Repository for data conflict operations
 * Provides conflict detection logging and resolution tracking
 */
export class DataConflictsRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Log a new conflict between sources
   */
  async logConflict(input: LogConflictInput): Promise<DataConflictRecord> {
    const result = await this.executeQuery(
      'logDataConflict',
      async () => {
        return await this.db
          .insert(dataConflicts)
          .values({
            ipoId: input.ipoId,
            tableName: input.tableName,
            fieldName: input.fieldName,
            source1: input.source1,
            value1: input.value1 || null,
            source2: input.source2,
            value2: input.value2 || null,
            resolvedSource: input.resolvedSource || null,
            resolutionReason: input.resolutionReason || null,
            severity: input.severity || 'INFO',
            detectedAt: new Date(),
          })
          .returning();
      },
      input as unknown as Record<string, unknown>
    );

    // Invalidate unresolved conflicts cache
    await this.deleteCache([
      `conflicts:unresolved:all`,
      `conflicts:ipo:${input.ipoId}:unresolved`,
    ]);

    return result[0] as DataConflictRecord;
  }

  /**
   * Log a conflict, refreshing the existing UNRESOLVED row for the same
   * (ipoId, tableName, fieldName) instead of inserting a new one every cycle
   * (T-286, P2-3: unbounded re-insert-per-cycle growth in data_conflicts).
   * Only one open conflict per field makes sense at a time -- a fresh
   * disagreement on the same field supersedes the prior unresolved record
   * rather than piling up beside it.
   */
  async upsertConflict(input: LogConflictInput): Promise<DataConflictRecord> {
    const existing = await this.db
      .select({ id: dataConflicts.id })
      .from(dataConflicts)
      .where(
        and(
          eq(dataConflicts.ipoId, input.ipoId),
          eq(dataConflicts.tableName, input.tableName),
          eq(dataConflicts.fieldName, input.fieldName),
          isNull(dataConflicts.resolvedAt)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return this.logConflict(input);
    }

    const result = await this.executeQuery(
      'refreshDataConflict',
      async () => {
        return await this.db
          .update(dataConflicts)
          .set({
            source1: input.source1,
            value1: input.value1 || null,
            source2: input.source2,
            value2: input.value2 || null,
            resolvedSource: input.resolvedSource || null,
            resolutionReason: input.resolutionReason || null,
            severity: input.severity || 'INFO',
            detectedAt: new Date(),
          })
          .where(eq(dataConflicts.id, existing[0].id))
          .returning();
      },
      input as unknown as Record<string, unknown>
    );

    await this.deleteCache([
      `conflicts:unresolved:all`,
      `conflicts:ipo:${input.ipoId}:unresolved`,
    ]);

    return result[0] as DataConflictRecord;
  }

  /**
   * Auto-resolve the open conflict for (ipoId, tableName, fieldName), if any,
   * because a later consolidation cycle found the sources now agree (T-286).
   * Distinguished from manual `resolveConflict` by `resolvedBy: 'SYSTEM'` and
   * `resolutionReason: 'AUTO_RESOLVED_VALUES_CONVERGED'` so the audit trail
   * still shows how the conflict closed. A no-op (returns 0) when there was
   * no open conflict for the field -- the common case.
   */
  async autoResolveConverged(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<number> {
    const result = await this.executeQuery(
      'autoResolveConvergedConflict',
      async () => {
        return await this.db
          .update(dataConflicts)
          .set({
            resolutionReason: 'AUTO_RESOLVED_VALUES_CONVERGED',
            resolvedBy: 'SYSTEM',
            resolvedAt: new Date(),
          })
          .where(
            and(
              eq(dataConflicts.ipoId, ipoId),
              eq(dataConflicts.tableName, tableName),
              eq(dataConflicts.fieldName, fieldName),
              isNull(dataConflicts.resolvedAt)
            )
          )
          .returning({ id: dataConflicts.id });
      },
      { ipoId, tableName, fieldName }
    );

    if (result.length > 0) {
      await this.deleteCachePattern(`conflicts:*`);
    }

    return result.length;
  }

  /**
   * Prune RESOLVED conflicts older than `retentionDays` (default 30, mirrors
   * `scraper_logs` retention -- see `non-fatal-side-effects.md` /
   * `SCRAPER_LOG_RETENTION_DAYS`). Never deletes an unresolved row -- an
   * unresolved conflict has no natural expiry until it's resolved.
   */
  async pruneResolved(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.executeQuery(
      'pruneResolvedConflicts',
      async () => {
        return await this.db
          .delete(dataConflicts)
          .where(
            and(
              isNotNull(dataConflicts.resolvedAt),
              lt(dataConflicts.resolvedAt, cutoff)
            )
          )
          .returning({ id: dataConflicts.id });
      },
      { retentionDays }
    );

    if (result.length > 0) {
      await this.deleteCachePattern(`conflicts:*`);
    }

    return result.length;
  }

  /**
   * Get all unresolved conflicts (for admin dashboard)
   */
  async findUnresolved(limit?: number): Promise<DataConflictRecord[]> {
    const cacheKey = `conflicts:unresolved:all${limit ? `:limit:${limit}` : ''}`;

    return this.getFromCache<DataConflictRecord[]>(
      cacheKey,
      async () => {
        let query = this.db
          .select()
          .from(dataConflicts)
          .where(isNull(dataConflicts.resolvedAt))
          .orderBy(desc(dataConflicts.detectedAt));

        if (limit) {
          query = query.limit(limit) as typeof query;
        }

        const results = await query;
        return results as DataConflictRecord[];
      },
      300 // 5 minutes TTL (shorter for conflict dashboard)
    );
  }

  /**
   * Get unresolved conflicts for a specific IPO
   */
  async findUnresolvedForIPO(ipoId: string): Promise<DataConflictRecord[]> {
    const cacheKey = `conflicts:ipo:${ipoId}:unresolved`;

    return this.getFromCache<DataConflictRecord[]>(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(dataConflicts)
          .where(
            and(
              eq(dataConflicts.ipoId, ipoId),
              isNull(dataConflicts.resolvedAt)
            )
          )
          .orderBy(desc(dataConflicts.detectedAt));

        return results as DataConflictRecord[];
      },
      300 // 5 minutes TTL
    );
  }

  /**
   * Get all conflicts for an IPO (resolved and unresolved)
   */
  async findByIPOId(ipoId: string): Promise<DataConflictRecord[]> {
    const cacheKey = `conflicts:ipo:${ipoId}:all`;

    return this.getFromCache<DataConflictRecord[]>(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(dataConflicts)
          .where(eq(dataConflicts.ipoId, ipoId))
          .orderBy(desc(dataConflicts.detectedAt));

        return results as DataConflictRecord[];
      },
      1800 // 30 minutes TTL
    );
  }

  /**
   * Get conflicts by severity
   */
  async findBySeverity(
    severity: 'INFO' | 'WARNING' | 'CRITICAL',
    onlyUnresolved: boolean = true
  ): Promise<DataConflictRecord[]> {
    const cacheKey = `conflicts:severity:${severity}:${onlyUnresolved ? 'unresolved' : 'all'}`;

    return this.getFromCache<DataConflictRecord[]>(
      cacheKey,
      async () => {
        const conditions = [eq(dataConflicts.severity, severity)];

        if (onlyUnresolved) {
          conditions.push(isNull(dataConflicts.resolvedAt));
        }

        const results = await this.db
          .select()
          .from(dataConflicts)
          .where(and(...conditions))
          .orderBy(desc(dataConflicts.detectedAt));

        return results as DataConflictRecord[];
      },
      300 // 5 minutes TTL
    );
  }

  /**
   * Get conflicts for a specific field across all IPOs
   */
  async findByField(
    tableName: string,
    fieldName: string,
    onlyUnresolved: boolean = true
  ): Promise<DataConflictRecord[]> {
    const cacheKey = `conflicts:field:${tableName}:${fieldName}:${onlyUnresolved ? 'unresolved' : 'all'}`;

    return this.getFromCache<DataConflictRecord[]>(
      cacheKey,
      async () => {
        const conditions = [
          eq(dataConflicts.tableName, tableName),
          eq(dataConflicts.fieldName, fieldName),
        ];

        if (onlyUnresolved) {
          conditions.push(isNull(dataConflicts.resolvedAt));
        }

        const results = await this.db
          .select()
          .from(dataConflicts)
          .where(and(...conditions))
          .orderBy(desc(dataConflicts.detectedAt));

        return results as DataConflictRecord[];
      },
      600 // 10 minutes TTL
    );
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: ResolveConflictInput
  ): Promise<DataConflictRecord | null> {
    const result = await this.executeQuery(
      'resolveConflict',
      async () => {
        return await this.db
          .update(dataConflicts)
          .set({
            resolvedSource: resolution.resolvedSource,
            resolutionReason: resolution.resolutionReason,
            resolvedBy: resolution.resolvedBy,
            resolvedAt: new Date(),
            adminNote: resolution.adminNote || null,
          })
          .where(eq(dataConflicts.id, conflictId))
          .returning();
      },
      { conflictId, resolution }
    );

    if (result.length > 0) {
      // Invalidate all conflict caches
      await this.deleteCachePattern(`conflicts:*`);
      return result[0] as DataConflictRecord;
    }

    return null;
  }

  /**
   * Bulk resolve conflicts for an IPO
   * Useful for "accept all from source X" operations
   */
  async bulkResolveForIPO(
    ipoId: string,
    resolvedSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH',
    resolvedBy: string,
    resolutionReason: string
  ): Promise<number> {
    const result = await this.executeQuery(
      'bulkResolveConflicts',
      async () => {
        return await this.db
          .update(dataConflicts)
          .set({
            resolvedSource,
            resolutionReason,
            resolvedBy,
            resolvedAt: new Date(),
          })
          .where(
            and(
              eq(dataConflicts.ipoId, ipoId),
              isNull(dataConflicts.resolvedAt)
            )
          )
          .returning();
      },
      { ipoId, resolvedSource, resolvedBy, resolutionReason }
    );

    // Invalidate all conflict caches
    await this.deleteCachePattern(`conflicts:*`);

    return result.length;
  }

  /**
   * Get conflict statistics
   * Useful for conflict dashboard metrics
   */
  async getConflictStats(ipoId?: string): Promise<ConflictStats> {
    const cacheKey = ipoId ? `conflicts:stats:${ipoId}` : `conflicts:stats:global`;

    return this.getFromCache<ConflictStats>(
      cacheKey,
      async () => {
        const conditions = ipoId ? [eq(dataConflicts.ipoId, ipoId)] : [];

        const allConflicts = await this.db
          .select()
          .from(dataConflicts)
          .where(conditions.length > 0 ? and(...conditions) : undefined);

        const total = allConflicts.length;
        const unresolved = allConflicts.filter((c) => !c.resolvedAt).length;
        const resolved = allConflicts.filter((c) => c.resolvedAt).length;

        // Count by source (which sources cause most conflicts)
        const bySource: Record<string, number> = {};
        allConflicts.forEach((c) => {
          bySource[c.source1] = (bySource[c.source1] || 0) + 1;
          bySource[c.source2] = (bySource[c.source2] || 0) + 1;
        });

        // Count by severity
        const bySeverity: Record<string, number> = {};
        allConflicts.forEach((c) => {
          bySeverity[c.severity] = (bySeverity[c.severity] || 0) + 1;
        });

        return {
          total,
          unresolved,
          resolved,
          bySource,
          bySeverity,
        };
      },
      300 // 5 minutes TTL
    );
  }

  /**
   * Get conflict rate (conflicts / total updates)
   * Requires cross-referencing with field_sources table
   */
  async getConflictRate(ipoId: string): Promise<number> {
    const conflicts = await this.findByIPOId(ipoId);
    // Note: Accurate rate calculation requires field_sources count
    // For now, return count. Enhance with join query later.
    return conflicts.length;
  }

  /**
   * Delete a conflict record
   * Use with caution - removes audit trail
   */
  async delete(conflictId: string): Promise<boolean> {
    const result = await this.executeQuery(
      'deleteConflict',
      async () => {
        return await this.db
          .delete(dataConflicts)
          .where(eq(dataConflicts.id, conflictId))
          .returning();
      },
      { conflictId }
    );

    if (result.length > 0) {
      await this.deleteCachePattern(`conflicts:*`);
      return true;
    }

    return false;
  }

  /**
   * Delete all conflicts for an IPO
   * Use with caution - removes complete conflict history
   */
  async deleteAllForIPO(ipoId: string): Promise<number> {
    const result = await this.executeQuery(
      'deleteAllConflictsForIPO',
      async () => {
        return await this.db
          .delete(dataConflicts)
          .where(eq(dataConflicts.ipoId, ipoId))
          .returning();
      },
      { ipoId }
    );

    await this.deleteCachePattern(`conflicts:*`);

    return result.length;
  }

  /**
   * Count unresolved conflicts
   * Useful for dashboard badge
   */
  async countUnresolved(ipoId?: string): Promise<number> {
    const conflicts = ipoId
      ? await this.findUnresolvedForIPO(ipoId)
      : await this.findUnresolved();

    return conflicts.length;
  }

  /**
   * Get most problematic fields (fields with most conflicts)
   * Useful for identifying data quality issues
   */
  async getMostProblematicFields(limit: number = 10): Promise<Array<{
    tableName: string;
    fieldName: string;
    conflictCount: number;
  }>> {
    const cacheKey = `conflicts:problematic-fields:limit:${limit}`;

    return this.getFromCache<Array<{
      tableName: string;
      fieldName: string;
      conflictCount: number;
    }>>(
      cacheKey,
      async () => {
        const result = await this.db
          .select({
            tableName: dataConflicts.tableName,
            fieldName: dataConflicts.fieldName,
            conflictCount: sql<number>`COUNT(*)::int`,
          })
          .from(dataConflicts)
          .where(isNull(dataConflicts.resolvedAt))
          .groupBy(dataConflicts.tableName, dataConflicts.fieldName)
          .orderBy(desc(sql`COUNT(*)`))
          .limit(limit);

        return result;
      },
      600 // 10 minutes TTL
    );
  }
}
