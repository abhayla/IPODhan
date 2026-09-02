/**
 * Direct unit tests for IpoRiskFactorsRepository (T-428 WP C-1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpoRiskFactorsRepository } from '@ipodhan/shared/repositories';
import type Redis from 'ioredis';

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

function makeMockTx(insertedRows: unknown[]) {
  const calls: string[] = [];
  // T-431 (T-428 review carry-over): capture the array actually handed to
  // .values(). Asserting only the delete-then-insert call ORDER lets a repository
  // that inserts the WRONG rows -- or a truncated set -- pass green.
  const valuesArgs: unknown[][] = [];
  return {
    calls,
    valuesArgs,
    tx: {
      delete: vi.fn().mockReturnValue({
        where: vi.fn(() => {
          calls.push('delete');
          return Promise.resolve([]);
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn((rows: unknown[]) => {
          valuesArgs.push(rows);
          return {
            returning: vi.fn(() => {
              calls.push('insert');
              return Promise.resolve(insertedRows);
            }),
          };
        }),
      }),
    },
  };
}

describe('IpoRiskFactorsRepository', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = makeMockRedis();
  });

  describe('replaceForIpo', () => {
    const rows = [
      { ipoId: 'ipo-1', seq: 1, heading: 'Customer concentration', body: 'Top 5 customers...', kpis: null },
      { ipoId: 'ipo-1', seq: 2, heading: 'Litigation', body: 'Ongoing cases...', kpis: null },
    ];

    it('deletes existing rows before inserting the new set, in one transaction', async () => {
      const { calls, valuesArgs, tx } = makeMockTx(rows.map((r, i) => ({ id: `rf-${i}`, ...r })));
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new IpoRiskFactorsRepository(mockDb, mockRedis);
      const result = await repo.replaceForIpo('ipo-1', rows);

      expect(calls).toEqual(['delete', 'insert']);
      expect(valuesArgs).toHaveLength(1);
      expect(valuesArgs[0]).toEqual(rows);
      expect(result).toHaveLength(2);
    });

    it('skips the insert call (but still deletes) when replacing with an empty list', async () => {
      const { calls, tx } = makeMockTx([]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new IpoRiskFactorsRepository(mockDb, mockRedis);
      const result = await repo.replaceForIpo('ipo-1', []);

      expect(calls).toEqual(['delete']);
      expect(result).toEqual([]);
    });

    it('invalidates the per-IPO cache after a successful replace', async () => {
      const { tx } = makeMockTx(rows.map((r, i) => ({ id: `rf-${i}`, ...r })));
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new IpoRiskFactorsRepository(mockDb, mockRedis);
      await repo.replaceForIpo('ipo-1', rows);

      expect(mockRedis.del).toHaveBeenCalledWith('ipo-risk-factors:ipo:ipo-1');
    });
  });
});
