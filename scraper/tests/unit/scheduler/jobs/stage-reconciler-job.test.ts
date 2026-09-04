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
import {
  RECONCILER_PRESENCE_SQL,
  getStaleClosedDays,
  planStaleClosedLog,
} from '../../../../src/scheduler/jobs/stage-reconciler-job.js';

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

  // W-127: close_date/listing_date are needed to detect stale-CLOSED rows.
  it('references close_date and listing_date (W-127 stale-CLOSED detection)', () => {
    const referenced = [...RECONCILER_PRESENCE_SQL.matchAll(/\bi\.([a-zA-Z_]+)\b/g)].map((m) => m[1]);
    expect(referenced).toContain('close_date');
    expect(referenced).toContain('listing_date');
  });
});

describe('getStaleClosedDays', () => {
  it('defaults to 30 when STALE_CLOSED_DAYS is unset', () => {
    expect(getStaleClosedDays({})).toBe(30);
  });

  it('reads a positive override from STALE_CLOSED_DAYS', () => {
    expect(getStaleClosedDays({ STALE_CLOSED_DAYS: '45' })).toBe(45);
  });

  it('falls back to the default on a non-numeric or non-positive value', () => {
    expect(getStaleClosedDays({ STALE_CLOSED_DAYS: 'abc' })).toBe(30);
    expect(getStaleClosedDays({ STALE_CLOSED_DAYS: '0' })).toBe(30);
    expect(getStaleClosedDays({ STALE_CLOSED_DAYS: '-5' })).toBe(30);
  });
});

describe('W-127 MINOR-3: planStaleClosedLog — count + sample every cycle, full list only when the count changed', () => {
  const rows = [
    { id: 'a', companyName: 'Alpha', closeDate: '2026-08-01' },
    { id: 'b', companyName: 'Beta', closeDate: '2026-08-02' },
  ];

  it('returns null when there are no stale-CLOSED rows', () => {
    expect(planStaleClosedLog([], 30, null)).toBeNull();
    expect(planStaleClosedLog([], 30, 5)).toBeNull();
  });

  it('attaches the full list on the first cycle (no previous count)', () => {
    const out = planStaleClosedLog(rows, 30, null);
    expect(out?.fields).toMatchObject({ staleClosedCount: 2, staleClosedSample: rows });
    expect(out?.fields.staleClosedIpos).toEqual(rows);
    expect(out?.message).toContain('count changed');
  });

  it('omits the full list when the count is unchanged since the previous cycle', () => {
    const out = planStaleClosedLog(rows, 30, 2);
    expect(out?.fields).toMatchObject({ staleClosedCount: 2 });
    expect(out?.fields).not.toHaveProperty('staleClosedIpos');
    expect(out?.message).toContain('count unchanged');
  });

  it('attaches the full list again once the count changes', () => {
    const out = planStaleClosedLog(rows, 30, 1);
    expect(out?.fields.staleClosedIpos).toEqual(rows);
    expect(out?.message).toContain('count changed');
  });

  it('the sample is capped at 5 rows regardless of list size', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `id-${i}`, companyName: `C${i}`, closeDate: null }));
    const out = planStaleClosedLog(many, 30, 8);
    expect((out?.fields.staleClosedSample as unknown[]).length).toBe(5);
    expect(out?.fields).not.toHaveProperty('staleClosedIpos');
  });
});
