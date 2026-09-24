/**
 * I4 / W-41 — the date ladder must never take a terminal status back.
 *
 * `computeTargetStatus` is a pure function of open/close/listing dates. A
 * withdrawn IPO keeps all three: its window still passes and its (never
 * happening) listing date may still sit in the row. So without a guard the
 * nightly updater walks WITHDRAWN -> CLOSED -> LISTED and republishes a dead
 * issue as a listed company — the exact class this task exists to close.
 *
 * These tests assert the ROW the guard leaves behind (no db.update call for a
 * terminal row), not merely that a boolean helper exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== MOCKS ====================

type Row = {
  id: string;
  slug: string;
  companyName: string;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  listingDate: string | null;
  scraperLocked: boolean;
};

let queryRows: Row[] = [];
const updatedRows: { id: string; set: Record<string, unknown> }[] = [];

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, value: unknown) => ({ __eq: value }),
}));

vi.mock('@/lib/db', () => {
  const ipos = new Proxy({}, { get: (_t, prop) => ({ __col: String(prop) }) });
  const db = {
    select: () => ({ from: () => Promise.resolve(queryRows) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: { __eq: string }) => {
          updatedRows.push({ id: cond.__eq, set: values });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { getDb: async () => db, ipos };
});

vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: () => ({
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('@ipodhan/shared/repositories/data-conflicts-repository', () => ({
  DataConflictsRepository: class {
    async findUnresolvedForIPO() {
      return [];
    }
  },
}));

import {
  isTerminalStatus,
  TERMINAL_STATUSES,
  updateIPOStatuses,
  getOutdatedStatusCount,
  computeTargetStatus,
} from '@/lib/services/status-updater-service';

const row = (over: Partial<Row>): Row => ({
  id: 'id-1',
  slug: 'slug-1',
  companyName: 'Test Co Ltd',
  status: 'OPEN',
  openDate: '2020-01-01',
  closeDate: '2020-01-05',
  listingDate: '2020-01-10',
  scraperLocked: false,
  ...over,
});

beforeEach(() => {
  queryRows = [];
  updatedRows.length = 0;
});

describe('isTerminalStatus', () => {
  it.each([...TERMINAL_STATUSES])('%s is terminal', (s) => {
    expect(isTerminalStatus(s)).toBe(true);
  });

  it.each(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED', '', null, undefined])(
    '%j is not terminal',
    (s) => {
      expect(isTerminalStatus(s as string | null | undefined)).toBe(false);
    },
  );

  it('is case-insensitive (raw DB text is not always upper-cased)', () => {
    expect(isTerminalStatus('withdrawn')).toBe(true);
  });
});

describe('updateIPOStatuses never downgrades a terminal status', () => {
  it('would have written LISTED for these dates — proving the guard is what stops it', () => {
    // Baseline: the pure state machine really does want LISTED here.
    expect(
      computeTargetStatus(
        { openDate: '2020-01-01', closeDate: '2020-01-05', listingDate: '2020-01-10' },
        '2026-09-02',
      ),
    ).toBe('LISTED');
  });

  it.each([...TERMINAL_STATUSES])('leaves a %s row completely untouched', async (status) => {
    queryRows = [row({ status })];
    const result = await updateIPOStatuses();
    expect(updatedRows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.updatedIPOs).toEqual([]);
  });

  it('still updates a non-terminal row in the same batch', async () => {
    queryRows = [
      row({ id: 'dead', status: 'WITHDRAWN' }),
      row({ id: 'live', status: 'CLOSED' }),
    ];
    const result = await updateIPOStatuses();
    expect(updatedRows.map((u) => u.id)).toEqual(['live']);
    expect(updatedRows[0].set.status).toBe('LISTED');
    expect(result.updatedIPOs.map((u) => u.id)).toEqual(['live']);
  });
});

describe('getOutdatedStatusCount does not count terminal rows as outdated', () => {
  it.each([...TERMINAL_STATUSES])('%s row is not "outdated"', async (status) => {
    queryRows = [row({ status })];
    await expect(getOutdatedStatusCount()).resolves.toMatchObject({ total: 0 });
  });

  it('a genuinely outdated non-terminal row is still counted', async () => {
    queryRows = [row({ status: 'CLOSED' })];
    await expect(getOutdatedStatusCount()).resolves.toMatchObject({
      total: 1,
      closedToListed: 1,
    });
  });
});
