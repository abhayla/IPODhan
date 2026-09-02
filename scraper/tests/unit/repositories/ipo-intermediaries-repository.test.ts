/**
 * Direct unit tests for IpoIntermediariesRepository (T-428 WP C-1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpoIntermediariesRepository } from '@ipodhan/shared/repositories';
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

describe('IpoIntermediariesRepository', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = makeMockRedis();
  });

  describe('replaceForIpo', () => {
    const rows = [
      {
        ipoId: 'ipo-1',
        role: 'BRLM' as const,
        name: 'Acme Capital',
        sebiRegNo: 'INM000012345',
        contactPerson: 'A Manager',
        phone: '022-12345678',
        email: 'ipo@acme.example',
        grievanceEmail: 'grievance@acme.example',
      },
    ];

    it('deletes existing rows before inserting the new set, in one transaction', async () => {
      const { calls, tx } = makeMockTx([{ id: 'i-1', ...rows[0] }]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new IpoIntermediariesRepository(mockDb, mockRedis);
      const result = await repo.replaceForIpo('ipo-1', rows);

      expect(calls).toEqual(['delete', 'insert']);
      expect(result).toEqual([{ id: 'i-1', ...rows[0] }]);
    });

    it('invalidates the per-IPO cache after a successful replace', async () => {
      const { tx } = makeMockTx([{ id: 'i-1', ...rows[0] }]);
      const mockDb = {
        transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new IpoIntermediariesRepository(mockDb, mockRedis);
      await repo.replaceForIpo('ipo-1', rows);

      expect(mockRedis.del).toHaveBeenCalledWith('ipo-intermediaries:ipo:ipo-1');
    });
  });

  describe('listByIpoAndRole', () => {
    it('filters by both ipoId and role', async () => {
      let capturedCond: unknown;
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn((cond) => {
              capturedCond = cond;
              return Promise.resolve([{ id: 'i-1', role: 'BRLM' }]);
            }),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new IpoIntermediariesRepository(mockDb, mockRedis);
      const rows = await repo.listByIpoAndRole('ipo-1', 'BRLM');

      expect(capturedCond).toBeDefined();
      expect(rows).toEqual([{ id: 'i-1', role: 'BRLM' }]);
    });
  });
});
