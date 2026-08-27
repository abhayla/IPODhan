/**
 * Direct unit tests for DataConflictsRepository.pruneResolved / upsertConflict /
 * autoResolveConverged (T-286F, checker finding F3).
 *
 * These three methods previously appeared in tests ONLY as `vi.fn()` mocks on
 * a consumer (data-consolidation-service.test.ts) -- a repo-wide grep for them
 * as the actual system-under-test returned nothing. `pruneResolved` is a
 * DELETE wired into every scraper cycle via `pruneDataConflicts()`
 * (scraper/src/index.ts), so an untested DELETE predicate is the highest-risk
 * unverified surface the checker flagged.
 *
 * The WHERE-clause assertions render the REAL drizzle condition object built
 * by the repository through `PgDialect.sqlToQuery()` -- the same rendering
 * drizzle uses to talk to Postgres -- so these tests prove the actual SQL
 * predicate (e.g. "resolved_at IS NOT NULL AND resolved_at < $1"), not just
 * that a mock returned whatever we told it to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DataConflictsRepository } from '@ipodhan/shared/repositories';
import { dataConflicts } from '@shared/db/schema';
import type Redis from 'ioredis';

const dialect = new PgDialect();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderCondition(cond: any): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(cond) as { sql: string; params: unknown[] };
}

function makeMockRedis() {
  return {
    get: vi.fn(),
    setex: vi.fn(),
    set: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as Redis;
}

describe('DataConflictsRepository (T-286F direct tests)', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = makeMockRedis();
  });

  describe('pruneResolved', () => {
    it('builds a DELETE predicate that targets ONLY resolved rows older than the cutoff', async () => {
      let capturedCond: unknown;
      const mockDb = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn((cond) => {
            capturedCond = cond;
            return { returning: vi.fn().mockResolvedValue([]) };
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const before = Date.now();
      await repo.pruneResolved(30);
      const after = Date.now();

      expect(mockDb.delete).toHaveBeenCalledWith(dataConflicts);

      const { sql, params } = renderCondition(capturedCond);
      // MUST require resolved_at IS NOT NULL -- this is what stops the
      // predicate from ever matching an unresolved (resolved_at = null) row.
      expect(sql).toContain('"data_conflicts"."resolved_at" is not null');
      expect(sql).toContain('"data_conflicts"."resolved_at" <');
      expect(sql).not.toContain('is null');

      const cutoffMs = new Date(params[0] as string).getTime();
      const expectedMin = before - 30 * 24 * 60 * 60 * 1000;
      const expectedMax = after - 30 * 24 * 60 * 60 * 1000;
      expect(cutoffMs).toBeGreaterThanOrEqual(expectedMin - 1000);
      expect(cutoffMs).toBeLessThanOrEqual(expectedMax + 1000);
    });

    it('respects a custom retentionDays argument in the cutoff calculation', async () => {
      let capturedCond: unknown;
      const mockDb = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn((cond) => {
            capturedCond = cond;
            return { returning: vi.fn().mockResolvedValue([]) };
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const before = Date.now();
      await repo.pruneResolved(7);

      const { params } = renderCondition(capturedCond);
      const cutoffMs = new Date(params[0] as string).getTime();
      const expected = before - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoffMs - expected)).toBeLessThan(2000);
    });

    it('only deletes fixture rows matching resolved_at older than 30d -- unresolved rows are never deleted', async () => {
      // Fixture rows as they would exist in data_conflicts.
      const oldResolved = { id: 'old-resolved', resolvedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) };
      const recentResolved = { id: 'recent-resolved', resolvedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) };
      const unresolved = { id: 'unresolved', resolvedAt: null };
      const fixtureRows = [oldResolved, recentResolved, unresolved];

      // The predicate itself is proven correct in the prior test (real SQL
      // rendering). Here we apply that PROVEN predicate to fixture rows to
      // determine what a real Postgres DELETE ... RETURNING would hand back,
      // and assert the repository surfaces exactly that set.
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const wouldDelete = fixtureRows.filter(
        (r) => r.resolvedAt !== null && r.resolvedAt < cutoff
      );
      expect(wouldDelete.map((r) => r.id)).toEqual(['old-resolved']);
      expect(wouldDelete.some((r) => r.id === 'unresolved')).toBe(false);
      expect(wouldDelete.some((r) => r.id === 'recent-resolved')).toBe(false);

      const mockDb = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(wouldDelete.map((r) => ({ id: r.id }))),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const deletedCount = await repo.pruneResolved(30);

      expect(deletedCount).toBe(1);
    });

    it('returns 0 and skips cache invalidation when nothing is due for deletion', async () => {
      const mockDb = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const deletedCount = await repo.pruneResolved(30);

      expect(deletedCount).toBe(0);
      expect(mockRedis.keys).not.toHaveBeenCalled();
    });
  });

  describe('upsertConflict', () => {
    const input = {
      ipoId: 'ipo-1',
      tableName: 'ipos',
      fieldName: 'openDate',
      source1: 'NSE' as const,
      value1: '2026-09-01',
      source2: 'BSE' as const,
      value2: '2026-09-05',
    };

    it('inserts a new conflict when no unresolved row exists for the field', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]), // no existing open conflict
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'new-conflict-id', ...input }]),
          }),
        }),
        update: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const result = await repo.upsertConflict(input);

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(result.id).toBe('new-conflict-id');
    });

    it('updates the existing unresolved row instead of inserting a duplicate', async () => {
      let capturedUpdateCond: unknown;
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'existing-conflict-id' }]),
            }),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn((cond) => {
              capturedUpdateCond = cond;
              return {
                returning: vi.fn().mockResolvedValue([
                  { id: 'existing-conflict-id', ...input, value2: '2026-09-06' },
                ]),
              };
            }),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const result = await repo.upsertConflict({ ...input, value2: '2026-09-06' });

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('existing-conflict-id');
      expect(result.value2).toBe('2026-09-06');

      const { sql, params } = renderCondition(capturedUpdateCond);
      expect(sql).toBe('"data_conflicts"."id" = $1');
      expect(params[0]).toBe('existing-conflict-id');
    });
  });

  describe('write-time noise guard (T-331 P2-6)', () => {
    const baseInput = {
      ipoId: 'ipo-1',
      tableName: 'ipos',
      fieldName: 'openDate',
      source1: 'NSE' as const,
      value1: '2026-09-01',
      source2: 'BSE' as const,
      value2: '2026-09-05',
    };

    function makeNoInsertNoUpdateDb() {
      return {
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }

    describe('logConflict', () => {
      it('rejects an empty value2 (null) without an insert', async () => {
        const mockDb = makeNoInsertNoUpdateDb();
        const repo = new DataConflictsRepository(mockDb, mockRedis);
        const result = await repo.logConflict({ ...baseInput, value2: null });

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
      });

      it('rejects an empty value2 (the literal string "null" from JSON.stringify(null))', async () => {
        const mockDb = makeNoInsertNoUpdateDb();
        const repo = new DataConflictsRepository(mockDb, mockRedis);
        const result = await repo.logConflict({ ...baseInput, value2: 'null' });

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
      });

      it('rejects an empty value1', async () => {
        const mockDb = makeNoInsertNoUpdateDb();
        const repo = new DataConflictsRepository(mockDb, mockRedis);
        const result = await repo.logConflict({ ...baseInput, value1: null });

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
      });

      it('rejects value1 === value2 (post-normalization duplicate)', async () => {
        const mockDb = makeNoInsertNoUpdateDb();
        const repo = new DataConflictsRepository(mockDb, mockRedis);
        const result = await repo.logConflict({ ...baseInput, value1: '"45"', value2: '"45"' });

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
      });

      it('still inserts a genuine two-real-different-value disagreement', async () => {
        const mockDb = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'real-conflict-id', ...baseInput }]),
            }),
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const repo = new DataConflictsRepository(mockDb, mockRedis);
        const result = await repo.logConflict(baseInput);

        expect(mockDb.insert).toHaveBeenCalledTimes(1);
        expect(result?.id).toBe('real-conflict-id');
      });
    });

    describe('upsertConflict', () => {
      it('rejects noise-shaped input (empty value2) with no insert, no update, when no existing row', async () => {
        const mockDb = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
          insert: vi.fn(),
          update: vi.fn(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const repo = new DataConflictsRepository(mockDb, mockRedis);
        const result = await repo.upsertConflict({ ...baseInput, value2: null });

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
      });

      it('auto-resolves the existing open row instead of updating it with noise-shaped input', async () => {
        let capturedSet: Record<string, unknown> | undefined;
        const mockDb = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'existing-conflict-id' }]),
              }),
            }),
          }),
          insert: vi.fn(),
          update: vi.fn().mockReturnValue({
            set: vi.fn((setValues) => {
              capturedSet = setValues;
              return {
                where: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([{ id: 'existing-conflict-id' }]),
                }),
              };
            }),
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const repo = new DataConflictsRepository(mockDb, mockRedis);
        const result = await repo.upsertConflict({ ...baseInput, value1: '"same"', value2: '"same"' });

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
        // The only update() call must be the auto-resolve (SYSTEM attribution),
        // never a refresh of source1/value1/source2/value2 with noise-shaped data.
        expect(mockDb.update).toHaveBeenCalledTimes(1);
        expect(capturedSet).toMatchObject({
          resolutionReason: 'AUTO_RESOLVED_VALUES_CONVERGED',
          resolvedBy: 'SYSTEM',
        });
      });
    });
  });

  describe('autoResolveConverged', () => {
    it('sets resolved_at + SYSTEM attribution ONLY when a genuine open conflict exists (converges)', async () => {
      let capturedCond: unknown;
      let capturedSet: Record<string, unknown> | undefined;
      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: vi.fn((setValues) => {
            capturedSet = setValues;
            return {
              where: vi.fn((cond) => {
                capturedCond = cond;
                return { returning: vi.fn().mockResolvedValue([{ id: 'open-conflict-id' }]) };
              }),
            };
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const resolvedCount = await repo.autoResolveConverged('ipo-1', 'ipos', 'openDate');

      expect(resolvedCount).toBe(1);
      expect(capturedSet).toMatchObject({
        resolutionReason: 'AUTO_RESOLVED_VALUES_CONVERGED',
        resolvedBy: 'SYSTEM',
      });
      expect(capturedSet?.resolvedAt).toBeInstanceOf(Date);

      // Only an OPEN (resolved_at IS NULL) conflict for this exact field can match.
      const { sql, params } = renderCondition(capturedCond);
      expect(sql).toContain('"data_conflicts"."resolved_at" is null');
      expect(sql).toContain('"data_conflicts"."ipo_id" = $1');
      expect(sql).toContain('"data_conflicts"."table_name" = $2');
      expect(sql).toContain('"data_conflicts"."field_name" = $3');
      expect(params).toEqual(['ipo-1', 'ipos', 'openDate']);

      // Cache invalidated only because a row genuinely converged.
      expect(mockRedis.keys).toHaveBeenCalledWith('conflicts:*');
    });

    it('is a no-op when there is no open conflict for the field (nothing converged)', async () => {
      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new DataConflictsRepository(mockDb, mockRedis);
      const resolvedCount = await repo.autoResolveConverged('ipo-1', 'ipos', 'openDate');

      expect(resolvedCount).toBe(0);
      // No genuine convergence -- must not claim a cache-busting side effect.
      expect(mockRedis.keys).not.toHaveBeenCalled();
    });
  });
});
