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
    const runCount = cyclesToday.filter(shouldRunRegistrarHealthCheck).length;
    expect(runCount).toBe(1);
  });
});
