/**
 * Unit tests for the shared TZ-invariant date-string parsers (T-327,
 * round-7 P1-1 class sweep).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  parseDdMmmYyyy,
  parseDdMmmYy,
  toUtcEpochDay,
  toUtcEpochMs,
} from '../../../src/utils/date-string-parsing.js';

const ORIGINAL_TZ = process.env.TZ;

function withTZ(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

describe('parseDdMmmYyyy', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('parses dash-separated DD-MMM-YYYY', () => {
    expect(parseDdMmmYyyy('27-Aug-2026')).toBe('2026-08-27');
  });

  it('parses slash-separated DD/MMM/YYYY (BSE format)', () => {
    expect(parseDdMmmYyyy('06/Oct/2025')).toBe('2025-10-06');
  });

  it('parses space-separated DD MMM YYYY (BSE issue-period format)', () => {
    expect(parseDdMmmYyyy('15 Oct 2025')).toBe('2025-10-15');
  });

  it('returns null for an unrecognized month abbreviation', () => {
    expect(parseDdMmmYyyy('27-Xxx-2026')).toBeNull();
  });

  it('returns null for a non-matching shape', () => {
    expect(parseDdMmmYyyy('2026-08-27')).toBeNull();
  });

  it('is TZ-invariant under Asia/Kolkata, UTC, and America/Los_Angeles', () => {
    for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles']) {
      withTZ(tz, () => {
        expect(parseDdMmmYyyy('27-Aug-2026')).toBe('2026-08-27');
      });
    }
  });
});

describe('parseDdMmmYy', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('parses "17 Oct 25" (Moneycontrol format) to 2025-10-17', () => {
    expect(parseDdMmmYy('17 Oct 25')).toBe('2025-10-17');
  });

  it('is TZ-invariant under Asia/Kolkata, UTC, and America/Los_Angeles', () => {
    for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles']) {
      withTZ(tz, () => {
        expect(parseDdMmmYy('27 Aug 26')).toBe('2026-08-27');
      });
    }
  });

  it('returns null for an unrecognized month abbreviation', () => {
    expect(parseDdMmmYy('27 Xxx 26')).toBeNull();
  });
});

describe('toUtcEpochDay / toUtcEpochMs (W-160b, T-327 ratchet closure)', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('computes the SAME UTC calendar day for a raw date-only string regardless of host TZ', () => {
    for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles']) {
      withTZ(tz, () => {
        expect(toUtcEpochDay('2026-09-08')).toBe(Date.UTC(2026, 8, 8) / 86400000);
      });
    }
  });

  it('a raw date-only "2026-09-08" and the naive-timestamp-shifted "2026-09-07T18:30:00.000Z" ' +
      '(the exact value an IST wall-clock midnight for the same nominal day would show once ' +
      'serialized as a naive UTC-offset instant) are resolved to their OWN correct UTC calendar ' +
      'day — deterministically, never flip-flopping with host TZ (the T-327 local-midnight bug)',
    () => {
      for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles']) {
        withTZ(tz, () => {
          const dateOnlyDay = toUtcEpochDay('2026-09-08');
          const shiftedDay = toUtcEpochDay('2026-09-07T18:30:00.000Z');

          // Deterministic, explicit UTC-calendar-day math — never depends on
          // process.env.TZ (the bug this closes: `new Date(rawString)` on a
          // non-ISO/local-midnight-parsed string shifts by -1 day on an
          // IST host because the local-midnight instant is earlier, in UTC,
          // than true UTC midnight for the same nominal date).
          expect(dateOnlyDay).toBe(Date.UTC(2026, 8, 8) / 86400000);
          expect(shiftedDay).toBe(Date.UTC(2026, 8, 7) / 86400000);
          // The two representations are one calendar day apart in UTC — the
          // 18:30Z instant is still Sep-7 in UTC even though it is Sep-8
          // 00:00 IST; the invariant/consensus comparisons in
          // data-consolidation-service.ts operate on THIS UTC-day math, not
          // a host-local reinterpretation.
          expect(dateOnlyDay! - shiftedDay!).toBe(1);
        });
      }
    }
  );

  it('reads a Date instance directly (no re-parse) regardless of host TZ', () => {
    const d = new Date(Date.UTC(2026, 8, 8, 3, 15, 0));
    for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles']) {
      withTZ(tz, () => {
        expect(toUtcEpochMs(d)).toBe(d.getTime());
      });
    }
  });

  it('returns null for null/undefined/empty/garbage without throwing', () => {
    expect(toUtcEpochDay(null)).toBeNull();
    expect(toUtcEpochDay(undefined)).toBeNull();
    expect(toUtcEpochDay('')).toBeNull();
    expect(toUtcEpochDay('not-a-date')).toBeNull();
  });

  it('normalizes a known non-ISO scraped format (DD-MMM-YYYY) to the same UTC day as its ISO equivalent', () => {
    expect(toUtcEpochDay('27-Aug-2026')).toBe(toUtcEpochDay('2026-08-27'));
  });
});
