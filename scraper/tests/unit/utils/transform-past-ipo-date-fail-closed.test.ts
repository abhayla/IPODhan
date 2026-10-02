/** #1467 class sweep: transform-past-ipo parseDate fell back to the Date constructor + toISOString. */
import { afterEach, describe, expect, it } from 'vitest';
import { parseDate } from '../../../src/utils/transform-past-ipo.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });
const TZS = ['Asia/Kolkata', 'UTC', 'America/Los_Angeles'];

describe('transform-past-ipo parseDate fails closed instead of shifting a day', () => {
  for (const tz of TZS) {
    it(`TZ=${tz}`, () => {
      process.env.TZ = tz;
      expect(parseDate('Jan 15, 2024')).toBeNull();
      expect(parseDate('15 January 2024')).toBeNull();
      expect(parseDate('31/02/2024')).toBeNull();
      expect(parseDate('15-Jan-2024')).toBe('2024-01-15');
      expect(parseDate('15/01/2024')).toBe('2024-01-15');
      expect(parseDate('2024-01-15')).toBe('2024-01-15');
      expect(parseDate('')).toBeNull();
      expect(parseDate(null)).toBeNull();
    });
  }
});
