/**
 * Direct unit tests for PromotersRepository (T-428 WP C-1).
 *
 * Both `replacePromoters` and `replaceAcquisitionRanges` MUST delete the
 * existing rows for the IPO before inserting the new set, inside the SAME
 * transaction -- a delete outside the transaction (or a missing delete)
 * would let stale promoter rows survive a re-extraction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromotersRepository } from '@ipodhan/shared/repositories';
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

/** A tx double that records call order so we can assert delete-before-insert. */
function makeMockTx(insertedRows: unknown[]) {
  const calls: string[] = [];
  return {
    calls,
    tx: {
      delete: vi.fn().mockReturnValue({
        where: vi.fn(() => {
          calls.push('delete');
          return Promise.resolve([]);
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn(() => {
            calls.push('insert');
            return Promise.resolve(insertedRows);
          }),
        }),
      }),
    },
  };
}

describe('PromotersRepository', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = makeMockRedis();
  });

  describe('replacePromoters', () => {
    const rows = [
      { ipoId: 'ipo-1', name: 'Jane Doe', sharesHeld: 1000000, waca: '5.00', wacaLastYear: '4.50', isPromoterGroup: true },
    ];

    it('deletes the existing rows before inserting the new set, in one transaction', async () => {
      const { calls, tx } = makeMockTx([{ id: 'p-1', ...rows[0] }]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new PromotersRepository(mockDb, mockRedis);
      const result = await repo.replacePromoters('ipo-1', rows);

      expect(calls).toEqual(['delete', 'insert']);
      expect(result).toEqual([{ id: 'p-1', ...rows[0] }]);
    });

    it('skips the insert call (but still deletes) when replacing with an empty list', async () => {
      const { calls, tx } = makeMockTx([]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new PromotersRepository(mockDb, mockRedis);
      const result = await repo.replacePromoters('ipo-1', []);

      expect(calls).toEqual(['delete']);
      expect(result).toEqual([]);
    });

    it('invalidates the per-IPO cache after a successful replace', async () => {
      const { tx } = makeMockTx([{ id: 'p-1', ...rows[0] }]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new PromotersRepository(mockDb, mockRedis);
      await repo.replacePromoters('ipo-1', rows);

      expect(mockRedis.del).toHaveBeenCalledWith('promoters:ipo:ipo-1');
    });
  });

  describe('replaceAcquisitionRanges', () => {
    const rows = [
      { ipoId: 'ipo-1', period: '3Y' as const, waca: '5.00', capMultiple: '19.5', priceLow: '90.00', priceHigh: '100.00' },
    ];

    it('deletes the existing rows before inserting the new set, in one transaction', async () => {
      const { calls, tx } = makeMockTx([{ id: 'r-1', ...rows[0] }]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new PromotersRepository(mockDb, mockRedis);
      const result = await repo.replaceAcquisitionRanges('ipo-1', rows);

      expect(calls).toEqual(['delete', 'insert']);
      expect(result).toEqual([{ id: 'r-1', ...rows[0] }]);
    });

    it('invalidates the acquisition-ranges cache key after a successful replace', async () => {
      const { tx } = makeMockTx([{ id: 'r-1', ...rows[0] }]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new PromotersRepository(mockDb, mockRedis);
      await repo.replaceAcquisitionRanges('ipo-1', rows);

      expect(mockRedis.del).toHaveBeenCalledWith('promoter-acquisition-ranges:ipo:ipo-1');
    });
  });
});
