/**
 * #1256 — the status date ladder never moves backwards except a spec relaunch.
 *
 * Spec row 8 (`status`, docs/design/data-sourcing-pull-model.md): "must be a legal transition
 * (UPCOMING→OPEN→CLOSED→LISTED); never regresses without an ADMIN row". OD-83 / F-131 / §2.9:
 * an exchange relaunch (a NEWER window for the same row) is the one sanctioned way back.
 *
 * Every case below is a real staging row measured 2026-09-28 (dates and field_sources as read),
 * except the relaunch, for which staging has no case where the ladder moved one back; it uses the
 * OD-83 shape (Dhanwel: the exchange moved the window later).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  decideBackwardMove,
  isBackwardMove,
  type StatusEvidence,
} from '@/lib/services/status-updater-service';

const ist = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+05:30`);
// previousSource defaults to the same source: the source changed its own value (MAJOR 1 records it).
const ev = (
  fieldName: string,
  source: string,
  previousValue: string | null,
  at: Date,
  previousSource: string | null = previousValue === null ? null : source
): StatusEvidence => ({
  fieldName,
  source,
  previousValue,
  previousSource,
  updatedAt: at,
});
const row = (over: Partial<Row>): Row => ({
  id: 'id-1',
  slug: 'slug-1',
  companyName: 'Test Co Ltd',
  status: 'OPEN',
  openDate: null,
  closeDate: null,
  listingDate: null,
  scraperLocked: false,
  ...over,
});

async function run(rows: Row[], now: Date, evidence: Record<string, StatusEvidence[]>) {
  queryRows = rows;
  return updateIPOStatuses({ now, loadEvidence: async (id) => evidence[id] ?? [] });
}

beforeEach(() => {
  queryRows = [];
  updatedRows.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('isBackwardMove', () => {
  it.each([
    ['OPEN', 'UPCOMING', true],
    ['CLOSED', 'OPEN', true],
    ['LISTED', 'CLOSED', true],
    ['LISTED', 'UPCOMING', true],
    ['UPCOMING', 'OPEN', false],
    ['OPEN', 'CLOSED', false],
    ['CLOSED', 'LISTED', false],
    ['POSTPONED', 'UPCOMING', false],
  ])('%s -> %s is backward: %s', (from, to, expected) => {
    expect(isBackwardMove(from, to)).toBe(expected);
  });
});

describe('updateIPOStatuses refuses a regression with no newer exchange window (#1256)', () => {
  it('SpectraA, close day 2026-09-21 21:45 IST: CG said CLOSED after bidding ended; close_date never moved -> stays CLOSED', async () => {
    const result = await run(
      [row({ id: 'spectraa', status: 'CLOSED', openDate: '2026-09-17', closeDate: '2026-09-21', listingDate: '2026-09-24' })],
      ist('2026-09-21', '22:00'),
      {
        spectraa: [
          ev('status', 'CHITTORGARH', null, ist('2026-09-21', '21:45')),
          ev('closeDate', 'CHITTORGARH', '2026-09-21', ist('2026-09-21', '17:45')),
        ],
      }
    );
    expect(updatedRows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.refusedBackward).toBe(1);
  });

  it('a close date from a weaker source that moved later is still refused (not an exchange)', async () => {
    await run(
      [row({ id: 'x', status: 'CLOSED', openDate: '2026-09-17', closeDate: '2026-09-23' })],
      ist('2026-09-22', '10:00'),
      {
        x: [
          ev('status', 'NSE', null, ist('2026-09-21', '18:00')),
          ev('closeDate', 'CHITTORGARH', '2026-09-21', ist('2026-09-21', '20:00')),
        ],
      }
    );
    expect(updatedRows).toEqual([]);
  });

  it('Veegaland, LISTED on 2026-09-23 with listing_date still null -> stays LISTED', async () => {
    const result = await run(
      [row({ id: 'veegaland', status: 'LISTED', openDate: '2026-09-10', closeDate: '2026-09-15', listingDate: null })],
      ist('2026-09-23', '13:30'),
      { veegaland: [ev('status', 'NSE', null, ist('2026-09-16', '05:22'))] }
    );
    expect(updatedRows).toEqual([]);
    expect(result.refusedBackward).toBe(1);
  });

  it('LISTED never regresses on an exchange listing date alone, even one that moved later', async () => {
    await run(
      [row({ id: 'y', status: 'LISTED', openDate: '2026-09-10', closeDate: '2026-09-15', listingDate: '2026-09-30' })],
      ist('2026-09-23', '13:30'),
      { y: [ev('listingDate', 'NSE', '2026-09-18', ist('2026-09-22', '10:00'))] }
    );
    expect(updatedRows).toEqual([]);
  });

  it('Jindal Supreme OPEN -> UPCOMING with open_date unchanged (prev = current) -> stays OPEN', async () => {
    await run(
      [row({ id: 'jindal', status: 'OPEN', openDate: '2026-09-16', closeDate: '2026-09-18' })],
      ist('2026-09-15', '23:00'),
      {
        jindal: [
          ev('status', 'NSE', null, ist('2026-09-15', '22:30')),
          ev('openDate', 'NSE', '2026-09-16', ist('2026-09-10', '10:00')),
        ],
      }
    );
    expect(updatedRows).toEqual([]);
  });

  it('an exchange re-confirming the SAME close date after the status is not a newer window', async () => {
    await run(
      [row({ id: 'same', status: 'CLOSED', openDate: '2026-09-17', closeDate: '2026-09-21' })],
      ist('2026-09-21', '22:00'),
      {
        same: [
          ev('status', 'CHITTORGARH', null, ist('2026-09-21', '21:45')),
          ev('closeDate', 'NSE', '2026-09-21', ist('2026-09-21', '21:50')),
        ],
      }
    );
    expect(updatedRows).toEqual([]);
  });

  it('an exchange TAKING OVER a website close date (previous_source CHITTORGARH) is not a relaunch', async () => {
    const result = await run(
      [row({ id: 'takeover', status: 'CLOSED', openDate: '2026-09-17', closeDate: '2026-09-23' })],
      ist('2026-09-22', '10:00'),
      {
        takeover: [
          ev('status', 'CHITTORGARH', null, ist('2026-09-21', '18:00')),
          ev('closeDate', 'NSE', '2026-09-21', ist('2026-09-21', '20:00'), 'CHITTORGARH'),
        ],
      }
    );
    expect(updatedRows).toEqual([]);
    expect(result.refusedBackward).toBe(1);
  });

  it('an exchange window that moved later BEFORE the status was set does not undo that status', async () => {
    await run(
      [row({ id: 'z', status: 'CLOSED', openDate: '2026-09-17', closeDate: '2026-09-23' })],
      ist('2026-09-22', '10:00'),
      {
        z: [
          ev('closeDate', 'NSE', '2026-09-21', ist('2026-09-20', '10:00')),
          ev('status', 'NSE', null, ist('2026-09-21', '18:00')),
        ],
      }
    );
    expect(updatedRows).toEqual([]);
  });
});

describe('updateIPOStatuses allows the spec relaunch path and ADMIN (OD-83, row 8)', () => {
  it('relaunch: NSE moved the window later after the status was set -> CLOSED goes back to OPEN', async () => {
    const result = await run(
      [row({ id: 'relaunch', status: 'CLOSED', openDate: '2026-08-19', closeDate: '2026-08-21' })],
      ist('2026-08-20', '10:00'),
      {
        relaunch: [
          ev('status', 'BSE', null, ist('2026-06-26', '18:00')),
          ev('closeDate', 'NSE', '2026-06-25', ist('2026-08-10', '10:00')),
        ],
      }
    );
    expect(updatedRows).toEqual([{ id: 'relaunch', set: expect.objectContaining({ status: 'OPEN' }) }]);
    expect(result.refusedBackward).toBe(0);
  });

  it('relaunch: BSE moved the open date later -> OPEN goes back to UPCOMING', async () => {
    await run(
      [row({ id: 'r2', status: 'OPEN', openDate: '2026-08-19', closeDate: '2026-08-21' })],
      ist('2026-08-10', '10:00'),
      { r2: [ev('openDate', 'BSE', '2026-06-23', ist('2026-08-05', '10:00'))] }
    );
    expect(updatedRows.map((u) => u.set.status)).toEqual(['UPCOMING']);
  });

  it('ADMIN listing date written after the status -> LISTED may go back to CLOSED', async () => {
    await run(
      [row({ id: 'admin', status: 'LISTED', openDate: '2026-09-10', closeDate: '2026-09-15', listingDate: '2026-09-30' })],
      ist('2026-09-23', '13:30'),
      {
        admin: [
          ev('status', 'NSE', null, ist('2026-09-18', '10:00')),
          ev('listingDate', 'ADMIN', '2026-09-18', ist('2026-09-22', '10:00')),
        ],
      }
    );
    expect(updatedRows.map((u) => u.set.status)).toEqual(['CLOSED']);
  });

  it('an ADMIN date older than the status does not authorise a regression', () => {
    expect(
      decideBackwardMove(
        'LISTED',
        'CLOSED',
        { openDate: '2026-09-10', closeDate: '2026-09-15', listingDate: '2026-09-30' },
        [
          ev('listingDate', 'ADMIN', '2026-09-18', ist('2026-09-17', '10:00')),
          ev('status', 'NSE', null, ist('2026-09-18', '10:00')),
        ]
      ).allowed
    ).toBe(false);
  });
});

describe('forward steps are unchanged and never consult the guard', () => {
  it.each([
    ['UPCOMING', 'OPEN', { openDate: '2026-09-17', closeDate: '2026-09-21', listingDate: '2026-09-24' }, '2026-09-17'],
    ['OPEN', 'CLOSED', { openDate: '2026-09-17', closeDate: '2026-09-21', listingDate: '2026-09-24' }, '2026-09-22'],
    ['CLOSED', 'LISTED', { openDate: '2026-09-17', closeDate: '2026-09-21', listingDate: '2026-09-24' }, '2026-09-24'],
    ['UPCOMING', 'LISTED', { openDate: '2026-09-17', closeDate: '2026-09-21', listingDate: '2026-09-24' }, '2026-09-25'],
  ])('%s -> %s', async (from, to, dates, day) => {
    const loadEvidence = vi.fn(async () => [] as StatusEvidence[]);
    queryRows = [row({ id: 'f', status: from, ...dates })];
    const result = await updateIPOStatuses({ now: ist(day, '10:00'), loadEvidence });
    expect(updatedRows.map((u) => u.set.status)).toEqual([to]);
    expect(result.refusedBackward).toBe(0);
    expect(loadEvidence).not.toHaveBeenCalled();
  });
});

// #1298 interaction: POSTPONED is terminal in both writers today (web TERMINAL_STATUSES, scraper
// TERMINAL_IPO_STATUSES), so the ladder skips it BEFORE this guard. The guard only ranks the four
// ladder statuses; it neither blocks nor enables a POSTPONED -> ladder return. When #1298 lets a
// relaunch filing (OD-139) move a POSTPONED row back onto the ladder, that is not a ladder regression.
describe('terminal statuses never reach the backward guard (#1298 interaction, §2.9, OD-139)', () => {
  it.each(['POSTPONED', 'WITHDRAWN', 'DELISTED'])('%s with dates computing OPEN is left alone', async (status) => {
    const loadEvidence = vi.fn(async () => [] as StatusEvidence[]);
    queryRows = [row({ id: 't', status, openDate: '2026-09-17', closeDate: '2026-09-21' })];
    const result = await updateIPOStatuses({ now: ist('2026-09-18', '10:00'), loadEvidence });
    expect(updatedRows).toEqual([]);
    expect(result.refusedBackward).toBe(0);
    expect(loadEvidence).not.toHaveBeenCalled();
    expect(isBackwardMove(status, 'OPEN')).toBe(false);
  });
});
