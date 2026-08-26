/**
 * Unit tests for extractBidDate's TZ-invariance (T-327, round-7 P1-1 class
 * sweep). All three patterns previously built the returned Date via
 * `new Date(localString)` / `new Date(y, m, d)` — LOCAL-midnight construction
 * that drifts a day when later read via toISOString() on a non-UTC host
 * (prod is Asia/Kolkata). Fixed to build via Date.UTC(...) throughout.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { extractBidDate } from '../../../src/scrapers/anchor-investors-scraper.js';

const ORIGINAL_TZ = process.env.TZ;

function withTZ(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

describe('extractBidDate — TZ-invariant across all three patterns', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  const TZS = ['Asia/Kolkata', 'UTC', 'America/Los_Angeles'];

  it('Pattern 1 "Month DD, YYYY" is TZ-invariant', () => {
    for (const tz of TZS) {
      withTZ(tz, () => {
        const date = extractBidDate('Anchor Investor Bidding Date: October 27, 2025');
        expect(date?.toISOString().split('T')[0]).toBe('2025-10-27');
      });
    }
  });

  it('Pattern 2 "DD/MM/YYYY" is TZ-invariant', () => {
    for (const tz of TZS) {
      withTZ(tz, () => {
        const date = extractBidDate('Bid Date: 27/10/2025');
        expect(date?.toISOString().split('T')[0]).toBe('2025-10-27');
      });
    }
  });

  it('Pattern 3 "DD MMM YYYY" is TZ-invariant', () => {
    for (const tz of TZS) {
      withTZ(tz, () => {
        const date = extractBidDate('Anchor Portion opened on: 27 Oct 2025');
        expect(date?.toISOString().split('T')[0]).toBe('2025-10-27');
      });
    }
  });

  it('returns null when no pattern matches', () => {
    expect(extractBidDate('no relevant text here')).toBeNull();
  });
});
