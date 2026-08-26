import { describe, it, expect, vi } from 'vitest';

// The script under test also imports DB/Redis/repository modules that need a
// live shared-package build to resolve — irrelevant to this pure-function
// test, so they're mocked out (same pattern as
// backfill-primary-source-documents-wiring.test.ts). vi.mock calls are
// hoisted above imports by vitest's transform regardless of source position.
vi.mock('@ipodhan/shared/db/schema', () => ({}));
vi.mock('@ipodhan/shared/db', () => ({ db: {} }));
vi.mock('@ipodhan/shared/cache/redis-client', () => ({ getRedisClient: () => ({}) }));
vi.mock('@ipodhan/shared/repositories', () => ({
  GMPRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { parseGmpHistoryDateCell } from '../../../src/scripts/backfill-gmp-historical.js';

/**
 * T-327F item "SWEEP MISS" (checker T-327C): backfill-gmp-historical.ts:193
 * pushed `date: new Date(cells[0]).toISOString()` straight from a scraped
 * Chittorgarh GMP-history table cell — the same local-TZ-shift class as the
 * NSE/BSE/anchor-investor bugs this ticket fixed elsewhere (a date-only
 * string parses at LOCAL midnight, then .toISOString() reads it back a day
 * off in a non-UTC process TZ — see
 * .claude/rules/utc-naive-timestamp-normalization.md). This test locks the
 * fix: parseGmpHistoryDateCell() does pure string arithmetic (via the
 * shared date-string-parsing helpers) and is TZ-invariant by construction —
 * asserted here by fixing the process TZ to a non-UTC zone and confirming
 * the output does not shift.
 */
describe('parseGmpHistoryDateCell (T-327F sweep-miss fix)', () => {
  it('parses "DD-MMM-YYYY" to a UTC-midnight ISO instant', () => {
    expect(parseGmpHistoryDateCell('06-Oct-2025')).toBe('2025-10-06T00:00:00.000Z');
  });

  it('parses "DD MMM YYYY" (space-separated) to a UTC-midnight ISO instant', () => {
    expect(parseGmpHistoryDateCell('06 Oct 2025')).toBe('2025-10-06T00:00:00.000Z');
  });

  it('parses a 2-digit year "DD MMM YY" to a UTC-midnight ISO instant', () => {
    expect(parseGmpHistoryDateCell('06 Oct 25')).toBe('2025-10-06T00:00:00.000Z');
  });

  it('returns null for an unrecognized shape instead of guessing via new Date()', () => {
    expect(parseGmpHistoryDateCell('not a date')).toBeNull();
    expect(parseGmpHistoryDateCell('')).toBeNull();
  });

  it('is TZ-invariant: the same output regardless of process.env.TZ (Asia/Kolkata vs UTC vs America/Los_Angeles)', () => {
    const original = process.env.TZ;
    try {
      const zones = ['Asia/Kolkata', 'UTC', 'America/Los_Angeles'];
      const results = zones.map((tz) => {
        process.env.TZ = tz;
        return parseGmpHistoryDateCell('31-Dec-2025');
      });
      expect(new Set(results).size).toBe(1);
      expect(results[0]).toBe('2025-12-31T00:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });
});
