/**
 * Scraper Log Repository
 *
 * Manages scraper execution logs for monitoring and debugging.
 * Story 7.5: Error Handling & Monitoring
 */

import { desc, eq, gte, lte, and, sql, count } from 'drizzle-orm';
import { BaseRepository } from './base-repository';
import { scraperLogs } from '../db';
import type { ScraperLog, NewScraperLog, ScraperSource } from '../db/types';
import type {
  PaginationParams,
  PaginatedResponse,
} from './types';

/**
 * Filters for querying scraper logs
 */
export interface ScraperLogFilters {
  source?: ScraperSource;
  status?: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  startDate?: Date;
  endDate?: Date;
}

/**
 * Aggregated metrics from scraper logs
 */
export interface ScraperMetrics {
  successCount: number;
  failureCount: number;
  partialCount: number;
  avgDuration: number;
  totalRecords: number;
}

/**
 * Repository for managing scraper execution logs
 */
export class ScraperLogRepository extends BaseRepository {
  /**
   * Create a new scraper log entry
   */
  async create(log: NewScraperLog): Promise<ScraperLog> {
    return this.executeQuery('scraper_log.create', async () => {
      const [createdLog] = await this.db
        .insert(scraperLogs)
        .values(log)
        .returning();

      return createdLog;
    }, { source: log.source, status: log.status });
  }

  /**
   * Get recent logs for a specific source
   */
  async getRecentLogs(
    source: ScraperSource | 'ALL',
    hours: number = 24
  ): Promise<ScraperLog[]> {
    const sinceTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    return this.executeQuery('scraper_log.getRecentLogs', async () => {
      const conditions = [gte(scraperLogs.createdAt, sinceTime)];

      if (source !== 'ALL') {
        conditions.push(eq(scraperLogs.source, source));
      }

      const logs = await this.db
        .select()
        .from(scraperLogs)
        .where(and(...conditions))
        .orderBy(desc(scraperLogs.createdAt))
        .limit(100);

      return logs;
    }, { source, hours });
  }

  /**
   * Get logs with filters and pagination
   */
  async findAll(
    filters: ScraperLogFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<ScraperLog>> {
    return this.executeQuery('scraper_log.findAll', async () => {
      const conditions = [];

      if (filters.source) {
        conditions.push(eq(scraperLogs.source, filters.source));
      }

      if (filters.status) {
        conditions.push(eq(scraperLogs.status, filters.status));
      }

      if (filters.startDate) {
        conditions.push(gte(scraperLogs.createdAt, filters.startDate));
      }

      if (filters.endDate) {
        conditions.push(lte(scraperLogs.createdAt, filters.endDate));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [{ total }] = await this.db
        .select({ total: count() })
        .from(scraperLogs)
        .where(where);

      // Get paginated results
      const offset = (pagination.page - 1) * pagination.limit;
      const logs = await this.db
        .select()
        .from(scraperLogs)
        .where(where)
        .orderBy(desc(scraperLogs.createdAt))
        .limit(pagination.limit)
        .offset(offset);

      const totalPages = Math.ceil(Number(total) / pagination.limit);

      return {
        data: logs,
        meta: {
          page: pagination.page,
          limit: pagination.limit,
          total: Number(total),
          totalPages: totalPages,
          hasNext: pagination.page < totalPages,
          hasPrev: pagination.page > 1,
        },
      };
    }, { filters, pagination });
  }

  /**
   * Get aggregated metrics for a source within a time range
   */
  async getMetrics(
    source: ScraperSource,
    startDate: Date,
    endDate: Date
  ): Promise<ScraperMetrics> {
    return this.executeQuery('scraper_log.getMetrics', async () => {
      const [metrics] = await this.db
        .select({
          successCount: sql<number>`COUNT(*) FILTER (WHERE ${scraperLogs.status} = 'SUCCESS')`,
          failureCount: sql<number>`COUNT(*) FILTER (WHERE ${scraperLogs.status} = 'FAILURE')`,
          partialCount: sql<number>`COUNT(*) FILTER (WHERE ${scraperLogs.status} = 'PARTIAL')`,
          avgDuration: sql<number>`COALESCE(AVG(${scraperLogs.durationMs}), 0)`,
          totalRecords: sql<number>`COALESCE(SUM(${scraperLogs.recordsProcessed}), 0)`,
        })
        .from(scraperLogs)
        .where(
          and(
            eq(scraperLogs.source, source),
            gte(scraperLogs.createdAt, startDate),
            lte(scraperLogs.createdAt, endDate)
          )
        );

      return {
        successCount: Number(metrics.successCount),
        failureCount: Number(metrics.failureCount),
        partialCount: Number(metrics.partialCount),
        avgDuration: Math.round(Number(metrics.avgDuration)),
        totalRecords: Number(metrics.totalRecords),
      };
    }, { source, startDate, endDate });
  }

  /**
   * Get the last log entry for a source
   */
  async getLastRun(source: ScraperSource): Promise<ScraperLog | null> {
    return this.executeQuery('scraper_log.getLastRun', async () => {
      const [log] = await this.db
        .select()
        .from(scraperLogs)
        .where(eq(scraperLogs.source, source))
        .orderBy(desc(scraperLogs.createdAt))
        .limit(1);

      return log || null;
    }, { source });
  }

  /**
   * Get the last successful log entry for a source
   */
  async getLastSuccess(source: ScraperSource): Promise<ScraperLog | null> {
    return this.executeQuery('scraper_log.getLastSuccess', async () => {
      const [log] = await this.db
        .select()
        .from(scraperLogs)
        .where(
          and(
            eq(scraperLogs.source, source),
            eq(scraperLogs.status, 'SUCCESS')
          )
        )
        .orderBy(desc(scraperLogs.createdAt))
        .limit(1);

      return log || null;
    }, { source });
  }

  /**
   * Get the last failed log entry for a source
   */
  async getLastFailure(source: ScraperSource): Promise<ScraperLog | null> {
    return this.executeQuery('scraper_log.getLastFailure', async () => {
      const [log] = await this.db
        .select()
        .from(scraperLogs)
        .where(
          and(
            eq(scraperLogs.source, source),
            eq(scraperLogs.status, 'FAILURE')
          )
        )
        .orderBy(desc(scraperLogs.createdAt))
        .limit(1);

      return log || null;
    }, { source });
  }

  /**
   * Delete logs older than specified days (for retention policy)
   */
  async cleanupOldLogs(days: number): Promise<number> {
    return this.executeQuery('scraper_log.cleanupOldLogs', async () => {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const result = await this.db
        .delete(scraperLogs)
        .where(lte(scraperLogs.createdAt, cutoffDate));

      return result.rowCount || 0;
    }, { days, cutoffDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000) });
  }
}
