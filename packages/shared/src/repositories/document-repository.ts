/**
 * Document Repository
 *
 * Handles IPO document data access.
 * Implements caching for document listings.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { documents } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL, getDocumentsKey } from '../cache/cache-keys';
import { isMoreSpecificDocumentType } from '../db/document-type-refinement';
import { DatabaseError, EntityNotFoundError } from '../errors/repository-errors';
import type {
  Document,
  DocumentInsert,
  IDocumentRepository,
} from './types';

export class DocumentRepository
  extends BaseRepository
  implements IDocumentRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find all documents for an IPO
   */
  async findByIPO(ipoId: string): Promise<Document[]> {
    const cacheKey = getDocumentsKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const results = await this.db
            .select()
            .from(documents)
            .where(eq(documents.ipoId, ipoId));

          return results;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch documents for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.DOCUMENTS
    );
  }

  /**
   * Create a new document
   */
  async create(data: DocumentInsert): Promise<Document> {
    try {
      const [document] = await this.db
        .insert(documents)
        .values(data)
        .returning();

      // Invalidate cache
      await this.deleteCache(getDocumentsKey(data.ipoId));

      return document;
    } catch (error) {
      throw new DatabaseError(
        'Failed to create document',
        undefined,
        error
      );
    }
  }

  /**
   * Delete a document by ID
   */
  async delete(id: string): Promise<void> {
    try {
      const [document] = await this.db
        .delete(documents)
        .where(eq(documents.id, id))
        .returning();

      if (!document) {
        throw new EntityNotFoundError('Document', id);
      }

      // Invalidate cache
      await this.deleteCache(getDocumentsKey(document.ipoId));
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to delete document: ${id}`,
        undefined,
        error
      );
    }
  }

  /**
   * Delete all documents for an IPO
   */
  async deleteByIPO(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(documents)
        .where(eq(documents.ipoId, ipoId));

      // Invalidate cache
      await this.deleteCache(getDocumentsKey(ipoId));
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete documents for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Upsert a single document
   * - If URL exists: Update timestamp and set isActive=true
   * - If new document of existing type: Get next sequence number
   * - If new document type: Start sequence at 1
   */
  async upsertDocument(data: DocumentInsert): Promise<Document> {
    try {
      const { and, max } = await import('drizzle-orm');

      // Check if URL already exists
      const existing = await this.db
        .select()
        .from(documents)
        .where(eq(documents.url, data.url))
        .limit(1);

      if (existing.length > 0) {
        // URL exists - update timestamp and set active.
        //
        // T-403 M6: also RE-TYPE when the incoming classification is a
        // permitted refinement of the stored one. Without this the classifier
        // fix was forward-only: a final Prospectus already stored as RHP, or a
        // corrigendum stored as ADDENDUM, stayed wrong forever, and a second
        // type resolving to the same URL silently adopted the first type's row.
        // The allowlist is closed and one-directional, so a classifier
        // regression cannot relabel the corpus (see document-type-refinement.ts).
        const currentType = String(existing[0].type);
        const incomingType = String(data.type);
        const shouldRetype = isMoreSpecificDocumentType(currentType, incomingType);

        const [updated] = await this.db
          .update(documents)
          .set({
            updatedAt: new Date(),
            isActive: true,
            ...(shouldRetype ? { type: data.type } : {}),
            // W-1: fill the hash in on a row stored before this column existed,
            // and refresh it when the bytes at a URL change (a corrigendum
            // re-published under the same file name is a real occurrence).
            // Never overwrite a known hash with nothing.
            ...(data.sha256 ? { sha256: data.sha256 } : {}),
          })
          .where(eq(documents.url, data.url))
          .returning();

        // Invalidate cache
        await this.deleteCache(getDocumentsKey(data.ipoId));

        return updated;
      }

      // Get next sequence number for this document type + mediaType + exchange combination
      const sequenceResult = await this.db
        .select({ maxSequence: max(documents.sequenceNumber) })
        .from(documents)
        .where(
          and(
            eq(documents.ipoId, data.ipoId),
            eq(documents.type, data.type),
            eq(documents.mediaType, data.mediaType || 'PDF'),
            eq(documents.exchange, data.exchange || 'BSE')
          )
        );

      const currentMax = sequenceResult[0]?.maxSequence ?? 0;
      const nextSequence = currentMax + 1;

      // Insert new document with sequence number
      const [newDocument] = await this.db
        .insert(documents)
        .values({
          ...data,
          sequenceNumber: nextSequence,
        })
        .returning();

      // Invalidate cache
      await this.deleteCache(getDocumentsKey(data.ipoId));

      return newDocument;
    } catch (error) {
      throw new DatabaseError(
        'Failed to upsert document',
        undefined,
        error
      );
    }
  }

  /**
   * Upsert multiple documents in batch
   * Returns success and failure counts
   */
  async upsertDocuments(
    docs: DocumentInsert[]
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const doc of docs) {
      try {
        await this.upsertDocument(doc);
        success++;
      } catch (error) {
        failed++;
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        errors.push(`${doc.title}: ${errorMsg}`);
      }
    }

    return { success, failed, errors };
  }
}
