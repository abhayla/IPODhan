/** #1467: the shared IST-safe date helpers added for the BSE/NSE/past-IPO parsers. */
import { describe, expect, it } from 'vitest';
import { parseDdMmYyyy, parseIsoDatePrefix, parseDdMmmYyyy } from '../../../src/utils/date-string-parsing.js';

describe('parseDdMmYyyy', () => {
  it('parses - and / separators', () => {
    expect(parseDdMmYyyy('08-10-2025')).toBe('2025-10-08');
    expect(parseDdMmYyyy('16/10/2025')).toBe('2025-10-16');
    expect(parseDdMmYyyy('8-1-2026')).toBe('2026-01-08');
  });
  it('rejects impossible calendar days and other shapes', () => {
    for (const s of ['31-02-2026', '00-10-2025', '10-13-2025', '2025-10-08', 'x', '']) {
      expect(parseDdMmYyyy(s)).toBeNull();
    }
    expect(parseDdMmYyyy('29-02-2028')).toBe('2028-02-29');
    expect(parseDdMmYyyy('29-02-2027')).toBeNull();
  });
});

describe('parseIsoDatePrefix', () => {
  it('accepts date-only and zone-less datetimes (BSE Start_Dt shape) without conversion', () => {
    expect(parseIsoDatePrefix('2026-09-30')).toBe('2026-09-30');
    expect(parseIsoDatePrefix('2026-09-30T00:00:00')).toBe('2026-09-30');
    expect(parseIsoDatePrefix('2025-10-07T00:00:00.000Z')).toBe('2025-10-07');
  });
  it('fails closed on a zoned non-midnight instant and on impossible dates', () => {
    expect(parseIsoDatePrefix('2026-09-30T18:30:00Z')).toBeNull();
    expect(parseIsoDatePrefix('2026-09-30T00:00:00+05:30')).toBeNull();
    expect(parseIsoDatePrefix('2026-02-30')).toBeNull();
    expect(parseIsoDatePrefix('')).toBeNull();
  });
});

describe('parseDdMmmYyyy rejects impossible days', () => {
  it('31-Feb is null', () => {
    expect(parseDdMmmYyyy('31-Feb-2026')).toBeNull();
    expect(parseDdMmmYyyy('27-Aug-2026')).toBe('2026-08-27');
  });
});
