/**
 * #1467 class sweep: parseNSEDate kept a `new Date(cleaned).toISOString().split('T')[0]` fallback for
 * strings no branch matched. A free-text date parses at LOCAL midnight, so under TZ=Asia/Kolkata the
 * fallback returned the PREVIOUS day. Unrecognised shapes are now absent (undefined), in every TZ.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { parseNSEDate } from '../../../src/scrapers/nse-api-client.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });
const TZS = ['Asia/Kolkata', 'UTC', 'America/Los_Angeles'];

describe('parseNSEDate fails closed instead of shifting a day', () => {
  for (const tz of TZS) {
    it(`TZ=${tz}: free-text dates are absent, not shifted`, () => {
      process.env.TZ = tz;
      expect(parseNSEDate('Oct 9, 2025')).toBeUndefined();
      expect(parseNSEDate('9 October 2025')).toBeUndefined();
      expect(parseNSEDate('31-Feb-2026')).toBeUndefined();
    });
    it(`TZ=${tz}: known shapes still parse exactly`, () => {
      process.env.TZ = tz;
      expect(parseNSEDate('09-Oct-2025')).toBe('2025-10-09');
      expect(parseNSEDate('09/10/2025')).toBe('2025-10-09');
      expect(parseNSEDate('2025-10-09')).toBe('2025-10-09');
      expect(parseNSEDate('2025-10-09T00:00:00')).toBe('2025-10-09');
    });
  }
});
