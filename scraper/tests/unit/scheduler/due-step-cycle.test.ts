import { describe, it, expect } from 'vitest';
import {
  isDiscoveryDue,
  isMarketHoursIST,
  mostRecentDiscoverySlotLabel,
  DISCOVERY_SLOTS_IST_MINUTES,
} from '../../../src/scheduler/due-step-cycle.js';

/** Build a UTC Date from explicit IST wall-clock fields (UTC = IST - 5:30). */
function istDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60_000;
  return new Date(utcMillis);
}

describe('isDiscoveryDue — 4 daily IST slots (08:30, 11:00, 14:00, 17:30) with catch-up', () => {
  it('is due on first-ever run (lastRunAt null)', () => {
    expect(isDiscoveryDue(istDate(2026, 9, 3, 9, 0), null)).toBe(true);
  });

  it('is due right at a slot boundary if never run since', () => {
    expect(isDiscoveryDue(istDate(2026, 9, 3, 8, 30), null)).toBe(true);
  });

  it('is NOT due again within the same slot window after a fresh run', () => {
    const lastRun = istDate(2026, 9, 3, 8, 35); // ran shortly after the 08:30 slot
    expect(isDiscoveryDue(istDate(2026, 9, 3, 9, 0), lastRun)).toBe(false);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 10, 59), lastRun)).toBe(false);
  });

  it('becomes due again once the next slot boundary passes', () => {
    const lastRun = istDate(2026, 9, 3, 8, 35);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 11, 0), lastRun)).toBe(true);
    expect(isDiscoveryDue(istDate(2026, 9, 3, 11, 5), lastRun)).toBe(true);
  });

  it('catch-up: a missed slot (process down through 11:00-14:00) still fires on the next cycle that observes it', () => {
    const lastRun = istDate(2026, 9, 3, 8, 35); // last successful run was for the 08:30 slot
    // Process was down 09:00-15:00; next cycle lands at 15:00, well past the missed 11:00 and 14:00 slots.
    expect(isDiscoveryDue(istDate(2026, 9, 3, 15, 0), lastRun)).toBe(true);
  });

  it('runs exactly 4 times across a full day when cycles land every 30 minutes (no drift, no double-fire)', () => {
    // Seed with yesterday's 17:30 slot already run, so today starts "warm"
    // (a cold start with lastRunAt=null would also catch up yesterday's
    // missed slot at the very first cycle of the day -- see the catch-up test).
    let lastRun: Date | null = istDate(2026, 9, 2, 17, 35);
    let runCount = 0;
    for (let i = 0; i < 48; i++) {
      const totalMinutes = i * 30;
      const now = istDate(2026, 9, 3, Math.floor(totalMinutes / 60), totalMinutes % 60);
      if (isDiscoveryDue(now, lastRun)) {
        runCount++;
        lastRun = now;
      }
    }
    expect(runCount).toBe(DISCOVERY_SLOTS_IST_MINUTES.length);
  });

  it('before the first slot of the day, the due boundary is yesterday\'s last slot (17:30) — a run just after that still counts', () => {
    const lastRun = istDate(2026, 9, 2, 17, 35); // ran just after yesterday's 17:30 slot
    expect(isDiscoveryDue(istDate(2026, 9, 3, 5, 0), lastRun)).toBe(false); // before 08:30 today, nothing new due
    expect(isDiscoveryDue(istDate(2026, 9, 3, 8, 30), lastRun)).toBe(true); // today's 08:30 slot arrives
  });

  it('is timezone-safe: uses explicit IST offset arithmetic, not the machine timezone', () => {
    // A UTC instant that is 08:30 IST is 03:00 UTC the same day.
    const utcInstant = new Date(Date.UTC(2026, 8, 3, 3, 0)); // 2026-09-03T03:00:00Z == 08:30 IST
    expect(isDiscoveryDue(utcInstant, null)).toBe(true);
    expect(mostRecentDiscoverySlotLabel(utcInstant)).toBe('08:30 IST');
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
