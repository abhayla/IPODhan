import { describe, it, expect } from 'vitest';
import { shouldRunRegistrarHealthCheck } from '../../../src/scheduler/registrar-health-check-cadence.js';

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

describe('shouldRunRegistrarHealthCheck', () => {
  it('runs during the 06:30-06:59 IST window (the original 30 6 * * * cron slot)', () => {
    expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 6, 30))).toBe(true);
    expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 6, 45))).toBe(true);
    expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 6, 59))).toBe(true);
  });

  it('does NOT run outside the 06:30-06:59 IST window', () => {
    expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 6, 0))).toBe(false);
    expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 6, 29))).toBe(false);
    expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 7, 0))).toBe(false);
    expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 18, 30))).toBe(false);
  });

  it('runs at most once per day given the flat 30-minute one-shot cadence', () => {
    // Cycles land roughly on :00/:30 -- only the 06:30 cycle should fire.
    const cyclesToday = Array.from({ length: 48 }, (_, i) => {
      const totalMinutes = i * 30;
      return istDate(2026, 8, 17, Math.floor(totalMinutes / 60), totalMinutes % 60);
    });
    const runCount = cyclesToday.filter((d) => shouldRunRegistrarHealthCheck(d)).length;
    expect(runCount).toBe(1);
  });

  describe('T-306 catch-up (T-300C2 advisory) — a missed window must not silently skip a whole day', () => {
    it('runs on the very next cycle when the caller confirms no prior run exists (explicit lastRunAt=null)', () => {
      // Outside the window, but there is no confirmed prior run -> catch-up now.
      expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 9, 0), null)).toBe(true);
    });

    it('preserves the original window-only behavior when lastRunAt is omitted entirely', () => {
      expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 9, 0))).toBe(false);
    });

    it('does NOT catch-up when the last confirmed run is under 24h old and we are outside the window', () => {
      const lastRunAt = istDate(2026, 8, 17, 6, 45); // yesterday's confirmed run
      expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 17, 9, 0), lastRunAt)).toBe(false);
      expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 18, 6, 0), lastRunAt)).toBe(false); // ~23h15m later, still < 24h
    });

    it('DOES catch-up once the last confirmed run is more than 24h old (the missed-window scenario)', () => {
      const lastRunAt = istDate(2026, 8, 17, 6, 45);
      // 2026-08-18 07:10 IST is > 24h after 2026-08-17 06:45 IST -- e.g. the
      // 08-18 06:30 window cycle was slow/restarted and never fired.
      expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 18, 7, 10), lastRunAt)).toBe(true);
    });

    it('a confirmed run inside the window still fires normally regardless of lastRunAt', () => {
      const lastRunAt = istDate(2026, 8, 17, 6, 45); // ~24h ago, doesn't matter -- in-window always wins
      expect(shouldRunRegistrarHealthCheck(istDate(2026, 8, 18, 6, 45), lastRunAt)).toBe(true);
    });
  });
});
