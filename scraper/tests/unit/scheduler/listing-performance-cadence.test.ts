import { describe, it, expect } from 'vitest';
import {
  shouldRunListingPerformanceUpdate,
  toIst,
} from '../../../src/scheduler/listing-performance-cadence.js';

/** Build a UTC Date from explicit IST wall-clock fields (UTC = IST - 5:30). */
function istDate(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number
): Date {
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60_000;
  return new Date(utcMillis);
}

describe('toIst', () => {
  it('converts a UTC instant to IST wall-clock fields', () => {
    // 2026-08-17T08:30:04Z UTC == 2026-08-17 14:00:04 IST (Monday)
    const clock = toIst(new Date('2026-08-17T08:30:04.000Z'));
    expect(clock.dayOfWeek).toBe(1); // Monday
    expect(clock.hour).toBe(14);
    expect(clock.minute).toBe(0);
  });
});

describe('shouldRunListingPerformanceUpdate', () => {
  it('runs every cycle during weekday market hours (09:00-17:59 IST)', () => {
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 9, 0))).toBe(true);
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 9, 30))).toBe(true);
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 13, 30))).toBe(true);
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 17, 30))).toBe(true);
  });

  it('does NOT run every cycle before market open or at/after market close', () => {
    // 08:30 IST — before market hours; even-hour boundary but minute >= 30, so skipped
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 8, 30))).toBe(false);
    // 18:00 IST — after market hours, even hour, minute < 30 -> runs (2h cadence)
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 18, 0))).toBe(true);
    // 18:30 IST — after market hours, same even hour but minute >= 30 -> skipped
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 18, 30))).toBe(false);
    // 19:00 IST — odd hour after hours -> skipped
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, 19, 0))).toBe(false);
  });

  it('runs once every 2 hours on weekday after-hours', () => {
    const runs = [0, 2, 4, 6, 8, 20, 22].map((hour) =>
      shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, hour, 0))
    );
    expect(runs.every(Boolean)).toBe(true);

    const skips = [1, 3, 5, 7, 21, 23].map((hour) =>
      shouldRunListingPerformanceUpdate(istDate(2026, 8, 17, hour, 0))
    );
    expect(skips.some(Boolean)).toBe(false);
  });

  it('runs once every 4 hours on weekends', () => {
    // 2026-08-16 is a Sunday
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 16, 0, 0))).toBe(true);
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 16, 4, 0))).toBe(true);
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 16, 8, 0))).toBe(true);
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 16, 12, 30))).toBe(false);

    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 16, 2, 0))).toBe(false);
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 16, 6, 0))).toBe(false);

    // Weekend market-hours-shaped time is still weekend cadence, not market hours
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 16, 11, 0))).toBe(false);
  });

  it('treats Saturday as a weekend too', () => {
    // 2026-08-15 is a Saturday
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 15, 12, 0))).toBe(true); // 4h boundary
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 15, 12, 30))).toBe(false); // past the boundary minute
    expect(shouldRunListingPerformanceUpdate(istDate(2026, 8, 15, 13, 0))).toBe(false); // not a 4h boundary hour
  });
});
