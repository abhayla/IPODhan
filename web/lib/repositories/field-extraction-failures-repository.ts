/**
 * Field Extraction Failures Repository (item 4, OD-21)
 *
 * One row per field a validation rule rejected BEFORE it could be written.
 * Distinct from data_conflicts (two sources disagreeing on values both
 * consider valid) — this logs a single source's value failing a rule outright.
 *
 * Rows are never deleted: a rejection is historical fact. A later rank or a
 * later cycle that supplies a passing value for the same
 * (ipoId, tableName, fieldName, rowKey) marks the open rows resolved instead.
 */

import { and, eq, isNull, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { fieldExtractionFailures } from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';

export type ScraperSourceValue =
  | 'ADMIN'
  | 'DRHP'
  | 'NSE'
  | 'BSE'
  | 'API_FALLBACK'
  | 'MONEYCONTROL'
  | 'CHITTORGARH';

export interface RecordFailureInput {
  ipoId: string;
  tableName: string;
  fieldName: string;
  /** '' (default) for singleton tables — matches field_sources.row_key exactly. */
  rowKey?: string;
  documentId?: string | null;
  documentSha256?: string | null;
  ruleId: string;
  rankAttempted: ScraperSourceValue;
  extractedValue?: string | null;
  /** NOT NULL by contract (signal-ownership.md R6) — a blank cause is refused here, not by Postgres. */
  cause: string;
}

export interface FieldExtractionFailureRecord {
  id: string;
  ipoId: string;
  tableName: string;
  fieldName: string;
  rowKey: string;
  documentId: string | null;
  documentSha256: string | null;
  ruleId: string;
  rankAttempted: ScraperSourceValue;
  extractedValue: string | null;
  cause: string;
  occurredAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
}

const MAX_EXTRACTED_VALUE_CHARS = 2000;

export class FieldExtractionFailuresRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Writes one failure row. Refuses an empty `cause` loudly rather than letting
   * a NOT NULL violation surface later as an opaque driver error: a failure
   * nobody can classify from its own row is a defect of the logger.
   */
  async recordFailure(input: RecordFailureInput): Promise<FieldExtractionFailureRecord> {
    const cause = (input.cause ?? '').trim();
    if (cause.length === 0) {
      throw new Error(
        `FieldExtractionFailuresRepository.recordFailure: cause is required ` +
          `(${input.tableName}.${input.fieldName} rule=${input.ruleId}) — signal-ownership.md R6`
      );
    }

    const [row] = await this.db
      .insert(fieldExtractionFailures)
      .values({
        ipoId: input.ipoId,
        tableName: input.tableName,
        fieldName: input.fieldName,
        rowKey: input.rowKey ?? '',
        documentId: input.documentId ?? null,
        documentSha256: input.documentSha256 ?? null,
        ruleId: input.ruleId,
        rankAttempted: input.rankAttempted,
        extractedValue:
          input.extractedValue === null || input.extractedValue === undefined
            ? null
            : input.extractedValue.slice(0, MAX_EXTRACTED_VALUE_CHARS),
        cause,
      })
      .returning();

    return row as FieldExtractionFailureRecord;
  }

  /**
   * Marks every still-open failure row for one field resolved. Called when a
   * later rank or a later cycle supplies a value that passes the same gate.
   * Returns how many rows were closed.
   */
  async markResolved(
    ipoId: string,
    tableName: string,
    fieldName: string,
    rowKey: string = ''
  ): Promise<number> {
    const rows = await this.db
      .update(fieldExtractionFailures)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(fieldExtractionFailures.ipoId, ipoId),
          eq(fieldExtractionFailures.tableName, tableName),
          eq(fieldExtractionFailures.fieldName, fieldName),
          eq(fieldExtractionFailures.rowKey, rowKey),
          isNull(fieldExtractionFailures.resolvedAt)
        )
      )
      .returning({ id: fieldExtractionFailures.id });

    return rows.length;
  }

  /** Open (unresolved) failure rows for one IPO, newest first. */
  async findUnresolvedForIPO(ipoId: string): Promise<FieldExtractionFailureRecord[]> {
    const rows = await this.db
      .select()
      .from(fieldExtractionFailures)
      .where(
        and(
          eq(fieldExtractionFailures.ipoId, ipoId),
          isNull(fieldExtractionFailures.resolvedAt)
        )
      )
      .orderBy(desc(fieldExtractionFailures.occurredAt));

    return rows as FieldExtractionFailureRecord[];
  }
}
