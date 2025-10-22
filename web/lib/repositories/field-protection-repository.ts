/**
 * Field Protection Repository
 * Data access layer for field protection metadata
 */

import { eq, and, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { fieldProtectionMetadata } from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';

export interface FieldProtectionRecord {
  id: string;
  tableName: string;
  fieldName: string;
  ipoId: string;
  isProtected: boolean;
  autoProtected: boolean;
  manuallyEditedAt: Date | null;
  manuallyEditedBy: string | null;
  editNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFieldProtectionInput {
  ipoId: string;
  tableName: string;
  fieldName: string;
  isProtected: boolean;
  autoProtected?: boolean;
  manuallyEditedBy: string;
  editNote?: string;
}

export interface UpdateFieldProtectionInput {
  isProtected?: boolean;
  autoProtected?: boolean;
  editNote?: string;
}

/**
 * Repository for field protection metadata operations
 */
export class FieldProtectionRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Get all protected fields for an IPO
   */
  async findByIPOId(ipoId: string): Promise<FieldProtectionRecord[]> {
    const cacheKey = `protection:ipo:${ipoId}:all`;

    return this.getFromCache(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(fieldProtectionMetadata)
          .where(eq(fieldProtectionMetadata.ipoId, ipoId));

        return results;
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Get protection status for a specific field
   */
  async findByField(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<FieldProtectionRecord | null> {
    const cacheKey = `protection:field:${ipoId}:${tableName}:${fieldName}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(fieldProtectionMetadata)
          .where(
            and(
              eq(fieldProtectionMetadata.ipoId, ipoId),
              eq(fieldProtectionMetadata.tableName, tableName),
              eq(fieldProtectionMetadata.fieldName, fieldName)
            )
          )
          .limit(1);

        return results[0] || null;
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Get all protected fields for a specific table within an IPO
   */
  async findByTable(ipoId: string, tableName: string): Promise<FieldProtectionRecord[]> {
    const cacheKey = `protection:table:${ipoId}:${tableName}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        const results = await this.db
          .select()
          .from(fieldProtectionMetadata)
          .where(
            and(
              eq(fieldProtectionMetadata.ipoId, ipoId),
              eq(fieldProtectionMetadata.tableName, tableName)
            )
          );

        return results;
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Create or update field protection record
   */
  async upsert(input: CreateFieldProtectionInput): Promise<FieldProtectionRecord> {
    const result = await this.executeQuery(
      'upsertFieldProtection',
      async () => {
        return await this.db
          .insert(fieldProtectionMetadata)
          .values({
            ipoId: input.ipoId,
            tableName: input.tableName,
            fieldName: input.fieldName,
            isProtected: input.isProtected,
            autoProtected: input.autoProtected ?? false,
            manuallyEditedAt: new Date(),
            manuallyEditedBy: input.manuallyEditedBy,
            editNote: input.editNote || null,
          })
          .onConflictDoUpdate({
            target: [
              fieldProtectionMetadata.tableName,
              fieldProtectionMetadata.fieldName,
              fieldProtectionMetadata.ipoId,
            ],
            set: {
              isProtected: input.isProtected,
              autoProtected: input.autoProtected ?? false,
              manuallyEditedAt: new Date(),
              manuallyEditedBy: input.manuallyEditedBy,
              editNote: input.editNote || null,
              updatedAt: new Date(),
            },
          })
          .returning();
      },
      input
    );

    // Invalidate caches
    await this.invalidateFieldProtectionCaches(
      input.ipoId,
      input.tableName,
      input.fieldName
    );

    return result[0];
  }

  /**
   * Update protection status for a field
   */
  async updateProtectionStatus(
    ipoId: string,
    tableName: string,
    fieldName: string,
    updates: UpdateFieldProtectionInput
  ): Promise<FieldProtectionRecord | null> {
    const result = await this.executeQuery(
      'updateProtectionStatus',
      async () => {
        return await this.db
          .update(fieldProtectionMetadata)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(fieldProtectionMetadata.ipoId, ipoId),
              eq(fieldProtectionMetadata.tableName, tableName),
              eq(fieldProtectionMetadata.fieldName, fieldName)
            )
          )
          .returning();
      },
      { ipoId, tableName, fieldName, updates }
    );

    if (result.length > 0) {
      await this.invalidateFieldProtectionCaches(ipoId, tableName, fieldName);
      return result[0];
    }

    return null;
  }

  /**
   * Bulk update protection status for multiple fields
   */
  async bulkUpdateProtectionStatus(
    ipoId: string,
    tableName: string,
    fieldNames: string[],
    isProtected: boolean
  ): Promise<number> {
    const result = await this.executeQuery(
      'bulkUpdateProtectionStatus',
      async () => {
        return await this.db
          .update(fieldProtectionMetadata)
          .set({
            isProtected,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(fieldProtectionMetadata.ipoId, ipoId),
              eq(fieldProtectionMetadata.tableName, tableName),
              inArray(fieldProtectionMetadata.fieldName, fieldNames)
            )
          )
          .returning();
      },
      { ipoId, tableName, fieldNames, isProtected }
    );

    // Invalidate caches for all updated fields
    for (const fieldName of fieldNames) {
      await this.invalidateFieldProtectionCaches(ipoId, tableName, fieldName);
    }

    return result.length;
  }

  /**
   * Delete field protection record
   */
  async delete(ipoId: string, tableName: string, fieldName: string): Promise<boolean> {
    const result = await this.executeQuery(
      'deleteFieldProtection',
      async () => {
        return await this.db
          .delete(fieldProtectionMetadata)
          .where(
            and(
              eq(fieldProtectionMetadata.ipoId, ipoId),
              eq(fieldProtectionMetadata.tableName, tableName),
              eq(fieldProtectionMetadata.fieldName, fieldName)
            )
          )
          .returning();
      },
      { ipoId, tableName, fieldName }
    );

    if (result.length > 0) {
      await this.invalidateFieldProtectionCaches(ipoId, tableName, fieldName);
      return true;
    }

    return false;
  }

  /**
   * Delete all protection records for an IPO
   */
  async deleteAllForIPO(ipoId: string): Promise<number> {
    const result = await this.executeQuery(
      'deleteAllFieldProtectionsForIPO',
      async () => {
        return await this.db
          .delete(fieldProtectionMetadata)
          .where(eq(fieldProtectionMetadata.ipoId, ipoId))
          .returning();
      },
      { ipoId }
    );

    // Invalidate all caches for IPO
    await this.deleteCachePattern(`protection:*:${ipoId}:*`);

    return result.length;
  }

  /**
   * Get count of protected fields for an IPO
   */
  async countProtectedFields(ipoId: string): Promise<number> {
    const records = await this.findByIPOId(ipoId);
    return records.filter((r) => r.isProtected).length;
  }

  /**
   * Invalidate caches related to field protection
   */
  private async invalidateFieldProtectionCaches(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<void> {
    const keys = [
      `protection:ipo:${ipoId}:all`,
      `protection:table:${ipoId}:${tableName}`,
      `protection:field:${ipoId}:${tableName}:${fieldName}`,
    ];

    await this.deleteCache(keys);
  }
}
