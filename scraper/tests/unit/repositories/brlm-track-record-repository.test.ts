/**
 * Direct unit tests for BrlmTrackRecordRepository.
 *
 * T-431 (T-428 review carry-over): `upsert` is now a SINGLE atomic
 * INSERT ... ON CONFLICT DO UPDATE on the unique
 * (brlm_name, as_of_date, source_ipo_id) -- it used to be check-then-write,
 * which loses an update when two filing extractions read the same BRLM's
 * 3-year table at once. These tests assert the values array and the conflict
 * target actually handed to drizzle, not merely that some call happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrlmTrackRecordRepository } from '@ipodhan/shared/repositories';
import { brlmTrackRecord } from '@ipodhan/shared/db/schema';
import type Redis from 'ioredis';

function makeMockRedis() {
  return {
    get: vi.fn(),
    setex: vi.fn(),
    set: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  } as unknown as Redis;
}

function makeMockDb(returned: unknown[]) {
  const captured: { values?: unknown; conflict?: any } = {};
  const mockDb = {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn().mockReturnValue({
      values: vi.fn((row: unknown) => {
        captured.values = row;
        return {
          onConflictDoUpdate: vi.fn((cfg: any) => {
            captured.conflict = cfg;
            return { returning: vi.fn().mockResolvedValue(returned) };
          }),
        };
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { mockDb, captured };
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

    it('writes the row in ONE statement, with the exact values handed to drizzle', async () => {
      const { mockDb, captured } = makeMockDb([{ id: 'b-1', ...row }]);
      const repo = new BrlmTrackRecordRepository(mockDb, mockRedis);
      const result = await repo.upsert(row);

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(captured.values).toEqual(row);
      // The old implementation read first, then branched -- proving no read
      // happens is what proves the race is gone, not just that insert ran.
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(result.id).toBe('b-1');
    });

    it('resolves the conflict on (brlmName, asOfDate, sourceIpoId) and updates only the figures', async () => {
      const { mockDb, captured } = makeMockDb([{ id: 'b-1', ...row, issues3y: 13 }]);
      const repo = new BrlmTrackRecordRepository(mockDb, mockRedis);
      const result = await repo.upsert({ ...row, issues3y: 13 });

      expect(captured.conflict.target).toEqual([
        brlmTrackRecord.brlmName,
        brlmTrackRecord.asOfDate,
        brlmTrackRecord.sourceIpoId,
      ]);
      // sourceIpoId is provenance and part of the key -- it must never be
      // rewritten by a conflicting write from another filing.
      expect(Object.keys(captured.conflict.set).sort()).toEqual([
        'closedBelowIssuePrice',
        'issues3y',
        'updatedAt',
      ]);
      expect(captured.conflict.set.issues3y).toBe(13);
      expect(result.issues3y).toBe(13);
    });

    it('invalidates the by-brlm-name cache after a successful upsert', async () => {
      const { mockDb } = makeMockDb([{ id: 'b-1', ...row }]);
      const repo = new BrlmTrackRecordRepository(mockDb, mockRedis);
      await repo.upsert(row);

      expect(mockRedis.del).toHaveBeenCalledWith(`brlm-track-record:name:${row.brlmName}`);
    });
  });
});
