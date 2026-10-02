/**
 * #1467 / F-223 (#1453): bse-scraper.ts parseBSEDate returned TODAY when nothing matched or on any
 * exception, and its `new Date(str).toISOString()` fallback turned local midnight into the previous
 * UTC day. A made-up or one-day-early date could be written as a BSE open/close value.
 *
 * Answer states (brief B4 d): parsed -> 'YYYY-MM-DD'; empty input -> null (abstention, OD-60);
 * unparseable -> null (the caller records the field as not supplied; OD-62 FAILED_VALIDATION).
 * Never today, never a shifted day. Run under several process TZs.
 *
 * Strings: Start_Dt/End_Dt are the real BSE API row values captured in
 * tests/fixtures/bse/bse-board-2026-10-02.json; the DD-MM-YYYY and DD/MMM/YYYY shapes are the table
 * shapes the Puppeteer scraper's own integration test and header comment use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBSEDate } from '../../../src/scrapers/bse-scraper.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
  vi.useRealTimers();
});

const TZS = ['Asia/Kolkata', 'UTC', 'America/Los_Angeles'];

describe('parseBSEDate: parsed', () => {
  const cases: Array<[string, string]> = [
    ['2026-09-30T00:00:00', '2026-09-30'], // real Start_Dt
    ['2026-10-05T00:00:00', '2026-10-05'], // real End_Dt
    ['2026-09-28T00:00:00', '2026-09-28'], // real Start_Dt
    ['08-10-2025', '2025-10-08'], // table DD-MM-YYYY
    ['06/Oct/2025', '2025-10-06'], // table DD/MMM/YYYY
    ['06-Oct-2025', '2025-10-06'],
    [' 16-10-2025 ', '2025-10-16'],
  ];
  for (const tz of TZS) {
    for (const [input, expected] of cases) {
      it(`TZ=${tz}: ${JSON.stringify(input)} -> ${expected}`, () => {
        process.env.TZ = tz;
        expect(parseBSEDate(input)).toBe(expected);
      });
    }
  }
});

describe('parseBSEDate: unparseable or empty is null, never today (#1467)', () => {
  const bad = ['', '   ', '--', '-', 'TBA', 'N/A', 'not a date', '31-02-2026', '99-99-9999', '06/Foo/2025', '2026-13-40T00:00:00'];
  for (const tz of TZS) {
    for (const input of bad) {
      it(`TZ=${tz}: ${JSON.stringify(input)} -> null`, () => {
        process.env.TZ = tz;
        expect(parseBSEDate(input)).toBeNull();
      });
    }
  }

  it('does not return the current IST day for garbage (today-fallback fingerprint)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T06:00:00Z'));
    expect(parseBSEDate('garbage')).toBeNull();
    expect(parseBSEDate('garbage')).not.toBe('2026-10-03');
  });

  it('a non-ISO free-text date is NOT parsed through the Date constructor (would shift a day under IST)', () => {
    for (const tz of TZS) {
      process.env.TZ = tz;
      expect(parseBSEDate('Oct 6, 2025')).toBeNull();
      expect(parseBSEDate('6 October 2025')).toBeNull();
    }
  });

  it('a non-string input (null/undefined from a scrape) is null, not a throw and not today', () => {
    expect(parseBSEDate(undefined as unknown as string)).toBeNull();
    expect(parseBSEDate(null as unknown as string)).toBeNull();
  });
});
