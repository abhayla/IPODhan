// implements: item 1 slice s18 — field_sources unique key is row-scoped
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { fieldSources, dataConflicts } from '@ipodhan/shared/db/schema';

/**
 * Item 1 slice s18. Slice s3 (#459) added `row_key` to `field_sources` but left
 * the unique constraint at the 3-column (ipo_id, table_name, field_name) key,
 * with the row-scoped version "deferred to a later slice". This is that slice.
 *
 * Why this matters, and why it is a HARD ORDERING BLOCKER ahead of s5b/s7a/s7b:
 * two rows of ONE child table (two fiscal years in `financial_statements`, two
 * promoters, two intermediaries) writing the SAME field for ONE IPO collide on
 * the 3-column key. `trackFieldUpdate`'s ON CONFLICT `set` clause does not merely
 * relabel `row_key` — it replaces `source`, `confidence` and `data_lineage`. Row B
 * DESTROYS row A's provenance and takes its place. Today no caller passes a
 * non-empty row key so the bad state is unreachable; the moment s5b lands it is
 * reachable on every multi-row IPO.
 *
 * This file reads the REAL drizzle table config rather than migration SQL,
 * because the schema object is what the application queries through. The
 * companion integration test asserts the LIVE database constraint, and the
 * repository's ON CONFLICT target, against a real Postgres — a schema object and
 * a database that disagree produce Postgres 42P10 on the first write, which is a
 * broken deploy rather than a silent bug.
 *
 * NOTE ON WHERE THIS RUNS: this file imports `@ipodhan/shared` by the BARE
 * alias, which vitest resolves through node_modules. This worktree's
 * node_modules/@ipodhan/shared was probed before this slice was written and
 * resolves INTO this worktree, not the main checkout.
 */

describe('field_sources unique key is scoped to the row, not just the field', () => {
  const cfg = getTableConfig(fieldSources);

  it('has exactly one unique constraint, still named unique_field_source_per_ipo', () => {
    expect(cfg.uniqueConstraints.map((u) => u.name)).toEqual(['unique_field_source_per_ipo']);
  });

  it('covers (ipo_id, table_name, row_key, field_name) in that order', () => {
    const unique = cfg.uniqueConstraints.find((u) => u.name === 'unique_field_source_per_ipo');
    expect(unique).toBeDefined();
    expect(unique!.columns.map((c) => c.name)).toEqual([
      'ipo_id',
      'table_name',
      'row_key',
      'field_name',
    ]);
  });
});

describe('data_conflicts is deliberately left alone', () => {
  it('has no unique constraint, so nothing there needs widening', () => {
    // Verified independently against ipodhan_staging and ipodhan_test
    // (pg_constraint: only the pkey, the FKs and a severity CHECK).
    expect(getTableConfig(dataConflicts).uniqueConstraints).toEqual([]);
  });
});
