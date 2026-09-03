/**
 * Proves every `i.<column>` reference in the stage-reconciler-job's presence
 * SQL is a real column of the `ipos` pgTable. Found live 2026-09-03: the SQL
 * referenced `i.gmp`, a column that does not exist (the real columns are
 * `gmp_price` / `gmp_percentage_historical` / `gmp_updated_at_historical`) —
 * Postgres rejected the whole query, so the reconciler job failed on every
 * run ("Stage reconciler trigger failed (non-fatal)"), silently, because
 * ENABLE_STAGE_RECONCILER has been off in production. This test catches any
 * future column drift between this SQL string and the schema without needing
 * a live database.
 */
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { ipos } from '@ipodhan/shared/db/schema';
import { RECONCILER_PRESENCE_SQL } from '../../../../src/scheduler/jobs/stage-reconciler-job.js';

describe('stage-reconciler-job presence SQL — every i.<column> is a real ipos column', () => {
  it('references only columns that exist on the ipos pgTable', () => {
    const referenced = [...new Set([...RECONCILER_PRESENCE_SQL.matchAll(/\bi\.([a-zA-Z_]+)\b/g)].map((m) => m[1]))];

    // Sanity: the extraction itself must find a non-trivial set of references,
    // otherwise this test would pass vacuously on a broken regex.
    expect(referenced.length).toBeGreaterThanOrEqual(8);

    const columns = getTableColumns(ipos);
    const validColumnNames = new Set(Object.values(columns).map((c: any) => c.name));

    const invalid = referenced.filter((name) => !validColumnNames.has(name));
    expect(invalid).toEqual([]);
  });

  it('does NOT reference the non-existent "gmp" column (regression guard)', () => {
    const referenced = [...RECONCILER_PRESENCE_SQL.matchAll(/\bi\.([a-zA-Z_]+)\b/g)].map((m) => m[1]);
    expect(referenced).not.toContain('gmp');
    expect(referenced).toContain('gmp_price');
  });
});
