/**
 * In-memory implementation of `IDocumentFetchStateStore` — T-403.
 *
 * Not a test double bolted on afterwards: it is the reason the runner takes a
 * STORE interface at all. The behaviour WP B has to prove — "an IPO whose
 * documents are all found costs zero network calls on the next cycle" — is a
 * property of the state transitions, and it must be demonstrable against real
 * exchange payloads without a database in the loop. It is also what let the
 * acceptance harness keep running when the dev database host went down
 * (owner incident, 2026-08-28).
 *
 * Semantics match the Postgres implementation exactly, including the
 * (ipo_id, doc_type) uniqueness that `ensureRow` upserts on.
 */

import { randomUUID } from 'node:crypto';
import type {
  DocumentFetchStatePatch,
  DocumentFetchStateRow,
  IDocumentFetchStateStore,
} from '@ipodhan/shared/repositories/document-fetch-state-repository';

export class InMemoryDocumentFetchStateStore implements IDocumentFetchStateStore {
  /** Keyed `${ipoId}::${docType}` — the table's unique constraint. */
  private readonly rows = new Map<string, DocumentFetchStateRow>();

  private key(ipoId: string, docType: string): string {
    return `${ipoId}::${docType}`;
  }

  async listForIpo(ipoId: string): Promise<DocumentFetchStateRow[]> {
    return [...this.rows.values()].filter((r) => r.ipoId === ipoId);
  }

  async ensureRow(ipoId: string, docType: string): Promise<DocumentFetchStateRow> {
    const key = this.key(ipoId, docType);
    const existing = this.rows.get(key);
    if (existing) return existing;

    const now = new Date();
    const row: DocumentFetchStateRow = {
      id: randomUUID(),
      ipoId,
      docType,
      state: 'WANTED',
      documentId: null,
      attempts: 0,
      lastAttemptAt: null,
      nextRetryAt: null,
      lastAttempt: null,
      firstSeenAt: now,
      blockedSinceAt: null,
      extractedAt: null,
      extractorVersion: null,
      filingDate: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(key, row);
    return row;
  }

  async update(id: string, patch: DocumentFetchStatePatch): Promise<DocumentFetchStateRow> {
    for (const [key, row] of this.rows) {
      if (row.id !== id) continue;
      const updated: DocumentFetchStateRow = { ...row, ...patch, updatedAt: new Date() };
      this.rows.set(key, updated);
      return updated;
    }
    throw new Error(`document_fetch_state row not found: ${id}`);
  }

  async markSuperseded(ipoId: string, docTypes: string[]): Promise<number> {
    let n = 0;
    for (const docType of docTypes) {
      const key = this.key(ipoId, docType);
      const row = this.rows.get(key);
      if (!row) continue;
      this.rows.set(key, { ...row, state: 'SUPERSEDED', updatedAt: new Date() });
      n++;
    }
    return n;
  }

  /** Every row, for evidence dumps and assertions. */
  all(): DocumentFetchStateRow[] {
    return [...this.rows.values()];
  }
}
