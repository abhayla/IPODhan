import { describe, it, expect } from 'vitest';
import { parseNaiveTimestampAsUtc } from '@ipodhan/shared/db';

/**
 * #28 — a `timestamp without time zone` value must be read as UTC regardless of the
 * process timezone, so app-written (true-UTC-naive) timestamps round-trip correctly.
 */
describe('parseNaiveTimestampAsUtc (#28 read normalization)', () => {
  it('interprets a naive timestamp as UTC, not process-local', () => {
    const d = parseNaiveTimestampAsUtc('2026-06-15 14:55:32.123');
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe('2026-06-15T14:55:32.123Z');
  });

  it('handles a naive timestamp with no fractional seconds', () => {
    const d = parseNaiveTimestampAsUtc('2026-06-15 14:55:32');
    expect(d!.toISOString()).toBe('2026-06-15T14:55:32.000Z');
  });

  it('does NOT shift by the local offset (true-UTC instant preserved)', () => {
    // The exact bug: 12:00 UTC stored naive must read back as 12:00Z, never 06:30Z/17:30Z.
    const d = parseNaiveTimestampAsUtc('2026-06-15 12:00:00');
    expect(d!.getUTCHours()).toBe(12);
    expect(d!.getUTCMinutes()).toBe(0);
  });

  it('passes SQL NULL through as null', () => {
    expect(parseNaiveTimestampAsUtc(null)).toBeNull();
  });

  it('maps infinity / -infinity to max/min dates without throwing', () => {
    expect(parseNaiveTimestampAsUtc('infinity')!.getTime()).toBe(8640000000000000);
    expect(parseNaiveTimestampAsUtc('-infinity')!.getTime()).toBe(-8640000000000000);
  });
});
