import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dbCalls = vi.hoisted(() => ({ existing: [] as Array<{ id: string }>, selects: [] as unknown[], updates: [] as unknown[], inserts: [] as unknown[] }));
vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
}));
vi.mock('@/lib/db', () => ({
  marketHolidays: { id: 'id', date: 'date', type: 'type', exchange: 'exchange' },
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          dbCalls.selects.push(w);
          return { limit: async () => dbCalls.existing };
        },
      }),
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: async (w: unknown) => {
          dbCalls.updates.push({ set: v, where: w });
        },
      }),
    }),
    insert: () => ({
      values: async (v: unknown) => {
        dbCalls.inserts.push(v);
      },
    }),
  },
}));

import {
  MarketHolidaysScraper,
  nseTradingDateToIso,
  toIstCalendarDate,
} from '@/lib/scrapers/sources/market-holidays-scraper';
// @ts-expect-error -- plain .mjs module without type declarations
import { parseNseTradingDate } from '../../../../scripts/lib/nse-holiday-calendar.mjs';

/**
 * F-220: the writer stored every NSE trading holiday one day early — "15-Jan-2026" became an
 * IST-midnight Date and toISOString() turned it into 2026-01-14. The stored date must be the IST
 * calendar date, built from the components. Real NSE answer captured 2026-10-02.
 */
const FIXTURE = path.resolve(__dirname, '../../../../scraper/tests/fixtures/nse/holiday-master-trading-2026-10-02.json');
const NSE = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

describe('market holidays writer stores the IST calendar date (F-220)', () => {
  it('a real NSE date string maps to the same calendar day', () => {
    expect(nseTradingDateToIso('15-Jan-2026')).toBe('2026-01-15');
    expect(nseTradingDateToIso('25-Dec-2026')).toBe('2026-12-25');
    expect(nseTradingDateToIso('31-Sep-2026')).toBeNull();
    expect(nseTradingDateToIso('2026-01-15')).toBeNull();
  });

  it('an IST-midnight Date formats to its IST day, not the UTC day before', () => {
    // 2026-01-15 00:00 IST is 2026-01-14T18:30Z — exactly what parseDate returns on the VPS.
    expect(toIstCalendarDate(new Date('2026-01-14T18:30:00.000Z'))).toBe('2026-01-15');
  });

  it('parses the CM (equity) segment and stores every NSE date unshifted', () => {
    const scraper = new MarketHolidaysScraper();
    const holidays = scraper.parseNSEJSON(NSE, 2026);
    const expected = (NSE.CM as Array<{ tradingDate: string }>).map((r) => parseNseTradingDate(r.tradingDate));
    expect(holidays.map((h) => h.dateIso)).toEqual(expected);
    expect(holidays).toHaveLength(20);
    expect(holidays.find((h) => h.description === 'Republic Day')?.dateIso).toBe('2026-01-26');
    expect(holidays.find((h) => h.description === 'Ganesh Chaturthi')?.dateIso).toBe('2026-09-14');
  });

  it('agrees with the canonical parser (scripts/lib/nse-holiday-calendar.mjs) on every fixture date', () => {
    for (const segment of Object.values(NSE) as Array<Array<{ tradingDate: string }>>) {
      for (const row of segment) expect(nseTradingDateToIso(row.tradingDate)).toBe(parseNseTradingDate(row.tradingDate));
    }
  });
});

describe('market holidays writer writes the reconcile shape: BOTH/TRADING, matched on date (hand run idempotent with the reconcile)', () => {
  const holiday = { date: new Date('2026-01-14T18:30:00.000Z'), dateIso: '2026-01-15', description: 'Municipal Corporation Election - Maharashtra', exchange: 'NSE' as const, type: 'TRADING' as const, year: 2026 };

  it('a date with no row inserts ONE BOTH/TRADING row, even though the scraped holiday is labelled NSE', async () => {
    dbCalls.existing = [];
    dbCalls.selects.length = dbCalls.updates.length = dbCalls.inserts.length = 0;
    await new MarketHolidaysScraper().storeHolidays([holiday]);
    expect(dbCalls.inserts).toEqual([{ date: '2026-01-15', description: holiday.description, exchange: 'BOTH', type: 'TRADING', year: 2026 }]);
    expect(dbCalls.updates).toEqual([]);
  });

  it('the lookup is by date + type only (never by exchange), so the reconciled BOTH row is found and updated, not duplicated', async () => {
    dbCalls.existing = [{ id: 'row-1' }];
    dbCalls.selects.length = dbCalls.updates.length = dbCalls.inserts.length = 0;
    await new MarketHolidaysScraper().storeHolidays([holiday]);
    expect(dbCalls.inserts).toEqual([]);
    expect(dbCalls.selects[0]).toEqual({ op: 'and', parts: [{ op: 'eq', col: 'date', val: '2026-01-15' }, { op: 'eq', col: 'type', val: 'TRADING' }] });
    expect(dbCalls.updates).toHaveLength(1);
    const u = dbCalls.updates[0] as { set: { exchange: string }; where: unknown };
    expect(u.set.exchange).toBe('BOTH');
    expect(u.where).toEqual({ op: 'eq', col: 'id', val: 'row-1' });
  });
});
