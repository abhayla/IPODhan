import { describe, it, expect } from 'vitest';
import {
  isDiscoveryDue,
  isMarketHoursIST,
  isBiddingHoursIST,
  mostRecentDiscoverySlotLabel,
  DISCOVERY_SLOTS_IST_MINUTES,
} from '../../../src/scheduler/due-step-cycle.js';

/** Build a UTC Date from explicit IST wall-clock fields (UTC = IST - 5:30). */
function istDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60_000;
  return new Date(utcMillis);
}

describe('isDiscoveryDue — the data job 3 IST slots (00:00, 08:00, 14:00; OD-19) with catch-up', () => {
  it('the slot list is OD-19, read from the one shared definition', async () => {
    const shared = await import('@ipodhan/shared/scheduler/data-job-slots');
    expect([...DISCOVERY_SLOTS_IST_MINUTES]).toEqual([0, 480, 840]);
    expect(DISCOVERY_SLOTS_IST_MINUTES).toBe(shared.DATA_JOB_SLOTS_IST_MINUTES);
  });

  it('is due on first-ever run (lastRunAt null)', () => {
    expect(isDiscoveryDue(istDate(2026, 9, 3, 9, 0), null)).toBe(true);
  });

  it('is due at 00:00, 08:00 and 14:00 once the slot before has run', () => {
    expect(isDiscoveryDue(istDate(2026, 9, 3, 0, 0), istDate(2026, 9, 2, 14, 5))).toBe(true);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 8, 0), istDate(2026, 9, 3, 0, 5))).toBe(true);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 14, 0), istDate(2026, 9, 3, 8, 5))).toBe(true);
  });

  it('is NOT due at the retired D-13 slots 08:30, 11:00, 17:30 once the slot before has run', () => {
    expect(isDiscoveryDue(istDate(2026, 9, 3, 8, 30), istDate(2026, 9, 3, 8, 0))).toBe(false);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 11, 0), istDate(2026, 9, 3, 8, 0))).toBe(false);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 17, 30), istDate(2026, 9, 3, 14, 0))).toBe(false);
  });

  it('is NOT due again within the same slot window after a fresh run', () => {
    const lastRun = istDate(2026, 9, 3, 8, 5);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 10, 30), lastRun)).toBe(false);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 13, 59), lastRun)).toBe(false);
  });

  it('catch-up: a missed slot (process down through 08:00) still fires on the next cycle that observes it', () => {
    expect(isDiscoveryDue(istDate(2026, 9, 3, 9, 30), istDate(2026, 9, 3, 0, 5))).toBe(true);
  });

  it('runs exactly 3 times across a full day when cycles land every 30 minutes (no drift, no double-fire)', () => {
    let lastRun: Date | null = istDate(2026, 9, 2, 14, 5);
    let runCount = 0;
    for (let i = 0; i < 48; i++) {
      const totalMinutes = i * 30;
      const now = istDate(2026, 9, 3, Math.floor(totalMinutes / 60), totalMinutes % 60);
      if (isDiscoveryDue(now, lastRun)) {
        runCount++;
        lastRun = now;
      }
    }
    expect(runCount).toBe(3);
  });

  it('is timezone-safe: uses explicit IST offset arithmetic, not the machine timezone', () => {
    // A UTC instant that is 08:00 IST is 02:30 UTC the same day.
    const utcInstant = new Date(Date.UTC(2026, 8, 3, 2, 30));
    expect(isDiscoveryDue(utcInstant, null)).toBe(true);
    expect(mostRecentDiscoverySlotLabel(utcInstant)).toBe('08:00 IST');
    expect(mostRecentDiscoverySlotLabel(new Date(Date.UTC(2026, 8, 2, 18, 31)))).toBe('00:00 IST');
  });
});

describe('isMarketHoursIST — weekday 10:00-17:00 IST', () => {
  it('is true on a weekday within the window', () => {
    expect(isMarketHoursIST(istDate(2026, 9, 3, 10, 0))).toBe(true); // Thursday
    expect(isMarketHoursIST(istDate(2026, 9, 3, 13, 30))).toBe(true);
    expect(isMarketHoursIST(istDate(2026, 9, 3, 16, 59))).toBe(true);
  });

  it('is false just before 10:00 and at/after 17:00', () => {
    expect(isMarketHoursIST(istDate(2026, 9, 3, 9, 59))).toBe(false);
    expect(isMarketHoursIST(istDate(2026, 9, 3, 17, 0))).toBe(false);
    expect(isMarketHoursIST(istDate(2026, 9, 3, 20, 0))).toBe(false);
  });

  it('is false on a Saturday even during the 10:00-17:00 window', () => {
    // 2026-09-05 is a Saturday.
    expect(isMarketHoursIST(istDate(2026, 9, 5, 12, 0))).toBe(false);
  });

  it('is false on a Sunday', () => {
    // 2026-09-06 is a Sunday.
    expect(isMarketHoursIST(istDate(2026, 9, 6, 12, 0))).toBe(false);
  });
});

/**
 * Item 7 S1 (OD-28, spec 2.1 job table): subscription and the demand graph run
 * "every 30 minutes, 10:00-18:30" only while bidding is on. The 18:30 end is the
 * spec's number (the exchanges keep publishing the day's final bid figures after
 * 17:00), which the older 17:00 market-hours window cut off.
 */
describe('isBiddingHoursIST — 10:00-18:30 IST inclusive, any day (spec 2.1 live-figures row)', () => {
  it('is true from 10:00 up to and including 18:30', () => {
    expect(isBiddingHoursIST(istDate(2026, 9, 3, 10, 0))).toBe(true); // Thursday
    expect(isBiddingHoursIST(istDate(2026, 9, 3, 17, 30))).toBe(true);
    expect(isBiddingHoursIST(istDate(2026, 9, 3, 18, 30))).toBe(true); // spec "10:00–18:30": the 18:30 wake reads the final figure
  });

  it('is false before 10:00 and after 18:30', () => {
    expect(isBiddingHoursIST(istDate(2026, 9, 3, 9, 59))).toBe(false);
    expect(isBiddingHoursIST(istDate(2026, 9, 3, 18, 31))).toBe(false);
    expect(isBiddingHoursIST(istDate(2026, 9, 3, 22, 0))).toBe(false);
  });

  it('is true on a Saturday and a Sunday: the spec gates on "a day when at least one IPO is OPEN", not on the weekday', () => {
    expect(isBiddingHoursIST(istDate(2026, 9, 5, 12, 0))).toBe(true);
    expect(isBiddingHoursIST(istDate(2026, 9, 6, 18, 30))).toBe(true);
    expect(isBiddingHoursIST(istDate(2026, 9, 6, 9, 59))).toBe(false);
  });
});
