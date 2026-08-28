/**
 * Document Fetch State Repository — T-403 WP B.
 *
 * The persistence side of the per-(IPO, document type) state machine described
 * in `docs/reviews/ipo-document-source-decision-matrix.md` §7. The transition
 * RULES are pure and live in `scraper/src/services/document-state-machine.ts`;
 * this class only reads and writes rows.
 *
 * Deliberately NOT cached. Every other repository extends `BaseRepository` for
 * its cache-aside read path, and this one does too for consistency of
 * construction — but its reads go straight to Postgres. The state table is the
 * scraper's memory of what it has already done: a cached "this document is
 * still WANTED" would make the cycle re-fetch a document it already has, which
 * is the exact defect WP B exists to remove. Read volume is one query per cycle.
 */

import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { documentFetchState } from '../db/schema';
import type * as schema from '../db/schema';
import { DatabaseError } from '../errors/repository-errors';

export type DocumentFetchStateValue =
  | 'WANTED'
  | 'NOT_YET_FILED'
  | 'FOUND'
  | 'EXTRACTED'
  | 'EXTRACT_FAILED'
  | 'BLOCKED_ALL'
  | 'SUPERSEDED'
  | 'NOT_APPLICABLE';

/** One attempt against one source, as recorded in `last_attempt`. */
export interface FetchAttempt {
  source: string;
  /** HTTP status; 0 for a timeout or a transport-level failure. */
  http: number;
  ms: number;
  outcome: string;
  url?: string;
}

export interface DocumentFetchStateRow {
  id: string;
  ipoId: string;
  docType: string;
  state: DocumentFetchStateValue;
  documentId: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  lastAttempt: FetchAttempt[] | null;
  firstSeenAt: Date;
  blockedSinceAt: Date | null;
  extractedAt: Date | null;
  extractorVersion: string | null;
  filingDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The fields a cycle may write back onto a state row. */
export interface DocumentFetchStatePatch {
  state?: DocumentFetchStateValue;
  documentId?: string | null;
  attempts?: number;
  lastAttemptAt?: Date | null;
  nextRetryAt?: Date | null;
  lastAttempt?: FetchAttempt[] | null;
  blockedSinceAt?: Date | null;
  extractedAt?: Date | null;
  extractorVersion?: string | null;
  filingDate?: string | null;
}

/**
 * The storage contract the discovery runner depends on.
 *
 * Declared as an interface so the runner can be exercised against an in-memory
 * store in tests and in the acceptance harness — the runner's interesting
 * behaviour ("an IPO with nothing due costs zero network calls") is about the
 * state transitions, not about Postgres, and must be provable without a database.
 */
export interface IDocumentFetchStateStore {
  listForIpo(ipoId: string): Promise<DocumentFetchStateRow[]>;
  /** Create the row if (ipoId, docType) has none; returns the existing or new row. */
  ensureRow(ipoId: string, docType: string): Promise<DocumentFetchStateRow>;
  update(id: string, patch: DocumentFetchStatePatch): Promise<DocumentFetchStateRow>;
  /** Mark every row of these types SUPERSEDED for this IPO. */
  markSuperseded(ipoId: string, docTypes: string[]): Promise<number>;
}

export class DocumentFetchStateRepository
  extends BaseRepository
  implements IDocumentFetchStateStore
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  async listForIpo(ipoId: string): Promise<DocumentFetchStateRow[]> {
    try {
      const rows = await this.db
        .select()
        .from(documentFetchState)
        .where(eq(documentFetchState.ipoId, ipoId));
      return rows as unknown as DocumentFetchStateRow[];
    } catch (error) {
      throw new DatabaseError(
        `Failed to list document fetch state for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get-or-create the (ipoId, docType) row.
   *
   * `ON CONFLICT DO UPDATE` on the unique key rather than a read-then-insert:
   * two overlapping cycles (matrix R7) would otherwise race between the SELECT
   * and the INSERT and one would die on the unique constraint. The update is a
   * deliberate no-op touch of `updated_at` so `RETURNING` always yields the row.
   */
  async ensureRow(ipoId: string, docType: string): Promise<DocumentFetchStateRow> {
    try {
      const [row] = await this.db
        .insert(documentFetchState)
        .values({ ipoId, docType: docType as never, state: 'WANTED' })
        .onConflictDoUpdate({
          target: [documentFetchState.ipoId, documentFetchState.docType],
          set: { updatedAt: new Date() },
        })
        .returning();
      return row as unknown as DocumentFetchStateRow;
    } catch (error) {
      throw new DatabaseError(
        `Failed to ensure document fetch state row for IPO ${ipoId} / ${docType}`,
        undefined,
        error
      );
    }
  }

  async update(id: string, patch: DocumentFetchStatePatch): Promise<DocumentFetchStateRow> {
    try {
      const [row] = await this.db
        .update(documentFetchState)
        .set({ ...(patch as Record<string, unknown>), updatedAt: new Date() } as never)
        .where(eq(documentFetchState.id, id))
        .returning();
      return row as unknown as DocumentFetchStateRow;
    } catch (error) {
      throw new DatabaseError(
        `Failed to update document fetch state row: ${id}`,
        undefined,
        error
      );
    }
  }

  /**
   * NOT YET CALLED — WP C wires supersession (see document-state-machine.ts's
   * header). Present because the store contract is what the runner is written
   * against; flagged rather than left looking live.
   */
  async markSuperseded(ipoId: string, docTypes: string[]): Promise<number> {
    if (docTypes.length === 0) return 0;
    try {
      const rows = await this.db
        .update(documentFetchState)
        .set({ state: 'SUPERSEDED', updatedAt: new Date() })
        .where(
          and(
            eq(documentFetchState.ipoId, ipoId),
            inArray(documentFetchState.docType, docTypes as never[])
          )
        )
        .returning({ id: documentFetchState.id });
      return rows.length;
    } catch (error) {
      throw new DatabaseError(
        `Failed to mark documents superseded for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Rows due for another attempt right now: anything still open whose
   * `next_retry_at` has passed (or was never set). Consumed by the cycle to
   * decide which IPOs are worth a network call at all.
   */
  async findDue(now: Date = new Date()): Promise<DocumentFetchStateRow[]> {
    try {
      const rows = await this.db
        .select()
        .from(documentFetchState)
        .where(
          and(
            inArray(documentFetchState.state, ['WANTED', 'NOT_YET_FILED', 'BLOCKED_ALL']),
            or(isNull(documentFetchState.nextRetryAt), lte(documentFetchState.nextRetryAt, now))
          )
        );
      return rows as unknown as DocumentFetchStateRow[];
    } catch (error) {
      throw new DatabaseError('Failed to find due document fetch state rows', undefined, error);
    }
  }

  /**
   * NOT YET CALLED — the duplicate-merge sweep will invoke this when it runs
   * with merges enabled (it is dry-run only today).
   *
   * Re-point every state row from a merged-away IPO onto the survivor (matrix
   * R8), dropping any row whose (survivor, docType) pair already exists so the
   * unique key holds. Documents are never re-fetched as a result.
   */
  async repointToSurvivor(fromIpoId: string, toIpoId: string): Promise<number> {
    try {
      const result = await this.db.execute(sql`
        WITH moved AS (
          UPDATE ${documentFetchState} s
             SET ipo_id = ${toIpoId}, updated_at = now()
           WHERE s.ipo_id = ${fromIpoId}
             AND NOT EXISTS (
               SELECT 1 FROM ${documentFetchState} t
                WHERE t.ipo_id = ${toIpoId} AND t.doc_type = s.doc_type
             )
          RETURNING s.id
        )
        SELECT count(*)::int AS n FROM moved
      `);
      const rows = (result as unknown as { rows?: { n: number }[] }).rows ?? [];
      return rows[0]?.n ?? 0;
    } catch (error) {
      throw new DatabaseError(
        `Failed to re-point document fetch state ${fromIpoId} -> ${toIpoId}`,
        undefined,
        error
      );
    }
  }
}
