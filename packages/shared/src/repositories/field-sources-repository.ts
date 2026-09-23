/**
 * Field Sources Repository
 * Data access layer for field source tracking (audit trail)
 * Tracks which scraper source provided each field value
 */

import { sourceKeyLineageFor } from './source-key-lineage';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import * as schema from '../db/schema';
import { fieldSources } from '../db/schema';
import { BaseRepository } from './base-repository';
import type { ScraperSource } from '../db/types';

export interface FieldSourceRecord {
  id: string;
  ipoId: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  source: ScraperSource;
  confidence: number;
  previousValue: string | null;
  previousSource: ScraperSource | null;
  dataLineage: unknown; // JSONB field from database
  updatedAt: Date;
  updatedBy: string | null;
  createdAt: Date;
}

export interface TrackFieldUpdateInput {
  ipoId: string;
  tableName: string;
  /** The row's natural key within tableName. Default '' (singleton row) when omitted —
   *  see schema.ts's field_sources.rowKey comment for the per-table convention. */
  rowKey?: string;
  fieldName: string;
  source: ScraperSource;
  confidence?: number;
  previousValue?: string | null;
  previousSource?: ScraperSource | null;
  dataLineage?: Record<string, unknown>;
  updatedBy?: string;
  /** S3b-2 (docs/design/s3b2-verdict-writer-plan.md): every OTHER witness answer collected this
   *  pass, besides the winning source/value above. Shape: [{source, value, at, docType?}] — S2's
   *  column, first populated here. Omitted (undefined) leaves the column untouched on both INSERT
   *  and UPDATE (flag OFF, or every caller before this slice). */
  witnesses?: Array<{ source: string; value: unknown; at: string; docType?: string }>;
  /** S3b-2: CONFIRMED | DISPUTED | UNCONFIRMED | SINGLE_SOURCE | NO_WITNESS — S2's column, first
   *  populated here. Omitted leaves the column untouched. */
  verdict?: string;
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
/**
 * The ten E-1 fields (field-manifest class `T`) are the EXCHANGE's to state:
 * the timetable, the status, and where the shares list. A document may PRINT an
 * intended date; only the exchange's own page says what it IS.
 *
 * #862 measured 79 writes that broke this on staging — 41 listingExchanges, 22
 * timetable dates and 8 statuses, every one from DRHP. A DRAFT prospectus is
 * filed months before the offer and does not contain final dates at all, so
 * these were not merely wrong-source writes: they were values that could not
 * have been correct when they were made.
 *
 * The rule already existed twice as metadata — as `capability` in the manifest,
 * and as a validator on ADMIN OVERRIDES
 * (scraper/src/config/field-source-override-validation.ts:80). Neither guards a
 * write, which is why the writes happened. This is the choke point every caller
 * passes through.
 *
 * Spelled camelCase because that is how `field_sources.field_name` is stored
 * (`openDate`, not `open_date`) — a snake_case list here would match nothing
 * and the guard would silently never fire.
 */
const E1_EXCHANGE_STATED_FIELDS: ReadonlySet<string> = new Set([
  'openDate',
  'closeDate',
  'listingDate',
  'status',
  'listingExchanges',
  'allotmentDate',
  'basisOfAllotmentDate',
  'initiationOfRefundsDate',
  'creditOfSharesDate',
  'bidDate',
]);

/** Sources that mean "read out of an offer document", as opposed to fetched from a source that states the fact. */
const DOCUMENT_PATH_SOURCES: ReadonlySet<string> = new Set(['DRHP', 'DOC', 'RHP', 'PROSPECTUS']);

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
    fieldName: string,
    rowKey: string = ''
  ): Promise<FieldSourceRecord | null> {
    const cacheKey = `field-source:${ipoId}:${tableName}:${rowKey}:${fieldName}`;

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
              eq(fieldSources.rowKey, rowKey),
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
    // #862: refuse before the insert, not after. Throwing here means the
    // caller's transaction fails loudly rather than the row landing and a
    // nightly check finding it tomorrow.
    if (E1_EXCHANGE_STATED_FIELDS.has(input.fieldName) && DOCUMENT_PATH_SOURCES.has(input.source)) {
      throw new Error(
        `E-1 field '${input.fieldName}' may not be written from the document path (source=${input.source}). ` +
        'The exchange states the timetable, the status and the listing venue; a document only prints what was intended. See #862.'
      );
    }
    const rowKey = input.rowKey ?? '';
    // OD-85 write rule: a write that came through a source-key bind records the binding key ids.
    const keyLineage = sourceKeyLineageFor(input.ipoId);
    if (keyLineage) input = { ...input, dataLineage: { ...(input.dataLineage ?? {}), ...keyLineage } };

    // rowKey is part of the ON CONFLICT target below (item 1 slice s18), so an
    // upsert can never move an existing row from one rowKey to another: a
    // different rowKey is a different row. The pre-read that used to look up
    // the row's previous rowKey — and the extra cache invalidation under that
    // old key — are gone along with the window they compensated for.

    const result = await this.executeQuery(
      'trackFieldUpdate',
      async () => {
        return await this.db
          .insert(fieldSources)
          .values({
            ipoId: input.ipoId,
            tableName: input.tableName,
            rowKey,
            fieldName: input.fieldName,
            source: input.source,
            confidence: input.confidence ?? 100,
            previousValue: input.previousValue || null,
            previousSource: input.previousSource || null,
            dataLineage: input.dataLineage ? (input.dataLineage as unknown) : null,
            // S3b-2: a fresh INSERT has no prior row to preserve, so an omitted witnesses/verdict
            // (every caller before this slice, and this slice's flag-OFF path) simply writes NULL
            // — matching the column's own NULL default (S2's schema comment: "nothing computed
            // for them").
            witnesses: input.witnesses ? (input.witnesses as unknown) : null,
            verdict: input.verdict ?? null,
            updatedAt: new Date(),
            updatedBy: input.updatedBy || 'SYSTEM',
          })
          .onConflictDoUpdate({
            // MUST mirror unique_field_source_per_ipo in
            // packages/shared/src/db/schema.ts exactly — a target naming a
            // column list with no matching unique constraint raises Postgres
            // 42P10 on the FIRST write, which is a broken deploy.
            target: [
              fieldSources.ipoId,
              fieldSources.tableName,
              fieldSources.rowKey,
              fieldSources.fieldName,
            ],
            set: {
              rowKey,
              source: input.source,
              confidence: input.confidence ?? 100,
              previousValue: input.previousValue || null,
              previousSource: input.previousSource || null,
              // MAJOR-4 (Tier A review, PR #753): MERGE, never replace. A plain object here
              // (the old code: `input.dataLineage ?? null`) REPLACES the whole jsonb column on
              // conflict, so a provenance-only write (`{policyOrigin}`) silently destroyed
              // whatever `docType`/other keys an earlier write on the SAME row (same ON
              // CONFLICT target) had set — filing-persister.ts reads `dataLineage.docType` back
              // and fails CLOSED (skips the write) when it is missing.
              // `excluded.data_lineage` is the row this statement tried to INSERT (the caller's
              // new value); `field_sources.data_lineage` is what is already stored. COALESCE
              // guards the first write (nothing stored yet) and a caller that omits
              // dataLineage entirely (passes null) so it never overwrites a good value with
              // null. `||` is Postgres jsonb concatenation: keys in `excluded` win on overlap,
              // every other existing key survives — the same semantics as
              // `{...existing, ...incoming}` in JS.
              dataLineage: input.dataLineage
                ? sql`COALESCE(${fieldSources.dataLineage}, '{}'::jsonb) || ${JSON.stringify(input.dataLineage)}::jsonb`
                : sql`${fieldSources.dataLineage}`,
              // S3b-2: REPLACE (never merge — witnesses is a fresh snapshot of THIS pass's
              // answers, not an accumulating log), but only when the caller actually computed
              // one. Every caller before this slice — and this slice's own flag-OFF path — omits
              // `witnesses`/`verdict`, so `sql\`${column}\`` (self-reference, not `null`) leaves
              // the stored value UNCHANGED on conflict. Writing `null` here unconditionally would
              // ERASE a verdict a previous ON pass had already written, the moment the flag is
              // flipped off again or a non-verdict caller (filing-persister.ts, chittorgarh-
              // issue-type-job.ts) updates the SAME row for an unrelated reason.
              witnesses: input.witnesses ? (input.witnesses as unknown) : sql`${fieldSources.witnesses}`,
              verdict: input.verdict !== undefined ? input.verdict : sql`${fieldSources.verdict}`,
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
      input.fieldName,
      rowKey
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
      source: ScraperSource;
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
    source: ScraperSource
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
    fieldName: string,
    rowKey: string = ''
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
              eq(fieldSources.rowKey, rowKey),
              eq(fieldSources.fieldName, fieldName)
            )
          )
          .returning();
      },
      { ipoId, tableName, rowKey, fieldName }
    );

    if (result.length > 0) {
      await this.invalidateFieldSourceCaches(ipoId, tableName, fieldName, rowKey);
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
    fieldName: string,
    rowKey: string = ''
  ): Promise<void> {
    const keys = [
      `field-sources:ipo:${ipoId}:all`,
      `field-sources:table:${ipoId}:${tableName}`,
      `field-source:${ipoId}:${tableName}:${rowKey}:${fieldName}`,
    ];

    await this.deleteCache(keys);
  }
}
