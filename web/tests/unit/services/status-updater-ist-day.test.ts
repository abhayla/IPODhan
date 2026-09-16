/**
 * GitHub #682 — the status updater derived "today" from the UTC calendar day
 * (`now.toISOString().split('T')[0]`), but open_date/close_date/listing_date
 * are IST calendar dates. Between 00:00 and 05:30 IST the UTC day is still
 * "yesterday", so every IPO crossing a status boundary that morning was
 * computed against the wrong day until 05:30 IST.
 *
 * These tests fix the clock at 2026-09-15T20:30:00Z = 2026-09-16 02:00 IST
 * (the exact 02:00 IST floor-run instant named in the issue) and prove three
 * real transitions plus the outdated-count monitor all use the IST day, with
 * a positive control that stays put.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== MOCKS (mirrors status-updater-terminal.test.ts) ====================

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

import { updateIPOStatuses, getOutdatedStatusCount } from '@/lib/services/status-updater-service';

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

// 2026-09-15T20:30:00Z = 2026-09-16 02:00:00 IST — the issue's named floor-run instant.
const MOCK_NOW = new Date('2026-09-15T20:30:00Z');

beforeEach(() => {
  queryRows = [];
  updatedRows.length = 0;
});

describe('updateIPOStatuses computes "today" from the IST calendar day, not UTC (#682)', () => {
  it('(a) UPCOMING -> OPEN: open_date is 2026-09-16 IST, but the UTC day is still 2026-09-15', async () => {
    queryRows = [
      row({ id: 'hero-motors', status: 'UPCOMING', openDate: '2026-09-16', closeDate: '2026-09-18', listingDate: null }),
    ];
    const result = await updateIPOStatuses({ now: MOCK_NOW });
    expect(updatedRows.map((u) => u.id)).toEqual(['hero-motors']);
    expect(updatedRows[0].set.status).toBe('OPEN');
    expect(result.upcomingToOpen).toBe(1);
  });

  it('(b) OPEN -> CLOSED: close_date is 2026-09-15 IST (already passed in IST, not yet in UTC)', async () => {
    queryRows = [
      row({ id: 'veegaland', status: 'OPEN', openDate: '2026-09-12', closeDate: '2026-09-15', listingDate: null }),
    ];
    const result = await updateIPOStatuses({ now: MOCK_NOW });
    expect(updatedRows.map((u) => u.id)).toEqual(['veegaland']);
    expect(updatedRows[0].set.status).toBe('CLOSED');
    expect(result.openToClosed).toBe(1);
  });

  it('(c) CLOSED -> LISTED: listing_date is 2026-09-16 IST', async () => {
    queryRows = [
      row({ id: 'jindal-supreme', status: 'CLOSED', openDate: '2026-09-10', closeDate: '2026-09-12', listingDate: '2026-09-16' }),
    ];
    const result = await updateIPOStatuses({ now: MOCK_NOW });
    expect(updatedRows.map((u) => u.id)).toEqual(['jindal-supreme']);
    expect(updatedRows[0].set.status).toBe('LISTED');
    expect(result.closedToListed).toBe(1);
  });

  it('(d) positive control: open_date 2026-09-17 stays UPCOMING under either calendar day', async () => {
    queryRows = [
      row({ id: 'ss-retail-future', status: 'UPCOMING', openDate: '2026-09-17', closeDate: '2026-09-19', listingDate: null }),
    ];
    const result = await updateIPOStatuses({ now: MOCK_NOW });
    expect(updatedRows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('(e) getOutdatedStatusCount agrees with the writer at the same instant', async () => {
    queryRows = [
      row({ id: 'hero-motors', status: 'UPCOMING', openDate: '2026-09-16', closeDate: '2026-09-18', listingDate: null }),
      row({ id: 'veegaland', status: 'OPEN', openDate: '2026-09-12', closeDate: '2026-09-15', listingDate: null }),
      row({ id: 'jindal-supreme', status: 'CLOSED', openDate: '2026-09-10', closeDate: '2026-09-12', listingDate: '2026-09-16' }),
      row({ id: 'ss-retail-future', status: 'UPCOMING', openDate: '2026-09-17', closeDate: '2026-09-19', listingDate: null }),
    ];
    const outdated = await getOutdatedStatusCount(MOCK_NOW);
    expect(outdated).toMatchObject({
      upcomingToOpen: 1,
      openToClosed: 1,
      closedToListed: 1,
      total: 3,
    });
  });
});
