import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db', () => ({ db: {}, marketHolidays: {} }));

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
