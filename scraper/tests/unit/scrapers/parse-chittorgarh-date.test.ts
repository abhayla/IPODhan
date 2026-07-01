// Pin the process timezone to IST BEFORE importing the module under test, so the
// bug reproduces deterministically: the -1-day shift only manifests east of UTC
// (the prod VPS is Asia/Kolkata, UTC+5:30), which is exactly why UTC-CI unit tests
// never caught it. Discovered via the chittorgarh oracle date cross-check (55 SME
// IPO open/close dates stored one day early).
process.env.TZ = 'Asia/Kolkata';

import { describe, it, expect } from 'vitest';
import { parseChittorgarhDate } from '../../../src/scrapers/chittorgarh-scraper.js';

describe('parseChittorgarhDate — TZ-safe display-date fallback (no -1-day shift)', () => {
  it('keeps the ISO metadata date as-is (already correct)', () => {
    expect(parseChittorgarhDate('', '2025-12-04T00:00:00.000Z')).toBe('2025-12-04');
  });

  it('parses a "DD-Mon-YYYY" display date WITHOUT shifting a day under IST', () => {
    // Real oracle cases: chittorgarh display + ISO both say Dec 4 / Dec 3 / Nov 28;
    // the old `new Date(x).toISOString()` returned Dec 3 / Dec 2 / Nov 27 on the IST VPS.
    expect(parseChittorgarhDate('04-Dec-2025')).toBe('2025-12-04');
    expect(parseChittorgarhDate('03-Dec-2025')).toBe('2025-12-03');
    expect(parseChittorgarhDate('28-Nov-2025')).toBe('2025-11-28');
  });

  it('parses the long "Tue, Oct 07, 2025" display form without shifting', () => {
    expect(parseChittorgarhDate('Tue, Oct 07, 2025')).toBe('2025-10-07');
  });

  it('returns undefined for empty / unparseable input', () => {
    expect(parseChittorgarhDate('')).toBeUndefined();
    expect(parseChittorgarhDate('not-a-date')).toBeUndefined();
  });
});
