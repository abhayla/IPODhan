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

/** A stored zip document row, as the stored-zip expansion reads it. */
export interface StoredZipRow {
  documentId: string;
  ipoId: string;
  slug: string | null;
  companyName: string;
  type: string;
  url: string;
  title: string;
  exchange: string;
  sha256: string | null;
  /** Item 22 round 4: distinct-slot failed re-fetch attempts so far. */
  zipExpandAttempts: number;
}

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
   * Invalidate the cached `findByIPO` listing for one IPO. Public so a
   * caller that writes `documents` rows through a RAW `db.update(...)`
   * (bypassing every method on this class) can still clear the cache-aside
   * key this class owns, instead of duplicating `getDocumentsKey` + a
   * `redis.del` at the call site. Fail-open on a Redis error, same as every
   * other cache invalidation in this class (`deleteCache`).
   */
  async invalidateForIpo(ipoId: string): Promise<void> {
    await this.deleteCache(getDocumentsKey(ipoId));
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
   * Item 22 (OD-33): the document of this IPO already holding these bytes, if
   * any. A zip member whose sha256 matches is not stored a second time, even
   * when the earlier copy came from another source or another day.
   */
  async findBySha256ForIpo(ipoId: string, sha256: string): Promise<{ id: string; type: string } | null> {
    try {
      const { and } = await import('drizzle-orm');
      const rows = await this.db
        .select({ id: documents.id, type: documents.type })
        .from(documents)
        .where(and(eq(documents.ipoId, ipoId), eq(documents.sha256, sha256)))
        .orderBy(documents.createdAt)
        .limit(1);
      return rows.length > 0 ? { id: rows[0].id, type: String(rows[0].type) } : null;
    } catch (error) {
      throw new DatabaseError(`Failed to look up document by sha256 for IPO: ${ipoId}`, undefined, error);
    }
  }

  /**
   * Item 22 round 3 (OD-36, F-154); reordered round 4 (Tier A MAJOR): stored
   * zip documents whose other members were never examined
   * (`zip_members_checked_at IS NULL`). The selection of the data-slot
   * stored-zip expansion pass and of `scripts/repair-zip-member-documents.ts`
   * - ONE query for both.
   *
   * Ordered by LAST ATTEMPT (never-attempted first: `zip_last_attempt_slot`
   * NULLS FIRST), never `uploaded_at`. Ordering by `uploaded_at` let one old,
   * permanently-dead zip sort first on EVERY wake forever (it never leaves
   * the selection because it never gets marked checked), starving every zip
   * behind it — the round-4 Tier A MAJOR. Ordering by last-attempt means a
   * zip that just failed rotates to the back, so the bounded per-wake pass
   * (3 zips) reaches every other zip in the backlog before it comes up again.
   * `companyName` is the IPO's, for the cover-page identity check.
   */
  async listZipsWithUncheckedMembers(options: { limit?: number; slug?: string | null } = {}): Promise<StoredZipRow[]> {
    try {
      const { sql } = await import('drizzle-orm');
      const limit = options.limit ?? null;
      const slug = options.slug ?? null;
      const result = await this.db.execute(sql`
        SELECT d.id, d.ipo_id, i.slug, i.company_name, d.type::text AS type, d.url, d.title, d.exchange, d.sha256,
               d.zip_expand_attempts
          FROM documents d
          JOIN ipos i ON i.id = d.ipo_id
         WHERE lower(d.url) LIKE '%.zip'
           AND strpos(d.url, '#') = 0
           AND d.zip_members_checked_at IS NULL
           AND (${slug}::text IS NULL OR i.slug = ${slug})
         ORDER BY d.zip_last_attempt_slot ASC NULLS FIRST, d.id
         LIMIT ${limit}
      `);
      const rows = ((result as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
      return rows.map((r) => ({
        documentId: String(r.id),
        ipoId: String(r.ipo_id),
        slug: (r.slug as string | null) ?? null,
        companyName: String(r.company_name ?? ''),
        type: String(r.type),
        url: String(r.url),
        title: String(r.title ?? ''),
        exchange: String(r.exchange ?? 'NSE'),
        sha256: r.sha256 ? String(r.sha256).trim() : null,
        zipExpandAttempts: Number(r.zip_expand_attempts ?? 0),
      }));
    } catch (error) {
      throw new DatabaseError('Failed to list stored zips with unexamined members', undefined, error);
    }
  }

  /**
   * Item 22 round 4 (Tier A MAJOR, failure class container-unwrapped-to-one-member):
   * record a failed re-fetch attempt on a stored zip, durably and once per
   * DISTINCT data slot — a wake that repeats the same transient failure
   * inside one slot (there are ~16 wakes/slot) must not burn the 3-attempt
   * budget by itself. Returns the attempts count AFTER this call, so the
   * caller can decide whether the 3rd distinct-slot failure closes the zip.
   */
  async markZipExpandAttemptFailed(documentId: string, slotEpochMinute: number, at: Date = new Date()): Promise<number> {
    try {
      const { sql } = await import('drizzle-orm');
      const result = await this.db.execute(sql`
        UPDATE documents
           SET zip_expand_attempts = CASE
                 WHEN zip_last_attempt_slot IS DISTINCT FROM ${slotEpochMinute} THEN zip_expand_attempts + 1
                 ELSE zip_expand_attempts
               END,
               zip_last_attempt_slot = ${slotEpochMinute},
               updated_at = ${at}
         WHERE id = ${documentId}
         RETURNING zip_expand_attempts
      `);
      const rows = ((result as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
      return rows.length > 0 ? Number(rows[0].zip_expand_attempts ?? 0) : 0;
    } catch (error) {
      throw new DatabaseError(`Failed to record zip expand attempt for document: ${documentId}`, undefined, error);
    }
  }

  /**
   * Item 22 round 3: this IPO's zip-member rows (url `<zip>#member=<name>`),
   * oldest first, so the runner knows which types a stored zip supplied.
   */
  async findZipMemberDocuments(ipoId: string): Promise<{ id: string; type: string; url: string }[]> {
    try {
      const { and, sql } = await import('drizzle-orm');
      const rows = await this.db
        .select({ id: documents.id, type: documents.type, url: documents.url })
        .from(documents)
        .where(and(eq(documents.ipoId, ipoId), sql`strpos(${documents.url}, '#member=') > 0`))
        .orderBy(documents.createdAt);
      return rows.map((r) => ({ id: r.id, type: String(r.type), url: r.url }));
    } catch (error) {
      throw new DatabaseError(`Failed to list zip-member documents for IPO: ${ipoId}`, undefined, error);
    }
  }

  /**
   * Item 22 round 3: record that a stored zip's other members were examined,
   * and backfill what the examination proved - the sha256 of a row stored
   * before sha256 was written (W-1; only when the row has none), and the main
   * member's zip position. Never overwrites a known hash.
   */
  async markZipMembersChecked(
    documentId: string,
    patch: { sha256?: string | null; partNumber?: number | null; at?: Date; unresolvedReason?: string | null } = {}
  ): Promise<void> {
    try {
      const { sql } = await import('drizzle-orm');
      const [row] = await this.db
        .update(documents)
        .set({
          zipMembersCheckedAt: patch.at ?? new Date(),
          updatedAt: new Date(),
          zipUnresolvedReason: patch.unresolvedReason ?? null,
          ...(patch.sha256 ? { sha256: sql`COALESCE(${documents.sha256}, ${patch.sha256})` as never } : {}),
          ...(patch.partNumber != null ? { partNumber: patch.partNumber } : {}),
        })
        .where(eq(documents.id, documentId))
        .returning({ ipoId: documents.ipoId });
      if (row) await this.deleteCache(getDocumentsKey(row.ipoId));
    } catch (error) {
      throw new DatabaseError(`Failed to mark zip members checked for document: ${documentId}`, undefined, error);
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
            // Item 22 (OD-36, F-154): fill the zip position on a row stored
            // before part_number was written. Never cleared by a caller that
            // does not know it.
            ...(data.partNumber != null ? { partNumber: data.partNumber } : {}),
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
   * Update `filing_date` on the RHP document row for an IPO (T-433 WP G4 —
   * `DocumentFilingDateWriter`). This is an UPDATE only: it never inserts a
   * `documents` row, so a filing extraction with no matching discovery-runner
   * row for `type = 'RHP'` updates zero rows rather than fabricating one.
   */
  async setFilingDateForRhp(ipoId: string, filingDate: string): Promise<number> {
    try {
      const { and } = await import('drizzle-orm');

      const updated = await this.db
        .update(documents)
        .set({ filingDate, updatedAt: new Date() })
        .where(and(eq(documents.ipoId, ipoId), eq(documents.type, 'RHP')))
        .returning({ id: documents.id });

      if (updated.length > 0) {
        await this.deleteCache(getDocumentsKey(ipoId));
      }

      return updated.length;
    } catch (error) {
      throw new DatabaseError(
        `Failed to set RHP filing date for IPO: ${ipoId}`,
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
