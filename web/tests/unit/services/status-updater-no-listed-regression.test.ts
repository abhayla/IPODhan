/**
 * #70 — the date ladder must never take a LISTED IPO back to CLOSED.
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
  updateIPOStatuses,
  getOutdatedStatusCount,
  computeTargetStatus,
  isDateLadderRegression,
} from '@/lib/services/status-updater-service';

const row = (over: Partial<Row>): Row => ({
  id: 'glass-wall',
  slug: 'glass-wall-systems-india-ltd',
  companyName: 'Glass Wall Systems India Ltd',
  status: 'LISTED',
  openDate: '2026-09-09',
  closeDate: '2026-09-11',
  listingDate: null,
  scraperLocked: false,
  ...over,
});

beforeEach(() => {
  queryRows = [];
  updatedRows.length = 0;
});

// Spec field 8 `status`: "must be a legal transition (UPCOMING->OPEN->CLOSED->LISTED);
// never regresses without an ADMIN row". A LISTED row whose listing_date is empty (an
// exchange said LISTED, or listing_date was cleared) made computeTargetStatus answer
// CLOSED, and the updater wrote LISTED -> CLOSED every cycle. Once CLOSED, the listing
// performance job (which reads LISTED rows only) stopped seeing it.
describe('#70: updateIPOStatuses never takes a LISTED row back', () => {
  it('the pure ladder does answer CLOSED for these dates — the guard is what stops the write', () => {
    expect(
      computeTargetStatus({ openDate: '2026-09-09', closeDate: '2026-09-11', listingDate: null }, '2026-09-26'),
    ).toBe('CLOSED');
  });

  it('leaves a LISTED row with no listing_date untouched', async () => {
    queryRows = [row({})];
    const result = await updateIPOStatuses({ now: new Date('2026-09-26T06:00:00Z') });
    expect(updatedRows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('leaves a LISTED row with a future listing_date untouched', async () => {
    queryRows = [row({ listingDate: '2026-10-30' })];
    await updateIPOStatuses({ now: new Date('2026-09-26T06:00:00Z') });
    expect(updatedRows).toEqual([]);
  });

  it('still advances CLOSED -> LISTED in the same batch', async () => {
    queryRows = [row({}), row({ id: 'lumino', status: 'CLOSED', listingDate: '2026-09-03', closeDate: '2026-08-29' })];
    const result = await updateIPOStatuses({ now: new Date('2026-09-26T06:00:00Z') });
    expect(updatedRows).toEqual([{ id: 'lumino', set: expect.objectContaining({ status: 'LISTED' }) }]);
    expect(result.closedToListed).toBe(1);
  });

  it('F-131 Dhanwel relaunch: a CLOSED row whose stored window moved to the future goes back to UPCOMING', async () => {
    queryRows = [row({ id: 'dhanwel', slug: 'dhanwel-hybird-seeds-ltd', status: 'CLOSED', openDate: '2026-08-19', closeDate: '2026-08-21', listingDate: null })];
    await updateIPOStatuses({ now: new Date('2026-08-10T06:00:00Z') });
    expect(updatedRows).toEqual([{ id: 'dhanwel', set: expect.objectContaining({ status: 'UPCOMING' }) }]);
  });

  it('getOutdatedStatusCount does not count a LISTED row as outdated', async () => {
    queryRows = [row({})];
    const r = await getOutdatedStatusCount(new Date('2026-09-26T06:00:00Z'));
    expect(r.total).toBe(0);
  });
});

describe('isDateLadderRegression', () => {
  it.each([
    ['LISTED', 'CLOSED', true],
    ['LISTED', 'OPEN', true],
    ['LISTED', 'UPCOMING', true],
    ['CLOSED', 'LISTED', false],
    ['OPEN', 'CLOSED', false],
    ['UPCOMING', 'OPEN', false],
    ['listed', 'CLOSED', true],
    ['CLOSED', 'OPEN', false],
    ['OPEN', 'UPCOMING', false],
    ['WITHDRAWN', 'CLOSED', false],
  ])('%s -> %s is a regression: %s', (from, to, expected) => {
    expect(isDateLadderRegression(from, to as never)).toBe(expected);
  });
});
