/**
 * Direct unit tests for BrlmTrackRecordRepository (T-428 WP C-1).
 *
 * `upsert` is check-then-write (no DB unique constraint on brlmName+asOfDate)
 * -- these tests prove BOTH branches: insert when nothing matches, update
 * when a (brlmName, asOfDate) row already exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrlmTrackRecordRepository } from '@ipodhan/shared/repositories';
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

describe('BrlmTrackRecordRepository', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = makeMockRedis();
  });

  describe('upsert', () => {
    const row = {
      brlmName: 'Acme Capital',
      asOfDate: '2026-08-01',
      issues3y: 12,
      closedBelowIssuePrice: 3,
      sourceIpoId: 'ipo-1',
    };

    it('inserts when no matching (brlmName, asOfDate) row exists', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'b-1', ...row }]),
          }),
        }),
        update: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new BrlmTrackRecordRepository(mockDb, mockRedis);
      const result = await repo.upsert(row);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(result.id).toBe('b-1');
    });

    it('updates in place when a matching (brlmName, asOfDate) row already exists', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'b-1', ...row }]),
            }),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'b-1', ...row, issues3y: 13 }]),
            }),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new BrlmTrackRecordRepository(mockDb, mockRedis);
      const result = await repo.upsert({ ...row, issues3y: 13 });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(result.issues3y).toBe(13);
    });

    it('invalidates the by-brlm-name cache after a successful upsert', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'b-1', ...row }]),
          }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repo = new BrlmTrackRecordRepository(mockDb, mockRedis);
      await repo.upsert(row);

      expect(mockRedis.del).toHaveBeenCalledWith(`brlm-track-record:name:${row.brlmName}`);
    });
  });
});
