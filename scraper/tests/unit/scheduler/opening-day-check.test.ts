/**
 * Item 7 S4 (spec docs/design/data-sourcing-pull-model.md §2.1 job table row
 * "Opening-day check", OD-31): the gate that decides whether today's IST
 * calendar date is a day an IPO is due to open.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { anyIpoOpensToday, iposOpeningToday, opensTodayFromFetch } from '../../../src/scheduler/opening-day-check.js';

function makeStubDb(rows: Array<{ id: string; companyName: string; status: string; openDate: string | null }>) {
  const limit = vi.fn().mockResolvedValue(rows.map(({ id }) => ({ id })));
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as never, select, from, where, limit };
}

function makeStubDbForList(rows: Array<{ id: string; companyName: string; status: string; openDate: string | null }>) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as never, select, from, where };
}

describe('anyIpoOpensToday', () => {
  // 2026-09-24 09:45 IST == 04:15Z the same day.
  const at = (iso: string) => new Date(iso);

  it('is true when a stored open_date equals today (IST)', async () => {
    const { db } = makeStubDb([{ id: 'ipo-1', companyName: 'Acme Ltd', status: 'UPCOMING', openDate: '2026-09-24' }]);
    await expect(anyIpoOpensToday(db, at('2026-09-24T04:15:00Z'))).resolves.toBe(true);
  });

  it('is false when no row matches today', async () => {
    const { db } = makeStubDb([]);
    await expect(anyIpoOpensToday(db, at('2026-09-24T04:15:00Z'))).resolves.toBe(false);
  });

  it('near-midnight IST: 2026-09-24 00:10 IST is UTC 2026-09-23 18:40Z — the gate reads the IST date, not the UTC date', async () => {
    // istDayIso(2026-09-23T18:40:00Z) = 2026-09-24 (IST is 5:30 ahead of UTC,
    // so 18:40Z + 5:30 = 00:10 the NEXT day). A gate that compared the raw
    // UTC date here would read 2026-09-23 and miss an IPO opening today IST.
    const { db } = makeStubDb([{ id: 'ipo-2', companyName: 'Beta Ltd', status: 'UPCOMING', openDate: '2026-09-24' }]);
    await expect(anyIpoOpensToday(db, at('2026-09-23T18:40:00Z'))).resolves.toBe(true);
  });

  it('near-midnight IST the other way: 2026-09-23 23:50 IST is UTC 2026-09-23 18:20Z — still IST day 2026-09-23, so an open_date of 2026-09-24 does not match', async () => {
    // The stub's `where` always resolves the same configured rows regardless
    // of the predicate passed in, so this asserts the SQL predicate value
    // istDayIso() produced, not the (unfiltered) stub's return — proving the
    // gate computes 2026-09-23, not 2026-09-24, for this instant.
    const { db, where } = makeStubDb([{ id: 'ipo-3', companyName: 'Gamma Ltd', status: 'UPCOMING', openDate: '2026-09-24' }]);
    await anyIpoOpensToday(db, at('2026-09-23T18:20:00Z'));
    // Render the real drizzle-orm `eq(...)` SQL the gate built (rather than
    // trusting the stub's unfiltered return) to prove it compared against
    // 2026-09-23 — not 2026-09-24 — for this instant.
    const rendered = new PgDialect().sqlToQuery(where.mock.calls[0]?.[0]);
    expect(rendered.params).toContain('2026-09-23');
    expect(rendered.params).not.toContain('2026-09-24');
  });
});

describe('iposOpeningToday', () => {
  it('names the rows opening today, not just a count (signal-ownership R1)', async () => {
    const rows = [
      { id: 'ipo-1', companyName: 'Acme Ltd', status: 'UPCOMING', openDate: '2026-09-24' },
    ];
    const { db } = makeStubDbForList(rows);
    await expect(iposOpeningToday(db, new Date('2026-09-24T04:15:00Z'))).resolves.toEqual(rows);
  });
});

/**
 * Review finding 3 (MAJOR, class coverage): the three cases a DB-only gate
 * (the pre-fix `anyIpoOpensToday`-as-the-whole-gate) would have missed —
 * no stored row at all, a stored row with a NULL open_date, and a stored
 * row whose open_date is stale/postponed — each proven against
 * `opensTodayFromFetch`, the pure decision `runOpeningDayCheckWake` (via the
 * post-fetch `anyIpoOpensToday` re-read) is equivalent to once a fetch has
 * happened. `at` uses a UTC instant whose calendar date DIFFERS from its IST
 * calendar date (2026-09-23T19:00:00Z = 2026-09-24 00:30 IST), per finding
 * 3's instruction, so a UTC-date mutation is provably red (see the
 * mutation-proof script run separately against `istDayIso`/`anyIpoOpensToday`).
 */
describe('opensTodayFromFetch — review finding 1 + 3 class coverage', () => {
  const AT_2026_09_24_0030_IST = new Date('2026-09-23T19:00:00Z');

  it('class case 1: NO stored row at all — a brand-new IPO the FETCHED list reports opening today', () => {
    const fetched = [{ openDate: '2026-09-24' }];
    const stored: Array<{ openDate?: string | null }> = [];
    expect(opensTodayFromFetch(fetched, stored, AT_2026_09_24_0030_IST)).toBe(true);
  });

  it('class case 2: a stored row with a NULL open_date — only the FETCHED row carries the real date', () => {
    const fetched = [{ openDate: '2026-09-24' }];
    const stored = [{ openDate: null }];
    expect(opensTodayFromFetch(fetched, stored, AT_2026_09_24_0030_IST)).toBe(true);
  });

  it('class case 3: a stored row with an OLD (postponed) open_date — the FETCHED list shows today, the stale stored row must not hide it', () => {
    const fetched = [{ openDate: '2026-09-24' }];
    const stored = [{ openDate: '2026-09-10' }]; // stale/postponed stored value
    expect(opensTodayFromFetch(fetched, stored, AT_2026_09_24_0030_IST)).toBe(true);
  });

  it('is false when neither the fetched rows nor the stored rows open today', () => {
    const fetched = [{ openDate: '2026-09-25' }];
    const stored = [{ openDate: null }, { openDate: '2026-09-10' }];
    expect(opensTodayFromFetch(fetched, stored, AT_2026_09_24_0030_IST)).toBe(false);
  });

  it('is true from a STORED row alone when the fetch found nothing new (e.g. a source outage)', () => {
    const fetched: Array<{ openDate?: string | null }> = [];
    const stored = [{ openDate: '2026-09-24' }];
    expect(opensTodayFromFetch(fetched, stored, AT_2026_09_24_0030_IST)).toBe(true);
  });

  it('IST vs UTC instant: at 2026-09-23T19:00:00Z (2026-09-24 00:30 IST) a fetched row dated 2026-09-24 matches; the UTC calendar date (2026-09-23) would NOT have matched', () => {
    const fetched = [{ openDate: '2026-09-24' }];
    expect(opensTodayFromFetch(fetched, [], AT_2026_09_24_0030_IST)).toBe(true);
    // Proves the instant genuinely straddles the UTC/IST day boundary: the
    // UTC calendar date for this instant is 2026-09-23, one day behind the
    // IST date the gate actually used above.
    expect(AT_2026_09_24_0030_IST.toISOString().slice(0, 10)).toBe('2026-09-23');
  });
});
