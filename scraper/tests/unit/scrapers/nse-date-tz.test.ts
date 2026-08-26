/**
 * Unit tests for the local-TZ date-parsing bug in nse-api-client.ts / nse-scraper.ts
 * (T-327, round-7 P1-1).
 *
 * `parseNSEDate`'s DD-MMM-YYYY branch previously did
 * `new Date(cleaned).toISOString().split('T')[0]` — this constructs the Date at
 * LOCAL midnight, then reads it back out in UTC. On any box west of UTC
 * (Asia/Kolkata is UTC+5:30) that round-trip has NO effect, but the prod box's
 * process timezone silently governs the result: under a positive-offset zone
 * the UTC read-back can land on the previous day depending on engine/ICU
 * behavior for a bare `new Date("27-Aug-2026")` string, which several engines
 * parse as LOCAL midnight. The fix is pure string arithmetic (mirroring the
 * existing DD/MM/YYYY branch), which is TZ-invariant by construction.
 *
 * `parseNSEDate` is exported from nse-api-client.ts purely for this direct
 * unit test (no other behavior change) — same pattern as `parsePriceRange` (T-308).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseNSEDate } from '../../../src/scrapers/nse-api-client.js';

const ORIGINAL_TZ = process.env.TZ;

function withTZ(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

describe('parseNSEDate DD-MMM-YYYY (T-327 fix) — TZ-invariant', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('parses "27-Aug-2026" to 2026-08-27 under TZ=Asia/Kolkata (prod box TZ)', () => {
    withTZ('Asia/Kolkata', () => {
      expect(parseNSEDate('27-Aug-2026')).toBe('2026-08-27');
    });
  });

  it('parses "27-Aug-2026" to 2026-08-27 under TZ=UTC', () => {
    withTZ('UTC', () => {
      expect(parseNSEDate('27-Aug-2026')).toBe('2026-08-27');
    });
  });

  it('parses "27-Aug-2026" to 2026-08-27 under TZ=America/Los_Angeles (negative offset)', () => {
    withTZ('America/Los_Angeles', () => {
      expect(parseNSEDate('27-Aug-2026')).toBe('2026-08-27');
    });
  });

  it('reproduces the exact prod values from FINDING-P1-1 under TZ=Asia/Kolkata', () => {
    withTZ('Asia/Kolkata', () => {
      expect(parseNSEDate('25-Aug-2026')).toBe('2026-08-25'); // Annu open_date
      expect(parseNSEDate('28-Aug-2026')).toBe('2026-08-28'); // Annu close_date
      expect(parseNSEDate('31-Aug-2026')).toBe('2026-08-31'); // Lumino close_date
    });
  });

  it('handles single-digit-safe padding (no drift) for a leap-day-adjacent date', () => {
    withTZ('Asia/Kolkata', () => {
      expect(parseNSEDate('01-Jan-2027')).toBe('2027-01-01');
    });
  });
});
