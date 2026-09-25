/**
 * #755 (mirrors packages/shared's field-sources-data-lineage-merge.test.ts, PR #753 MAJOR-4):
 * the WEB copy of `trackFieldUpdate` (`web/lib/repositories/field-sources-repository.ts`) had
 * the same unfixed ON CONFLICT `set.dataLineage` — it REPLACED the whole jsonb column with
 * `input.dataLineage ?? null` instead of merging, destroying keys another writer had set
 * (`filing-persister.ts` writes `dataLineage.docType`; losing it makes a later cover-headline
 * write hit the "no docType => fail closed" branch and be wrongly skipped).
 *
 * Same technique as field-sources-conflict-target.test.ts: drive the REAL trackFieldUpdate with
 * a stub db (no live Postgres needed) and assert what it passes as the `set` clause.
 *
 * RED before the fix: `set.dataLineage` was the caller's raw `{policyOrigin}` object, with no
 * reference to the existing row's dataLineage at all — a second write with only
 * `{policyOrigin}` loses any `docType` a first write set.
 */
import { describe, it, expect, vi } from 'vitest';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';

function makeStubDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'row-1', rowKey: '' }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const db = { insert, select: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() } as unknown as never;
  return { db, onConflictDoUpdate };
}

const stubRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn().mockResolvedValue(0),
  keys: vi.fn().mockResolvedValue([]),
} as unknown as never;

describe('FieldSourcesRepository.trackFieldUpdate — dataLineage MERGE, never replace (web copy, #755)', () => {
  it('a policyOrigin-only write does not send a plain replacing object for dataLineage — it merges via SQL, preserving prior keys like docType', async () => {
    const { db, onConflictDoUpdate } = makeStubDb();
    const repo = new FieldSourcesRepository(db, stubRedis);

    await repo.trackFieldUpdate({
      ipoId: '00000000-0000-4000-8000-000000000001',
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'lotSize',
      source: 'CHITTORGARH',
      dataLineage: { policyOrigin: 'registry:2' },
    } as never);

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const setClause = onConflictDoUpdate.mock.calls[0][0].set as Record<string, unknown>;

    // The defect: a plain object here REPLACES the column wholesale on conflict, destroying any
    // docType a prior write set. The fix must not pass a bare `{policyOrigin: ...}` object as
    // `set.dataLineage` — it must be a SQL expression (drizzle SQL instance) that merges with
    // the existing column value in Postgres.
    const isPlainReplacingObject =
      setClause.dataLineage !== null &&
      typeof setClause.dataLineage === 'object' &&
      !('queryChunks' in (setClause.dataLineage as object)) && // drizzle SQL objects carry queryChunks
      !('sql' in (setClause.dataLineage as object));
    expect(isPlainReplacingObject).toBe(false);
  });
});
