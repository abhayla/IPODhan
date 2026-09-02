/**
 * Direct unit tests for FinancialStatementsRepository (T-428 WP C-1).
 *
 * Exercises the upsert shape against a mocked db: the target of the
 * onConflictDoUpdate MUST be the (ipoId, fiscalYear, basis) composite key --
 * a wrong target would silently let duplicate (ipoId, fiscalYear, basis) rows
 * accumulate instead of overwriting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinancialStatementsRepository } from '@ipodhan/shared/repositories';
import { financialStatements } from '@shared/db/schema';
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

describe('FinancialStatementsRepository', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = makeMockRedis();
  });

  describe('upsert', () => {
    const row = {
      ipoId: 'ipo-1',
      fiscalYear: 2025,
      basis: 'RESTATED' as const,
      unit: 'CRORE' as const,
      revenue: '120.50',
      totalIncome: '125.00',
      ebitda: '30.00',
      pat: '18.00',
      netWorth: '80.00',
      epsBasic: '5.20',
      epsDiluted: '5.10',
      opCashFlow: '22.00',
      dscr: '1.80',
      rentExpense: '2.00',
    };

    it('targets the (ipoId, fiscalYear, basis) composite key on conflict', async () => {
      let capturedTarget: unknown;
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn((opts) => {
              capturedTarget = opts.target;
              return { returning: vi.fn().mockResolvedValue([{ id: 'row-1', ...row }]) };
            }),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new FinancialStatementsRepository(mockDb, mockRedis);
      const result = await repo.upsert(row);

      expect(capturedTarget).toEqual([
        financialStatements.ipoId,
        financialStatements.fiscalYear,
        financialStatements.basis,
      ]);
      expect(result.id).toBe('row-1');
    });

    it('invalidates the per-IPO cache after a successful upsert', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'row-1', ...row }]),
            }),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new FinancialStatementsRepository(mockDb, mockRedis);
      await repo.upsert(row);

      expect(mockRedis.del).toHaveBeenCalledWith(`financial-statements:ipo:${row.ipoId}`);
    });

    it('wraps a db failure in a DatabaseError', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockRejectedValue(new Error('connection lost')),
            }),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new FinancialStatementsRepository(mockDb, mockRedis);
      await expect(repo.upsert(row)).rejects.toThrow('Failed to upsert financial statement');
    });
  });
});
