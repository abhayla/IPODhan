// implements: OD-32 (item 18 slice 1 — extracted text survives the PDF)
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { documentPages, documents } from '@ipodhan/shared/db/schema';

/**
 * Item 18 slice 1. OD-32 changes when a stored PDF is deleted. That is only
 * safe if the text extracted from it outlives it — otherwise the purge destroys
 * the only copy of information the site depends on, and "re-run on the stored
 * text", which is OD-32's own answer to the counter-case, has nothing to run on.
 *
 * So the table lands FIRST, in its own slice, ahead of any change to the purge
 * schedule. Shipping the schedule first would delete PDFs whose text had nowhere
 * to go.
 *
 * These assertions read the REAL drizzle table config rather than the migration
 * SQL, because the schema object is what the application actually queries
 * through; a migration that matched a hand-written SQL string but not the schema
 * would still break every read.
 *
 * NOTE ON WHERE THIS RUNS: this file imports `@ipodhan/shared` by the BARE
 * alias, which vitest resolves through node_modules rather than its own alias
 * table. In a worktree whose node_modules is a plain junction to the main
 * checkout, that resolves to MAIN's schema and this test would silently pass
 * against code the slice never changed. This tree was re-pointed with
 * wt-link-modules.ps1 and marker-probed under vitest before this slice was
 * written (2026-09-10).
 */

describe('document_pages exists and is shaped so text can outlive the PDF', () => {
  const cfg = getTableConfig(documentPages);
  const col = (name: string) => cfg.columns.find(c => c.name === name);

  it('is a real table named document_pages', () => {
    expect(cfg.name).toBe('document_pages');
  });

  it('keys every page to its document, and CASCADES so a deleted document leaves no orphans', () => {
    const documentId = col('document_id');
    expect(documentId).toBeDefined();
    expect(documentId!.notNull).toBe(true);

    const fk = cfg.foreignKeys.find(f => f.reference().foreignTable === documents);
    expect(fk, 'document_pages must reference documents').toBeDefined();
    expect(fk!.onDelete).toBe('cascade');
  });

  it('stores one row per PAGE, not one blob per document', () => {
    // Page granularity is load-bearing: a page-numbered citation is what the
    // re-read loop depends on, and a partial re-extraction must be able to
    // replace only the pages that changed.
    expect(col('page_number')).toBeDefined();
    expect(col('page_number')!.notNull).toBe(true);
    expect(col('text')).toBeDefined();
    expect(col('text')!.notNull).toBe(true);
  });

  it('refuses two rows for the same page of the same document', () => {
    const uniques = cfg.uniqueConstraints.map(u => u.name);
    expect(uniques).toContain('unique_page_per_document');
  });

  it('indexes document_id, because every read is by document', () => {
    const indexes = cfg.indexes.map(i => i.config.name);
    expect(indexes).toContain('idx_document_pages_document_id');
  });
});

describe('documents records a purge that destroyed unread text', () => {
  it('has purged_unread, defaulting false and NOT NULL, so the failure is visible not silent', () => {
    const cfg = getTableConfig(documents);
    const purged = cfg.columns.find(c => c.name === 'purged_unread');
    expect(purged, 'documents.purged_unread must exist').toBeDefined();
    expect(purged!.notNull).toBe(true);
    expect(purged!.hasDefault).toBe(true);
  });
});
