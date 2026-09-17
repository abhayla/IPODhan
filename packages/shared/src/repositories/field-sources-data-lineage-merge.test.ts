/**
 * MAJOR-4 (Tier A review round on PR #753): `trackFieldUpdate`'s ON CONFLICT `set.dataLineage`
 * REPLACES the whole jsonb column with `input.dataLineage ?? null` -- it does not merge. S1d's
 * provenance write (`{policyOrigin}`) on a field that already carries `dataLineage.docType`
 * (written earlier by filing-persister.ts through the SAME conflict key) silently destroys the
 * docType. `filing-persister.ts:1029` reads `prior.dataLineage.docType` back and fails CLOSED
 * ("no docType -> skip") when it is missing -- so a later cover-headline write on a field that
 * is BOTH a headline field and a manifest-row field (lotSize) gets wrongly skipped.
 *
 * Same technique as field-sources-conflict-target.test.ts: drive the REAL trackFieldUpdate with
 * a stub db (no live Postgres needed) and assert what it passes as the `set` clause.
 *
 * RED on the review's HEAD (89690a4b): `set.dataLineage` is the caller's raw
 * `{policyOrigin: ...}` object, with no reference to the existing row's dataLineage at all --
 * a second write with only `{policyOrigin}` loses any `docType` a first write set.
 */
import { describe, it, expect, vi } from 'vitest';
import { FieldSourcesRepository } from './field-sources-repository';

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

describe('FieldSourcesRepository.trackFieldUpdate — dataLineage MERGE, never replace (MAJOR-4)', () => {
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
    // `set.dataLineage` — it must be a SQL expression (drizzle `SQL` instance) that merges with
    // the existing column value in Postgres.
    const isPlainReplacingObject =
      setClause.dataLineage !== null &&
      typeof setClause.dataLineage === 'object' &&
      !('queryChunks' in (setClause.dataLineage as object)) && // drizzle SQL objects carry queryChunks
      !('sql' in (setClause.dataLineage as object));
    expect(isPlainReplacingObject).toBe(false);
  });
});
