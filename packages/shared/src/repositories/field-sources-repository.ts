/**
 * Field Sources Repository
 * Data access layer for field source tracking (audit trail)
 * Tracks which scraper source provided each field value
 */

import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import * as schema from '../db/schema';
import { fieldSources } from '../db/schema';
import { BaseRepository } from './base-repository';

export interface FieldSourceRecord {
  id: string;
  ipoId: string;
  tableName: string;
  fieldName: string;
  source: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  confidence: number;
  previousValue: string | null;
  previousSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH' | null;
  dataLineage: unknown; // JSONB field from database
  updatedAt: Date;
  updatedBy: string | null;
  createdAt: Date;
}

export interface TrackFieldUpdateInput {
  ipoId: string;
  tableName: string;
  fieldName: string;
  source: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
  confidence?: number;
  previousValue?: string | null;
  previousSource?: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH' | null;
  dataLineage?: Record<string, unknown>;
  updatedBy?: string;
}

export interface FieldSourceSummary {
  fieldName: string;
  source: string;
  confidence: number;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Repository for field source tracking operations
 * Provides audit trail for data flow from scrapers to database
 */
export class FieldSourcesRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Get field source for a specific field
   */
  async findByField(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<FieldSourceRecord | null> {
    const cacheKey = `field-source:${ipoId}:${tableName}:${fieldName}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(fieldSources)
          .where(
            and(
              eq(fieldSources.ipoId, ipoId),
              eq(fieldSources.tableName, tableName),
              eq(fieldSources.fieldName, fieldName)
            )
          )
          .limit(1);

        return results[0] || null;
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Get all field sources for an IPO
   */
  async findByIPOId(ipoId: string): Promise<FieldSourceRecord[]> {
    const cacheKey = `field-sources:ipo:${ipoId}:all`;

    return this.getFromCache(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(fieldSources)
          .where(eq(fieldSources.ipoId, ipoId))
          .orderBy(desc(fieldSources.updatedAt));

        return results;
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Get field sources for a specific table within an IPO
   */
  async findByTable(ipoId: string, tableName: string): Promise<FieldSourceRecord[]> {
    const cacheKey = `field-sources:table:${ipoId}:${tableName}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(fieldSources)
          .where(
            and(
              eq(fieldSources.ipoId, ipoId),
              eq(fieldSources.tableName, tableName)
            )
          )
          .orderBy(desc(fieldSources.updatedAt));

        return results;
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Get source map for an IPO (fieldName → source info)
   * Useful for displaying source badges in UI
   */
  async getIPOSourceMap(ipoId: string): Promise<Record<string, FieldSourceSummary>> {
    const sources = await this.findByIPOId(ipoId);

    return sources.reduce((acc, source) => {
      acc[source.fieldName] = {
        fieldName: source.fieldName,
        source: source.source,
        confidence: source.confidence,
        updatedAt: source.updatedAt,
        updatedBy: source.updatedBy,
      };
      return acc;
    }, {} as Record<string, FieldSourceSummary>);
  }

  /**
   * Track field update (upsert pattern)
   * Records which source provided the field value
   */
  async trackFieldUpdate(input: TrackFieldUpdateInput): Promise<FieldSourceRecord> {
    const result = await this.executeQuery(
      'trackFieldUpdate',
      async () => {
        return await this.db
          .insert(fieldSources)
          .values({
            ipoId: input.ipoId,
            tableName: input.tableName,
            fieldName: input.fieldName,
            source: input.source,
            confidence: input.confidence ?? 100,
            previousValue: input.previousValue || null,
            previousSource: input.previousSource || null,
            dataLineage: input.dataLineage ? (input.dataLineage as unknown) : null,
            updatedAt: new Date(),
            updatedBy: input.updatedBy || 'SYSTEM',
          })
          .onConflictDoUpdate({
            target: [
              fieldSources.ipoId,
              fieldSources.tableName,
              fieldSources.fieldName,
            ],
            set: {
              source: input.source,
              confidence: input.confidence ?? 100,
              previousValue: input.previousValue || null,
              previousSource: input.previousSource || null,
              dataLineage: input.dataLineage ? (input.dataLineage as unknown) : null,
              updatedAt: new Date(),
              updatedBy: input.updatedBy || 'SYSTEM',
            },
          })
          .returning();
      },
      input as unknown as Record<string, unknown>
    );

    // Invalidate caches
    await this.invalidateFieldSourceCaches(
      input.ipoId,
      input.tableName,
      input.fieldName
    );

    return result[0];
  }

  /**
   * Bulk track field updates for multiple fields
   * Efficient for processing scraper results
   */
  async bulkTrackFieldUpdates(
    ipoId: string,
    tableName: string,
    fields: Array<{
      fieldName: string;
      source: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';
      confidence?: number;
      previousValue?: string | null;
    }>
  ): Promise<number> {
    const results = [];

    for (const field of fields) {
      const result = await this.trackFieldUpdate({
        ipoId,
        tableName,
        fieldName: field.fieldName,
        source: field.source,
        confidence: field.confidence,
        previousValue: field.previousValue,
      });
      results.push(result);
    }

    // Invalidate table-level cache once at the end
    await this.deleteCache([
      `field-sources:ipo:${ipoId}:all`,
      `field-sources:table:${ipoId}:${tableName}`,
    ]);

    return results.length;
  }

  /**
   * Get fields by source (find all fields updated by a specific scraper)
   */
  async findBySource(
    ipoId: string,
    source: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH'
  ): Promise<FieldSourceRecord[]> {
    const cacheKey = `field-sources:source:${ipoId}:${source}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(fieldSources)
          .where(
            and(
              eq(fieldSources.ipoId, ipoId),
              eq(fieldSources.source, source)
            )
          )
          .orderBy(desc(fieldSources.updatedAt));

        return results;
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Get field update history (track changes over time)
   * Note: Current schema only stores latest value + previous value
   * For full history, consider adding field_update_history table
   */
  async getFieldHistory(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<{
    current: FieldSourceRecord | null;
    hasPrevious: boolean;
  }> {
    const current = await this.findByField(ipoId, tableName, fieldName);

    return {
      current,
      hasPrevious: !!(current?.previousValue && current?.previousSource),
    };
  }

  /**
   * Delete field source record
   * Use with caution - removes audit trail
   */
  async delete(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<boolean> {
    const result = await this.executeQuery(
      'deleteFieldSource',
      async () => {
        return await this.db
          .delete(fieldSources)
          .where(
            and(
              eq(fieldSources.ipoId, ipoId),
              eq(fieldSources.tableName, tableName),
              eq(fieldSources.fieldName, fieldName)
            )
          )
          .returning();
      },
      { ipoId, tableName, fieldName }
    );

    if (result.length > 0) {
      await this.invalidateFieldSourceCaches(ipoId, tableName, fieldName);
      return true;
    }

    return false;
  }

  /**
   * Delete all source records for an IPO
   * Use with caution - removes complete audit trail
   */
  async deleteAllForIPO(ipoId: string): Promise<number> {
    const result = await this.executeQuery(
      'deleteAllFieldSourcesForIPO',
      async () => {
        return await this.db
          .delete(fieldSources)
          .where(eq(fieldSources.ipoId, ipoId))
          .returning();
      },
      { ipoId }
    );

    // Invalidate all caches for IPO
    await this.deleteCachePattern(`field-source*:${ipoId}:*`);

    return result.length;
  }

  /**
   * Get count of tracked fields for an IPO
   */
  async countTrackedFields(ipoId: string): Promise<number> {
    const records = await this.findByIPOId(ipoId);
    return records.length;
  }

  /**
   * Get source distribution (how many fields from each source)
   * Useful for data quality dashboard
   */
  async getSourceDistribution(ipoId: string): Promise<Record<string, number>> {
    const records = await this.findByIPOId(ipoId);

    return records.reduce((acc, record) => {
      acc[record.source] = (acc[record.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Invalidate caches related to field sources
   */
  private async invalidateFieldSourceCaches(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<void> {
    const keys = [
      `field-sources:ipo:${ipoId}:all`,
      `field-sources:table:${ipoId}:${tableName}`,
      `field-source:${ipoId}:${tableName}:${fieldName}`,
    ];

    await this.deleteCache(keys);
  }
}
