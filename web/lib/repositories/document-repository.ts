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
import { documents } from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import { CacheTTL, getDocumentsKey } from '../cache/cache-keys';
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
}
