/**
 * Direct unit tests for IpoValuationRepository (T-428 WP C-1).
 *
 * The onConflictDoUpdate target MUST be (ipoId, pricingEvent) -- a wrong
 * target would let PRICE_BAND_AD and PROSPECTUS rows collide onto one row
 * instead of coexisting as separate pricing events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpoValuationRepository } from '@ipodhan/shared/repositories';
import { ipoValuation } from '@shared/db/schema';
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

describe('IpoValuationRepository', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = makeMockRedis();
  });

  describe('upsert', () => {
    const row = {
      ipoId: 'ipo-1',
      pricingEvent: 'PRICE_BAND_AD' as const,
      priceFloor: '95.00',
      priceCap: '100.00',
      sharesAtFloor: '1000000',
      sharesAtCap: '950000',
      mcapAtFloor: '95000000',
      mcapAtCap: '95000000',
      peAtFloor: '18.5',
      peAtCap: '19.5',
      peNotAscertainableReason: null,
      ronwWeighted3y: '22.0',
      faceValueMultipleFloor: '9.5',
      faceValueMultipleCap: '10.0',
    };

    it('targets the (ipoId, pricingEvent) composite key on conflict', async () => {
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

      const repo = new IpoValuationRepository(mockDb, mockRedis);
      const result = await repo.upsert(row);

      expect(capturedTarget).toEqual([ipoValuation.ipoId, ipoValuation.pricingEvent]);
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

      const repo = new IpoValuationRepository(mockDb, mockRedis);
      await repo.upsert(row);

      expect(mockRedis.del).toHaveBeenCalledWith(`ipo-valuation:ipo:${row.ipoId}`);
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

      const repo = new IpoValuationRepository(mockDb, mockRedis);
      await expect(repo.upsert(row)).rejects.toThrow('Failed to upsert IPO valuation row');
    });
  });
});
